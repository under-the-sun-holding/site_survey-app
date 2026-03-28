/**
 * backend/src/routes/surveys.ts
 *
 * All survey-related API endpoints.
 * Uses pool.query from the shared database module throughout.
 * Location is stored as GEOGRAPHY(POINT, 4326) via PostGIS.
 */
import path from "path";
import fs from "fs";
import { Router, Request, Response } from "express";
import multer from "multer";
import { pool } from "../database";
import { solarSurveySchema } from "../models/Survey";
import { stringify as csvStringify } from "csv-stringify/sync";
import { generateReport, toMarkdown } from "../utils/reportGenerator";

const router = Router();

// ----------------------------------------------------------------
// Multer — photo upload storage
// ----------------------------------------------------------------
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

// Only allow image MIME types
const imageFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per photo
});

// ----------------------------------------------------------------
// TypeScript interfaces
// ----------------------------------------------------------------
interface ChecklistItemInput {
  label: string;
  status: string;
  notes?: string;
  sort_order?: number;
}

interface PhotoInput {
  filename?: string;
  label?: string;
  data_url?: string; // base64 — used by mobile sync
  mime_type?: string;
  captured_at?: string;
}

/** GeoJSON Point accepted as the `location` field in a request body. */
interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

/**
 * Category-specific metadata stored as JSONB.
 * The `type` discriminator matches the category_id slug so the API
 * and the design team can identify which schema is in use.
 */
interface GroundMountMetadata {
  type: "ground_mount";
  soil_type: "Rocky" | "Sandy" | "Clay" | "Organic/Loam" | null;
  slope_degrees: number | null;
  trenching_path: string;
  vegetation_clearing: boolean;
}
interface RoofMountMetadata {
  type: "roof_mount";
  roof_material: "Asphalt Shingle" | "Metal" | "Tile" | "Membrane" | null;
  rafter_size: "2x4" | "2x6" | "2x8" | null;
  rafter_spacing: "16in" | "24in" | null;
  roof_age_years: number | null;
  azimuth: number | null;
}
interface SolarFencingMetadata {
  type: "solar_fencing";
  perimeter_length_ft: number | null;
  lower_shade_risk: boolean;
  foundation_type: "Driven Piles" | "Concrete Footer" | null;
  bifacial_surface: "Concrete" | "Gravel" | "Grass" | "Dirt" | null;
}
type SurveyMetadata =
  | GroundMountMetadata
  | RoofMountMetadata
  | SolarFencingMetadata;

interface SurveyInput {
  project_name: string;
  project_id?: string;
  category_id?: string;
  category_name?: string;
  inspector_name: string;
  site_name: string;
  site_address?: string;
  /** GeoJSON Point — takes priority over latitude/longitude fields */
  location?: GeoJsonPoint;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
  survey_date?: string;
  notes?: string;
  status?: string;
  device_id?: string;
  /** Category-specific fields (Ground Mount / Roof Mount / Solar Fencing) */
  metadata?: SurveyMetadata | null;
  checklist?: ChecklistItemInput[];
  photos?: PhotoInput[];
}

// ----------------------------------------------------------------
// Coordinate helpers
// ----------------------------------------------------------------

/**
 * Extract (lon, lat) from either a GeoJSON Point or explicit lat/lon fields.
 * Returns null when no location data is present.
 */
function extractCoords(
  body: SurveyInput,
): { lon: number; lat: number; accuracy?: number } | null {
  if (
    body.location?.type === "Point" &&
    Array.isArray(body.location.coordinates)
  ) {
    const [lon, lat] = body.location.coordinates;
    return { lon, lat };
  }
  if (body.latitude != null && body.longitude != null) {
    return {
      lon: body.longitude,
      lat: body.latitude,
      accuracy: body.gps_accuracy,
    };
  }
  return null;
}

/**
 * Build the ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography expression
 * and append lon/lat to the params array.
 * Returns the SQL expression string to embed in a query.
 */
function geoExpr(params: unknown[], lon: number, lat: number): string {
  params.push(lon, lat);
  const lonIdx = params.length - 1;
  const latIdx = params.length;
  return `ST_SetSRID(ST_MakePoint($${lonIdx}, $${latIdx}), 4326)::geography`;
}

// ----------------------------------------------------------------
// DB helpers
// ----------------------------------------------------------------

