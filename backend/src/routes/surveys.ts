import { Router, Request, Response } from 'express';
import { pool } from '../database';
import { stringify as csvStringify } from 'csv-stringify/sync';

const router = Router();

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

interface ChecklistItemInput {
  id?: string;
  label: string;
  status: string;
  notes?: string;
  sort_order?: number;
}

interface PhotoInput {
  id?: string;
  filename?: string;
  label?: string;
  data_url?: string;
  mime_type?: string;
  captured_at?: string;
}

interface SurveyInput {
  project_name: string;
  project_id?: string;
  category_id?: string;
  category_name?: string;
  inspector_name: string;
  site_name: string;
  site_address?: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
  survey_date?: string;
  notes?: string;
  status?: string;
  device_id?: string;
  checklist?: ChecklistItemInput[];
  photos?: PhotoInput[];
}

/** Build a full survey object from a DB row, including nested items. */
async function fetchSurveyFull(id: string) {
  const { rows: surveyRows } = await pool.query(
    `SELECT
       s.*,
       ST_X(s.location) AS lon,
       ST_Y(s.location) AS lat
     FROM surveys s
     WHERE s.id = $1`,
    [id]
  );
  if (surveyRows.length === 0) return null;
  const survey = surveyRows[0];

  const { rows: checklist } = await pool.query(
    'SELECT * FROM checklist_items WHERE survey_id = $1 ORDER BY sort_order, created_at',
    [id]
  );
  const { rows: photos } = await pool.query(
    'SELECT id, survey_id, filename, label, mime_type, captured_at, created_at FROM survey_photos WHERE survey_id = $1 ORDER BY captured_at',
    [id]
  );

  return { ...survey, checklist, photos };
}

/** Upsert checklist items for a survey inside an existing client transaction. */
async function upsertChecklist(
  client: import('pg').PoolClient,
  surveyId: string,
  items: ChecklistItemInput[]
) {
  // Delete existing items first, then re-insert in order
  await client.query('DELETE FROM checklist_items WHERE survey_id = $1', [surveyId]);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await client.query(
      `INSERT INTO checklist_items (survey_id, label, status, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [surveyId, item.label, item.status || 'pending', item.notes || '', i]
    );
  }
}

/** Upsert photos for a survey inside an existing client transaction. */
async function upsertPhotos(
  client: import('pg').PoolClient,
  surveyId: string,
  photos: PhotoInput[]
) {
  await client.query('DELETE FROM survey_photos WHERE survey_id = $1', [surveyId]);
  for (const photo of photos) {
    await client.query(
      `INSERT INTO survey_photos (survey_id, filename, label, data_url, mime_type, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        surveyId,
        photo.filename || null,
        photo.label || null,
        photo.data_url || null,
        photo.mime_type || 'image/jpeg',
        photo.captured_at ? new Date(photo.captured_at) : new Date(),
      ]
    );
  }
}

// ----------------------------------------------------------------
// GET /api/surveys/export/geojson
// ----------------------------------------------------------------
router.get('/export/geojson', async (req: Request, res: Response) => {
  try {
    const { project_id, status, category_id } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) { conditions.push(`s.project_id = $${params.length + 1}`); params.push(project_id); }
    if (status)     { conditions.push(`s.status = $${params.length + 1}`);     params.push(status); }
    if (category_id){ conditions.push(`s.category_id = $${params.length + 1}`); params.push(category_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         s.id, s.project_name, s.category_name, s.inspector_name,
         s.site_name, s.site_address, s.latitude, s.longitude,
         s.gps_accuracy, s.survey_date, s.notes, s.status,
         s.created_at, s.updated_at,
         ST_AsGeoJSON(s.location)::jsonb AS geometry,
         (
           SELECT json_agg(json_build_object(
             'label', c.label, 'status', c.status, 'notes', c.notes
           ) ORDER BY c.sort_order)
           FROM checklist_items c WHERE c.survey_id = s.id
         ) AS checklist
       FROM surveys s
       ${where}
       ORDER BY s.survey_date DESC`,
      params
    );

    const features = rows.map((row) => ({
      type: 'Feature',
      geometry: row.geometry || null,
      properties: {
        id:             row.id,
        project_name:   row.project_name,
        category:       row.category_name,
        inspector:      row.inspector_name,
        site_name:      row.site_name,
        site_address:   row.site_address,
        latitude:       row.latitude,
        longitude:      row.longitude,
        gps_accuracy_m: row.gps_accuracy,
        survey_date:    row.survey_date,
        status:         row.status,
        notes:          row.notes,
        checklist:      row.checklist || [],
        created_at:     row.created_at,
        updated_at:     row.updated_at,
      },
    }));

    const geojson = {
      type: 'FeatureCollection',
      features,
      metadata: {
        exported_at:   new Date().toISOString(),
        total_records: features.length,
        crs: 'EPSG:4326',
      },
    };

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="site_surveys_${Date.now()}.geojson"`
    );
    res.json(geojson);
  } catch (err) {
    console.error('GET /api/surveys/export/geojson error:', err);
    res.status(500).json({ error: 'Failed to export GeoJSON' });
  }
});

// ----------------------------------------------------------------
// GET /api/surveys/export/csv
// ----------------------------------------------------------------
router.get('/export/csv', async (req: Request, res: Response) => {
  try {
    const { project_id, status, category_id } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) { conditions.push(`s.project_id = $${params.length + 1}`); params.push(project_id); }
    if (status)     { conditions.push(`s.status = $${params.length + 1}`);     params.push(status); }
    if (category_id){ conditions.push(`s.category_id = $${params.length + 1}`); params.push(category_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         s.id, s.project_name, s.category_name, s.inspector_name,
         s.site_name, s.site_address,
         s.latitude, s.longitude, s.gps_accuracy,
         s.survey_date, s.notes, s.status,
         s.created_at, s.updated_at
       FROM surveys s
       ${where}
       ORDER BY s.survey_date DESC`,
      params
    );

    if (rows.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="site_surveys.csv"');
      res.send('id,project_name,category,inspector_name,site_name,site_address,latitude,longitude,gps_accuracy_m,survey_date,status,notes,created_at,updated_at\n');
      return;
    }

    const csvData = rows.map((r) => ({
      id:               r.id,
      project_name:     r.project_name,
      category:         r.category_name || '',
      inspector_name:   r.inspector_name,
      site_name:        r.site_name,
      site_address:     r.site_address || '',
      latitude:         r.latitude ?? '',
      longitude:        r.longitude ?? '',
      gps_accuracy_m:   r.gps_accuracy ?? '',
      survey_date:      r.survey_date ? new Date(r.survey_date).toISOString() : '',
      status:           r.status,
      notes:            r.notes || '',
      created_at:       new Date(r.created_at).toISOString(),
      updated_at:       new Date(r.updated_at).toISOString(),
    }));

    const csv = csvStringify(csvData, { header: true });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="site_surveys_${Date.now()}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('GET /api/surveys/export/csv error:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// ----------------------------------------------------------------
// POST /api/surveys/sync  — batch offline sync
// ----------------------------------------------------------------
router.post('/sync', async (req: Request, res: Response) => {
  const { device_id, surveys } = req.body as {
    device_id: string;
    surveys: Array<{ action: 'create' | 'update'; survey: SurveyInput & { id?: string } }>;
  };

  if (!Array.isArray(surveys) || surveys.length === 0) {
    res.status(400).json({ error: 'surveys array is required' });
    return;
  }

  const results: Array<{ id: string; action: string; success: boolean; error?: string }> = [];
  const client = await pool.connect();

  try {
    for (const { action, survey } of surveys) {
      try {
        await client.query('BEGIN');

        if (action === 'create') {
          const surveyId = survey.id || (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;
          const location = survey.latitude != null && survey.longitude != null
            ? `ST_SetSRID(ST_MakePoint($9, $8), 4326)`
            : 'NULL';

          await client.query(
            `INSERT INTO surveys
               (id, project_name, project_id, category_id, category_name,
                inspector_name, site_name, site_address, latitude, longitude,
                gps_accuracy, location, survey_date, notes, status, device_id, synced_at)
             VALUES
               ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                ${location},
                $12,$13,$14,$15,NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              surveyId,
              survey.project_name,
              survey.project_id || null,
              survey.category_id || null,
              survey.category_name || null,
              survey.inspector_name,
              survey.site_name,
              survey.site_address || null,
              survey.latitude ?? null,
              survey.longitude ?? null,
              survey.gps_accuracy ?? null,
              survey.survey_date ? new Date(survey.survey_date) : new Date(),
              survey.notes || null,
              survey.status || 'submitted',
              device_id || survey.device_id || null,
            ]
          );

          if (survey.checklist?.length) await upsertChecklist(client, surveyId, survey.checklist);
          if (survey.photos?.length)    await upsertPhotos(client, surveyId, survey.photos);
          await client.query('COMMIT');
          results.push({ id: surveyId, action: 'created', success: true });

        } else if (action === 'update' && survey.id) {
          const location = survey.latitude != null && survey.longitude != null
            ? `ST_SetSRID(ST_MakePoint($9, $8), 4326)`
            : 'location';

          await client.query(
            `UPDATE surveys SET
               project_name   = $2, project_id   = $3,
               category_id    = $4, category_name = $5,
               inspector_name = $6, site_name     = $7,
               site_address   = $8, latitude      = $9,
               longitude      = $10, gps_accuracy  = $11,
               location       = ${location},
               notes          = $12, status = $13,
               synced_at      = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [
              survey.id,
              survey.project_name,
              survey.project_id || null,
              survey.category_id || null,
              survey.category_name || null,
              survey.inspector_name,
              survey.site_name,
              survey.site_address || null,
              survey.latitude ?? null,
              survey.longitude ?? null,
              survey.gps_accuracy ?? null,
              survey.notes || null,
              survey.status || 'submitted',
            ]
          );

          if (survey.checklist?.length) await upsertChecklist(client, survey.id, survey.checklist);
          if (survey.photos?.length)    await upsertPhotos(client, survey.id, survey.photos);
          await client.query('COMMIT');
          results.push({ id: survey.id, action: 'updated', success: true });
        }

      } catch (err) {
        await client.query('ROLLBACK');
        const id = (survey as { id?: string }).id || 'unknown';
        results.push({ id, action, success: false, error: String(err) });
      }
    }

    res.json({ synced: results.filter(r => r.success).length, results });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------
// GET /api/surveys
// ----------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const { project_id, status, category_id, limit, offset } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (project_id) { conditions.push(`s.project_id = $${params.length + 1}`); params.push(project_id); }
    if (status)     { conditions.push(`s.status = $${params.length + 1}`);     params.push(status); }
    if (category_id){ conditions.push(`s.category_id = $${params.length + 1}`); params.push(category_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim   = Math.min(parseInt(limit  || '100', 10), 500);
    const off   = parseInt(offset || '0', 10);

    params.push(lim, off);

    const { rows } = await pool.query(
      `SELECT
         s.id, s.project_name, s.category_name, s.inspector_name,
         s.site_name, s.site_address, s.latitude, s.longitude,
         s.survey_date, s.status, s.notes, s.created_at, s.updated_at,
         (SELECT COUNT(*)::int FROM checklist_items c WHERE c.survey_id = s.id) AS checklist_count,
         (SELECT COUNT(*)::int FROM survey_photos   p WHERE p.survey_id = s.id) AS photo_count
       FROM surveys s
       ${where}
       ORDER BY s.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM surveys s ${where}`,
      params.slice(0, -2)
    );

    res.json({ surveys: rows, total: countRows[0].total });
  } catch (err) {
    console.error('GET /api/surveys error:', err);
    res.status(500).json({ error: 'Failed to retrieve surveys' });
  }
});

// ----------------------------------------------------------------
// GET /api/surveys/:id
// ----------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const survey = await fetchSurveyFull(req.params.id);
    if (!survey) {
      res.status(404).json({ error: 'Survey not found' });
      return;
    }
    res.json(survey);
  } catch (err) {
    console.error('GET /api/surveys/:id error:', err);
    res.status(500).json({ error: 'Failed to retrieve survey' });
  }
});

// ----------------------------------------------------------------
// POST /api/surveys
// ----------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as SurveyInput & { id?: string };

  if (!body.project_name?.trim() || !body.inspector_name?.trim() || !body.site_name?.trim()) {
    res.status(400).json({ error: 'project_name, inspector_name, and site_name are required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const surveyId = body.id || (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;

    const hasLocation = body.latitude != null && body.longitude != null;
    const locationExpr = hasLocation ? `ST_SetSRID(ST_MakePoint($9, $8), 4326)` : 'NULL';

    const { rows } = await client.query(
      `INSERT INTO surveys
         (id, project_name, project_id, category_id, category_name,
          inspector_name, site_name, site_address, latitude, longitude,
          gps_accuracy, location, survey_date, notes, status, device_id)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${locationExpr},$12,$13,$14,$15)
       RETURNING *`,
      [
        surveyId,
        body.project_name.trim(),
        body.project_id    || null,
        body.category_id   || null,
        body.category_name || null,
        body.inspector_name.trim(),
        body.site_name.trim(),
        body.site_address  || null,
        body.latitude      ?? null,
        body.longitude     ?? null,
        body.gps_accuracy  ?? null,
        body.survey_date ? new Date(body.survey_date) : new Date(),
        body.notes         || null,
        body.status        || 'draft',
        body.device_id     || null,
      ]
    );

    if (body.checklist?.length) await upsertChecklist(client, surveyId, body.checklist);
    if (body.photos?.length)    await upsertPhotos(client, surveyId, body.photos);

    await client.query('COMMIT');

    const full = await fetchSurveyFull(surveyId);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/surveys error:', err);
    res.status(500).json({ error: 'Failed to create survey' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------
// PUT /api/surveys/:id
// ----------------------------------------------------------------
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Partial<SurveyInput>;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check exists
    const { rows: existing } = await client.query('SELECT id FROM surveys WHERE id = $1', [id]);
    if (existing.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Survey not found' });
      return;
    }

    const hasLocation = body.latitude != null && body.longitude != null;
    const locationExpr = hasLocation ? `ST_SetSRID(ST_MakePoint($9, $8), 4326)` : 'location';

    await client.query(
      `UPDATE surveys SET
         project_name   = COALESCE($2, project_name),
         project_id     = COALESCE($3, project_id),
         category_id    = COALESCE($4, category_id),
         category_name  = COALESCE($5, category_name),
         inspector_name = COALESCE($6, inspector_name),
         site_name      = COALESCE($7, site_name),
         site_address   = COALESCE($8, site_address),
         latitude       = COALESCE($9, latitude),
         longitude      = COALESCE($10, longitude),
         gps_accuracy   = COALESCE($11, gps_accuracy),
         location       = ${locationExpr},
         notes          = COALESCE($12, notes),
         status         = COALESCE($13, status),
         updated_at     = NOW()
       WHERE id = $1`,
      [
        id,
        body.project_name    ?? null,
        body.project_id      ?? null,
        body.category_id     ?? null,
        body.category_name   ?? null,
        body.inspector_name  ?? null,
        body.site_name       ?? null,
        body.site_address    ?? null,
        body.latitude        ?? null,
        body.longitude       ?? null,
        body.gps_accuracy    ?? null,
        body.notes           ?? null,
        body.status          ?? null,
      ]
    );

    if (body.checklist?.length) await upsertChecklist(client, id, body.checklist);
    if (body.photos?.length)    await upsertPhotos(client, id, body.photos);

    await client.query('COMMIT');

    const full = await fetchSurveyFull(id);
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/surveys/:id error:', err);
    res.status(500).json({ error: 'Failed to update survey' });
  } finally {
    client.release();
  }
});

export default router;