/**
 * Fetch a complete survey (checklist + photos) by ID.
 * Uses ST_AsGeoJSON to serialise the geography point for the response.
 */
async function fetchSurveyFull(id: string) {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       s.id, s.project_name, s.project_id, s.category_id, s.category_name,
       s.inspector_name, s.site_name, s.site_address,
       s.latitude, s.longitude, s.gps_accuracy,
       ST_AsGeoJSON(s.location::geometry)::jsonb AS location_geojson,
       s.survey_date, s.notes, s.status, s.device_id, s.metadata,
       s.synced_at, s.created_at, s.updated_at
     FROM surveys s
     WHERE s.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const survey = rows[0];

  const { rows: checklist } = await pool.query(
    `SELECT id, survey_id, label, status, notes, sort_order, created_at
       FROM checklist_items
      WHERE survey_id = $1
      ORDER BY sort_order, created_at`,
    [id],
  );

  const { rows: photos } = await pool.query(
    `SELECT id, survey_id, filename, label, file_path, mime_type, captured_at, created_at
       FROM survey_photos
      WHERE survey_id = $1
      ORDER BY captured_at`,
    [id],
  );

  return { ...survey, checklist, photos };
}

/** Replace all checklist items for a survey within a transaction client. */
async function upsertChecklist(
  client: import("pg").PoolClient,
  surveyId: string,
  items: ChecklistItemInput[],
): Promise<void> {
  await client.query("DELETE FROM checklist_items WHERE survey_id = $1", [
    surveyId,
  ]);
  for (let i = 0; i < items.length; i++) {
    const { label, status = "pending", notes = "" } = items[i];
    await client.query(
      `INSERT INTO checklist_items (survey_id, label, status, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [surveyId, label, status, notes, i],
    );
  }
}

/** Replace all photos (base64 variant) for a survey within a transaction client. */
async function upsertPhotos(
  client: import("pg").PoolClient,
  surveyId: string,
  photos: PhotoInput[],
): Promise<void> {
  await client.query("DELETE FROM survey_photos WHERE survey_id = $1", [
    surveyId,
  ]);
  for (const p of photos) {
    await client.query(
      `INSERT INTO survey_photos
         (survey_id, filename, label, data_url, mime_type, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        surveyId,
        p.filename ?? null,
        p.label ?? null,
        p.data_url ?? null,
        p.mime_type ?? "image/jpeg",
        p.captured_at ? new Date(p.captured_at) : new Date(),
      ],
    );
  }
}

/**
 * POST /api/surveys/validate/solar
 *
 * Validates a solar survey payload against the shared Zod schema.
 * This is intentionally separate from the persisted survey CRUD shape,
 * which stores broader workflow data plus category-specific metadata.
 */
router.post("/validate/solar", async (req: Request, res: Response) => {
  const parsed = solarSurveySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid solar survey payload",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
    return;
  }

  res.status(200).json({
    valid: true,
    data: parsed.data,
  });
});

// ================================================================
// EXPORT ROUTES — must be declared BEFORE /:id to avoid shadowing
// ================================================================

/**
 * GET /api/surveys/export/geojson
 *
 * Returns a GeoJSON FeatureCollection of all surveys.
 * Supports optional query filters: project_id, status, category_id.
 * Uses ST_AsGeoJSON(location::geometry) so GIS tools can import directly.
 */
router.get("/export/geojson", async (req: Request, res: Response) => {
  try {
    const { project_id, status, category_id } = req.query as Record<
      string,
      string
    >;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) {
      conditions.push(`s.project_id  = $${params.push(project_id)}`);
    }
    if (status) {
      conditions.push(`s.status       = $${params.push(status)}`);
    }
    if (category_id) {
      conditions.push(`s.category_id  = $${params.push(category_id)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.project_name,
         s.category_name,
         s.inspector_name,
         s.site_name,
         s.site_address,
         s.latitude,
         s.longitude,
         s.gps_accuracy,
         s.survey_date,
         s.notes,
         s.status,
         s.metadata,
         s.created_at,
         s.updated_at,
         -- ST_AsGeoJSON converts the GEOGRAPHY column to a GeoJSON geometry object
         ST_AsGeoJSON(s.location::geometry)::jsonb AS geometry,
         (
           SELECT json_agg(
             json_build_object(
               'label',  c.label,
               'status', c.status,
               'notes',  c.notes
             ) ORDER BY c.sort_order
           )
           FROM checklist_items c
           WHERE c.survey_id = s.id
         ) AS checklist
       FROM surveys s
       ${where}
       ORDER BY s.survey_date DESC`,
      params,
    );

    const features = rows.map((row) => ({
      type: "Feature" as const,
      geometry: row.geometry ?? null,
      properties: {
        id: row.id,
        project_name: row.project_name,
        category: row.category_name,
        inspector: row.inspector_name,
        site_name: row.site_name,
        site_address: row.site_address,
        latitude: row.latitude,
        longitude: row.longitude,
        gps_accuracy_m: row.gps_accuracy,
        survey_date: row.survey_date,
        status: row.status,
        notes: row.notes,
        /** Category-specific metadata — Ground Mount, Roof Mount, or Solar Fencing fields */
        metadata: row.metadata ?? null,
        checklist: row.checklist ?? [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    }));

    const geojson = {
      type: "FeatureCollection" as const,
      features,
      metadata: {
        exported_at: new Date().toISOString(),
        total_records: features.length,
        crs: "EPSG:4326",
      },
    };

    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="site_surveys_${Date.now()}.geojson"`,
    );
    res.json(geojson);
  } catch (err) {
    console.error("GET /api/surveys/export/geojson error:", err);
    res.status(500).json({ error: "Failed to export GeoJSON" });
  }
});

/**
 * GET /api/surveys/export/csv
 *
 * Exports a flat CSV with one row per survey.
 * latitude and longitude are explicit columns so the data can be
 * imported directly into GIS / CAD tools (e.g. QGIS, AutoCAD Map 3D).
 * Supports the same optional query filters as the GeoJSON endpoint.
 */
router.get("/export/csv", async (req: Request, res: Response) => {
  try {
    const { project_id, status, category_id } = req.query as Record<
      string,
      string
    >;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) {
      conditions.push(`s.project_id  = $${params.push(project_id)}`);
    }
    if (status) {
      conditions.push(`s.status       = $${params.push(status)}`);
    }
    if (category_id) {
      conditions.push(`s.category_id  = $${params.push(category_id)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.project_name,
         s.category_name,
         s.inspector_name,
         s.site_name,
         s.site_address,
         s.latitude,
         s.longitude,
         s.gps_accuracy,
         s.survey_date,
         s.notes,
         s.status,
         s.metadata,
         s.created_at,
         s.updated_at
       FROM surveys s
       ${where}
       ORDER BY s.survey_date DESC`,
      params,
    );
    const filename = `site_surveys_${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (rows.length === 0) {
      res.send(
        "id,project_name,category,inspector_name,site_name,site_address," +
          "latitude,longitude,gps_accuracy_m,survey_date,status,notes," +
          // Ground Mount columns
          "soil_type,slope_degrees,trenching_path,vegetation_clearing," +
          // Roof Mount columns
          "roof_material,rafter_size,rafter_spacing,roof_age_years,azimuth," +
          // Solar Fencing columns
          "perimeter_length_ft,lower_shade_risk,foundation_type,bifacial_surface," +
          "metadata_json,created_at,updated_at\n",
      );
      return;
    }

    const csv = csvStringify(
      rows.map((r) => {
        // Parse the JSONB metadata into typed fields for clean CSV columns
        const meta = r.metadata as Record<string, unknown> | null;
        const metaType = meta?.type as string | undefined;

        return {
          id: r.id,
          project_name: r.project_name,
          category: r.category_name ?? "",
          inspector_name: r.inspector_name,
          site_name: r.site_name,
          site_address: r.site_address ?? "",
          latitude: r.latitude ?? "",
          longitude: r.longitude ?? "",
          gps_accuracy_m: r.gps_accuracy ?? "",
          survey_date: r.survey_date
            ? new Date(r.survey_date as string).toISOString()
            : "",
          status: r.status,
          notes: r.notes ?? "",
          // --- Ground Mount ---
          soil_type: metaType === "ground_mount" ? (meta?.soil_type ?? "") : "",
          slope_degrees:
            metaType === "ground_mount" ? (meta?.slope_degrees ?? "") : "",
          trenching_path:
            metaType === "ground_mount" ? (meta?.trenching_path ?? "") : "",
          vegetation_clearing:
            metaType === "ground_mount"
              ? String(meta?.vegetation_clearing ?? "")
              : "",
          // --- Roof Mount ---
          roof_material:
            metaType === "roof_mount" ? (meta?.roof_material ?? "") : "",
          rafter_size:
            metaType === "roof_mount" ? (meta?.rafter_size ?? "") : "",
          rafter_spacing:
            metaType === "roof_mount" ? (meta?.rafter_spacing ?? "") : "",
          roof_age_years:
            metaType === "roof_mount" ? (meta?.roof_age_years ?? "") : "",
          azimuth: metaType === "roof_mount" ? (meta?.azimuth ?? "") : "",
          // --- Solar Fencing ---
          perimeter_length_ft:
            metaType === "solar_fencing"
              ? (meta?.perimeter_length_ft ?? "")
              : "",
          lower_shade_risk:
            metaType === "solar_fencing"
              ? String(meta?.lower_shade_risk ?? "")
              : "",
          foundation_type:
            metaType === "solar_fencing" ? (meta?.foundation_type ?? "") : "",
          bifacial_surface:
            metaType === "solar_fencing" ? (meta?.bifacial_surface ?? "") : "",
          // Raw JSON for any tooling that prefers it
          metadata_json: meta ? JSON.stringify(meta) : "",
          created_at: new Date(r.created_at as string).toISOString(),
          updated_at: new Date(r.updated_at as string).toISOString(),
        };
      }),
      { header: true },
    );

    res.send(csv);
  } catch (err) {
    console.error("GET /api/surveys/export/csv error:", err);
    res.status(500).json({ error: "Failed to export CSV" });
  }
});

// ================================================================
// BATCH SYNC  (offline-first mobile support)
// ================================================================

/**
 * POST /api/surveys/sync
 *
 * Accepts an array of surveys created offline on a mobile device.
 * Each entry includes its local UUID so the client can reconcile.
 */
router.post("/sync", async (req: Request, res: Response) => {
  const { device_id, surveys } = req.body as {
    device_id?: string;
    surveys: Array<{
      action: "create" | "update";
      survey: SurveyInput & { id?: string };
    }>;
  };

  if (!Array.isArray(surveys) || surveys.length === 0) {
    res.status(400).json({ error: "surveys array is required" });
    return;
  }

  const results: Array<{
    id: string;
    action: string;
    success: boolean;
    error?: string;
  }> = [];
  const client = await pool.connect();

  try {
    for (const { action, survey } of surveys) {
      try {
        await client.query("BEGIN");

        const coords = extractCoords(survey);

        if (action === "create") {
          // Use the client-generated UUID so we can return it to the device
          const { rows: idRows } = await client.query(
            "SELECT gen_random_uuid() AS id",
          );
          const surveyId: string =
            (survey.id as string) || (idRows[0].id as string);

          const insertParams: unknown[] = [
            surveyId,
            survey.project_name,
            survey.project_id ?? null,
            survey.category_id ?? null,
            survey.category_name ?? null,
            survey.inspector_name,
            survey.site_name,
            survey.site_address ?? null,
            coords?.lat ?? null,
            coords?.lon ?? null,
            coords?.accuracy ?? null,
          ];

          const locationSql = coords
            ? geoExpr(insertParams, coords.lon, coords.lat)
            : "NULL";

          insertParams.push(
            survey.survey_date ? new Date(survey.survey_date) : new Date(),
            survey.notes ?? null,
            survey.status ?? "submitted",
            device_id ?? survey.device_id ?? null,
            survey.metadata != null ? JSON.stringify(survey.metadata) : null,
          );

          await client.query(
            `INSERT INTO surveys
               (id, project_name, project_id, category_id, category_name,
                inspector_name, site_name, site_address,
                latitude, longitude, gps_accuracy, location,
                survey_date, notes, status, device_id, metadata, synced_at)
             VALUES
               ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                ${locationSql},
                $${insertParams.length - 4},
                $${insertParams.length - 3},
                $${insertParams.length - 2},
                $${insertParams.length - 1},
                $${insertParams.length},
                NOW())
             ON CONFLICT (id) DO NOTHING`,
            insertParams,
          );

          if (survey.checklist?.length)
            await upsertChecklist(client, surveyId, survey.checklist);
          if (survey.photos?.length)
            await upsertPhotos(client, surveyId, survey.photos);

          await client.query("COMMIT");
          results.push({ id: surveyId, action: "created", success: true });
        } else if (action === "update" && survey.id) {
          const coords = extractCoords(survey);
          const updateParams: unknown[] = [
            survey.id,
            survey.project_name ?? null,
            survey.project_id ?? null,
            survey.category_id ?? null,
            survey.category_name ?? null,
            survey.inspector_name ?? null,
            survey.site_name ?? null,
            survey.site_address ?? null,
            coords?.lat ?? null,
            coords?.lon ?? null,
            coords?.accuracy ?? null,
          ];

          const locationSql = coords
            ? geoExpr(updateParams, coords.lon, coords.lat)
            : "location"; // keep existing value

          updateParams.push(
            survey.notes ?? null,
            survey.status ?? null,
            survey.metadata != null ? JSON.stringify(survey.metadata) : null,
          );

          await client.query(
            `UPDATE surveys SET
               project_name   = COALESCE($2,  project_name),
               project_id     = COALESCE($3,  project_id),
               category_id    = COALESCE($4,  category_id),
               category_name  = COALESCE($5,  category_name),
               inspector_name = COALESCE($6,  inspector_name),
               site_name      = COALESCE($7,  site_name),
               site_address   = COALESCE($8,  site_address),
               latitude       = COALESCE($9,  latitude),
               longitude      = COALESCE($10, longitude),
               gps_accuracy   = COALESCE($11, gps_accuracy),
               location       = ${locationSql},
               notes          = COALESCE($${updateParams.length - 2}, notes),
               status         = COALESCE($${updateParams.length - 1}, status),
               metadata       = COALESCE($${updateParams.length}::jsonb, metadata),
               synced_at      = NOW(),
               updated_at     = NOW()
             WHERE id = $1`,
            updateParams,
          );

          if (survey.checklist?.length)
            await upsertChecklist(client, survey.id, survey.checklist);
          if (survey.photos?.length)
            await upsertPhotos(client, survey.id, survey.photos);

          await client.query("COMMIT");
          results.push({ id: survey.id, action: "updated", success: true });
        }
      } catch (err) {
        await client.query("ROLLBACK");
        results.push({
          id: (survey as { id?: string }).id ?? "unknown",
          action,
          success: false,
          error: String(err),
        });
      }
    }

    res.json({ synced: results.filter((r) => r.success).length, results });
  } finally {
    client.release();
  }
});

// ================================================================
// SURVEY LIST
// ================================================================

/**
 * GET /api/surveys
 *
 * Returns surveys sorted by most recent survey_date, including
 * category names from the categories table via category_name column.
 * Supports optional filters: project_id, status, category_id.
 * Pagination via limit / offset query params.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      project_id,
      status,
      category_id,
      limit = "100",
      offset = "0",
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) {
      conditions.push(`s.project_id  = $${params.push(project_id)}`);
    }
    if (status) {
      conditions.push(`s.status       = $${params.push(status)}`);
    }
    if (category_id) {
      conditions.push(`s.category_id  = $${params.push(category_id)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(parseInt(limit, 10), 500);
    const off = parseInt(offset, 10);

    // Total count (without pagination)
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM surveys s ${where}`,
      params,
    );

    params.push(lim, off);

    // Surveys sorted by most-recent survey_date first,
    // with category name and aggregated child counts
    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.project_name,
         s.category_name,
         -- Resolve category name from categories table when available
         COALESCE(cat.name, s.category_name) AS resolved_category,
         s.inspector_name,
         s.site_name,
         s.site_address,
         s.latitude,
         s.longitude,
         s.survey_date,
         s.status,
         s.notes,
         s.created_at,
         s.updated_at,
         (SELECT COUNT(*)::int FROM checklist_items c WHERE c.survey_id = s.id) AS checklist_count,
         (SELECT COUNT(*)::int FROM survey_photos   p WHERE p.survey_id = s.id) AS photo_count
       FROM surveys s
       LEFT JOIN categories cat ON cat.id = s.category_id
       ${where}
       ORDER BY s.survey_date DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    res.json({ surveys: rows, total: countRows[0].total });
  } catch (err) {
    console.error("GET /api/surveys error:", err);
    res.status(500).json({ error: "Failed to retrieve surveys" });
  }
});

// ================================================================
// SINGLE SURVEY
// ================================================================

// ================================================================
// ENGINEERING ASSESSMENT REPORT
// Must be declared BEFORE /:id so Express doesn't shadow it.
// ================================================================

/**
 * GET /api/surveys/:id/report
 *
 * Generates an Engineering Assessment report by analysing the survey's
 * metadata and checklist results.
 *
 * Query params:
 *   ?format=markdown  → returns a Markdown file download
 *   (default)         → returns the EngineeringReport JSON object
 *
 * Automated High-Priority flags:
 *   - Roof Mount  : roof_age_years > 15 or material === 'Membrane'
 *   - Ground Mount: soil_type === 'Rocky'
 *   - Solar Fencing: lower_shade_risk === true
 *   - Electrical  : checklist "Main Service Panel" status === 'fail'
 */
router.get("/:id/report", async (req: Request, res: Response) => {
  try {
    const survey = await fetchSurveyFull(req.params.id);
    if (!survey) {
      res.status(404).json({ error: "Survey not found" });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = generateReport(survey as any);

    const format = (req.query["format"] as string | undefined)?.toLowerCase();

    if (format === "markdown") {
      const md = toMarkdown(report);
      const filename = `engineering-report-${req.params.id}-${Date.now()}.md`;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(md);
      return;
    }

    res.json(report);
  } catch (err) {
    console.error("GET /api/surveys/:id/report error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

/** GET /api/surveys/:id */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const survey = await fetchSurveyFull(req.params.id);
    if (!survey) {
      res.status(404).json({ error: "Survey not found" });
      return;
    }
    res.json(survey);
  } catch (err) {
    console.error("GET /api/surveys/:id error:", err);
    res.status(500).json({ error: "Failed to retrieve survey" });
  }
});

// ================================================================
// CREATE SURVEY
// ================================================================

/**
 * POST /api/surveys
 *
 * Accepts location as either:
 *   { "location": { "type": "Point", "coordinates": [lon, lat] } }
 * or flat fields:
 *   { "latitude": 51.5, "longitude": -0.1, "gps_accuracy": 5 }
 *
 * The geography column is populated with:
 *   ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as SurveyInput & { id?: string };

  if (
    !body.project_name?.trim() ||
    !body.inspector_name?.trim() ||
    !body.site_name?.trim()
  ) {
    res.status(400).json({
      error: "project_name, inspector_name, and site_name are required",
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Allow the client to supply an ID (for offline-first mobile sync)
    const { rows: idRows } = await client.query(
      "SELECT gen_random_uuid() AS id",
    );
    const surveyId: string = body.id ?? (idRows[0].id as string);

    const coords = extractCoords(body);

    // Build parameterised values list
    const insertParams: unknown[] = [
      surveyId,
      body.project_name.trim(),
      body.project_id ?? null,
      body.category_id ?? null,
      body.category_name ?? null,
      body.inspector_name.trim(),
      body.site_name.trim(),
      body.site_address ?? null,
      coords?.lat ?? null, // $9  — latitude  column
      coords?.lon ?? null, // $10 — longitude column
      coords?.accuracy ?? null, // $11 — gps_accuracy column
    ];

    // $12 onwards: geography expression or NULL
    const locationSql = coords
      ? geoExpr(insertParams, coords.lon, coords.lat)
      : "NULL";

    insertParams.push(
      body.survey_date ? new Date(body.survey_date) : new Date(), // survey_date
      body.notes ?? null, // notes
      body.status ?? "draft", // status
      body.device_id ?? null, // device_id
      body.metadata != null ? JSON.stringify(body.metadata) : null, // metadata
    );

    const { rows } = await client.query(
      `INSERT INTO surveys
         (id, project_name, project_id, category_id, category_name,
          inspector_name, site_name, site_address,
          latitude, longitude, gps_accuracy, location,
          survey_date, notes, status, device_id, metadata)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          ${locationSql},
          $${insertParams.length - 4},
          $${insertParams.length - 3},
          $${insertParams.length - 2},
          $${insertParams.length - 1},
          $${insertParams.length})
       RETURNING id`,
      insertParams,
    );

    const newId = rows[0].id as string;

    if (body.checklist?.length)
      await upsertChecklist(client, newId, body.checklist);
    if (body.photos?.length) await upsertPhotos(client, newId, body.photos);

    await client.query("COMMIT");

    const full = await fetchSurveyFull(newId);
    res.status(201).json(full);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/surveys error:", err);
    res.status(500).json({ error: "Failed to create survey" });
  } finally {
    client.release();
  }
});

// ================================================================
// UPDATE SURVEY
// ================================================================

/** PUT /api/surveys/:id */
router.put("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Partial<SurveyInput>;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT id FROM surveys WHERE id = $1",
      [id],
    );
    if (existing.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Survey not found" });
      return;
    }

    const coords = extractCoords(body as SurveyInput);
    const updateParams: unknown[] = [
      id,
      body.project_name ?? null,
      body.project_id ?? null,
      body.category_id ?? null,
      body.category_name ?? null,
      body.inspector_name ?? null,
      body.site_name ?? null,
      body.site_address ?? null,
      coords?.lat ?? null, // $9
      coords?.lon ?? null, // $10
      coords?.accuracy ?? null, // $11
    ];

    // Keep existing location when no new coords are supplied
    const locationSql = coords
      ? geoExpr(updateParams, coords.lon, coords.lat)
      : "location";

    updateParams.push(
      body.notes ?? null,
      body.status ?? null,
      body.metadata != null ? JSON.stringify(body.metadata) : null,
    );

    await client.query(
      `UPDATE surveys SET
         project_name   = COALESCE($2,  project_name),
         project_id     = COALESCE($3,  project_id),
         category_id    = COALESCE($4,  category_id),
         category_name  = COALESCE($5,  category_name),
         inspector_name = COALESCE($6,  inspector_name),
         site_name      = COALESCE($7,  site_name),
         site_address   = COALESCE($8,  site_address),
         latitude       = COALESCE($9,  latitude),
         longitude      = COALESCE($10, longitude),
         gps_accuracy   = COALESCE($11, gps_accuracy),
         location       = ${locationSql},
         notes          = COALESCE($${updateParams.length - 2}, notes),
         status         = COALESCE($${updateParams.length - 1}, status),
         metadata       = COALESCE($${updateParams.length}::jsonb, metadata),
         updated_at     = NOW()
       WHERE id = $1`,
      updateParams,
    );

    if (body.checklist?.length)
      await upsertChecklist(client, id, body.checklist);
    if (body.photos?.length) await upsertPhotos(client, id, body.photos);

    await client.query("COMMIT");

    const full = await fetchSurveyFull(id);
    res.json(full);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/surveys/:id error:", err);
    res.status(500).json({ error: "Failed to update survey" });
  } finally {
    client.release();
  }
});

// ================================================================
// PHOTO UPLOAD  (multipart/form-data from mobile)
// ================================================================

/**
 * POST /api/surveys/:id/photos
 *
 * Accepts one or more image files as multipart/form-data.
 * Field names: "photos" (multiple) or "photo" (single).
 * Optional body fields per file: label, captured_at
 */
router.post(
  "/:id/photos",
  upload.array("photos", 20),
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Verify the survey exists
    const { rows } = await pool.query("SELECT id FROM surveys WHERE id = $1", [
      id,
    ]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Survey not found" });
      return;
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No image files provided" });
      return;
    }

    // Labels may be passed as a JSON array string or a single string
    let labels: string[] = [];
    try {
      if (req.body.labels) {
        labels = JSON.parse(req.body.labels as string);
      } else if (req.body.label) {
        labels = [req.body.label as string];
      }
    } catch {
      /* ignore parse errors */
    }

    const captured_at = req.body.captured_at
      ? new Date(req.body.captured_at as string)
      : new Date();

    const inserted: unknown[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const label = labels[i] ?? file.originalname ?? "";

      const { rows: photoRows } = await pool.query(
        `INSERT INTO survey_photos
         (survey_id, filename, label, file_path, mime_type, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
        [
          id,
          file.originalname,
          label,
          file.path, // absolute path inside uploads/
          file.mimetype,
          captured_at,
        ],
      );
      inserted.push(photoRows[0]);
    }

    res.status(201).json({ uploaded: inserted.length, photos: inserted });
  },
);

export default router;
