import request from "supertest";
import app from "../index";
import { pool } from "../database";

// Clean up test surveys after each test
const createdIds: string[] = [];
let authHeader = "";
let testUserEmail = "";

const getAuth = (path: string) =>
  request(app).get(path).set("Authorization", authHeader);

beforeAll(async () => {
  testUserEmail = `apitest-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;

  const register = await request(app).post("/api/users/register").send({
    full_name: "API Test User",
    email: testUserEmail,
    password: "TestPass123!",
  });

  expect(register.status).toBe(201);
  expect(register.body.token).toBeDefined();

  authHeader = `Bearer ${register.body.token as string}`;
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query("DELETE FROM surveys WHERE id = ANY($1)", [createdIds]);
  }
  if (testUserEmail) {
    await pool.query("DELETE FROM users WHERE email = $1", [testUserEmail]);
  }
  await pool.end();
});

// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
describe("GET /api/health", () => {
  it("returns status ok with database connected", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
    expect(res.body.timestamp).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Users
// ----------------------------------------------------------------
describe("GET /api/users/me", () => {
  it("returns authenticated user profile", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", authHeader);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testUserEmail);
  });

  it("returns 401 without bearer token", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });
});

describe("Auth guard behavior", () => {
  it("blocks protected surveys route without token", async () => {
    const res = await request(app).get("/api/surveys");
    expect(res.status).toBe(401);
  });

  it("blocks protected categories route without token", async () => {
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/users/signin rate limiting", () => {
  it("returns 429 after repeated invalid password attempts", async () => {
    const email = `ratelimit-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;

    const register = await request(app).post("/api/users/register").send({
      full_name: "Rate Limit User",
      email,
      password: "ValidPass123!",
    });

    expect(register.status).toBe(201);

    for (let i = 0; i < 4; i += 1) {
      const fail = await request(app)
        .post("/api/users/signin")
        .send({ email, password: "WrongPass999!" });

      expect(fail.status).toBe(401);
    }

    const locked = await request(app)
      .post("/api/users/signin")
      .send({ email, password: "WrongPass999!" });

    expect(locked.status).toBe(429);
    expect(locked.body.error).toContain("Too many sign-in attempts");

    await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });
});

describe("POST /api/users/signin admin login", () => {
  it("signs in using the seeded admin credentials", async () => {
    const res = await request(app)
      .post("/api/users/signin")
      .send({ identifier: "admin", password: "admin123!" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe("admin");
    expect(res.body.user.role).toBe("admin");
  });
});

describe("POST /api/users/forgot-password and /reset-password", () => {
  it("returns a reset token in non-production mode and accepts password reset", async () => {
    const email = `reset-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
    const initialPassword = "OriginalPass123!";
    const nextPassword = "NewSecurePass456!";

    const register = await request(app).post("/api/users/register").send({
      full_name: "Reset Flow User",
      email,
      password: initialPassword,
    });

    expect(register.status).toBe(201);

    const forgot = await request(app)
      .post("/api/users/forgot-password")
      .send({ email });

    expect(forgot.status).toBe(200);
    expect(typeof forgot.body.message).toBe("string");
    expect(typeof forgot.body.resetToken).toBe("string");

    const reset = await request(app).post("/api/users/reset-password").send({
      email,
      token: forgot.body.resetToken,
      new_password: nextPassword,
    });

    expect(reset.status).toBe(200);

    const signin = await request(app)
      .post("/api/users/signin")
      .send({ identifier: email, password: nextPassword });

    expect(signin.status).toBe(200);
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });
});

describe("POST /api/users/oauth/:provider", () => {
  it("returns 501 for unconfigured supported provider", async () => {
    const res = await request(app).post("/api/users/oauth/google").send({});

    expect(res.status).toBe(501);
    expect(String(res.body.error || "")).toContain("not configured");
  });

  it("returns 400 for unsupported provider", async () => {
    const res = await request(app).post("/api/users/oauth/unknown").send({});

    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// Categories
// ----------------------------------------------------------------
describe("GET /api/categories", () => {
  it("returns seeded categories", async () => {
    const res = await getAuth("/api/categories");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThanOrEqual(6);
    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toContain("Electrical");
    expect(names).toContain("Safety");
  });
});

// ----------------------------------------------------------------
// Surveys CRUD
// ----------------------------------------------------------------
describe("POST /api/surveys", () => {
  it("creates a survey with checklist and returns 201", async () => {
    const payload = {
      project_name: "Test Project Alpha",
      inspector_name: "Jane Inspector",
      site_name: "Test Site 1",
      site_address: "123 Test Street",
      latitude: 51.5074,
      longitude: -0.1278,
      gps_accuracy: 5.0,
      notes: "Integration test survey",
      status: "draft",
      checklist: [
        { label: "Site Access", status: "pass", notes: "OK" },
        { label: "Power Supply", status: "fail", notes: "No power" },
        { label: "Safety Compliance", status: "pending", notes: "" },
      ],
    };

    const res = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.project_name).toBe("Test Project Alpha");
    expect(res.body.inspector_name).toBe("Jane Inspector");
    expect(res.body.latitude).toBeCloseTo(51.5074);
    expect(res.body.longitude).toBeCloseTo(-0.1278);
    expect(Array.isArray(res.body.checklist)).toBe(true);
    expect(res.body.checklist.length).toBe(3);
    expect(res.body.checklist[0].label).toBe("Site Access");
    expect(res.body.checklist[1].status).toBe("fail");

    createdIds.push(res.body.id);
  });

  it("saves and returns solar Ground Mount metadata", async () => {
    const payload = {
      project_name: "Solar Farm Alpha",
      inspector_name: "Bob Solar",
      site_name: "Field B - South",
      category_name: "Ground Mount",
      latitude: 40.7128,
      longitude: -74.006,
      status: "draft",
      metadata: {
        type: "ground_mount",
        soil_type: "Clay",
        slope_degrees: 3.5,
        trenching_path: "Avoid irrigation pipes near NW corner",
        vegetation_clearing: true,
      },
    };

    const res = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body.metadata).toBeDefined();
    expect(res.body.metadata.type).toBe("ground_mount");
    expect(res.body.metadata.soil_type).toBe("Clay");
    expect(res.body.metadata.slope_degrees).toBe(3.5);
    expect(res.body.metadata.vegetation_clearing).toBe(true);
    createdIds.push(res.body.id);
  });

  it("saves and returns Roof Mount metadata", async () => {
    const payload = {
      project_name: "Residential Roof Project",
      inspector_name: "Alice Roofer",
      site_name: "42 Oak Street",
      category_name: "Roof Mount",
      latitude: 34.0522,
      longitude: -118.2437,
      status: "draft",
      metadata: {
        type: "roof_mount",
        roof_material: "Asphalt Shingle",
        rafter_size: "2x6",
        rafter_spacing: "24in",
        roof_age_years: 8,
        azimuth: 185,
      },
    };

    const res = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body.metadata.type).toBe("roof_mount");
    expect(res.body.metadata.roof_material).toBe("Asphalt Shingle");
    expect(res.body.metadata.azimuth).toBe(185);
    createdIds.push(res.body.id);
  });

  it("saves and returns Solar Fencing metadata", async () => {
    const payload = {
      project_name: "Agrivoltaic Project Delta",
      inspector_name: "Carlos Fence",
      site_name: "Paddock 7",
      category_name: "Solar Fencing",
      latitude: 37.7749,
      longitude: -122.4194,
      status: "draft",
      metadata: {
        type: "solar_fencing",
        perimeter_length_ft: 1200,
        lower_shade_risk: false,
        foundation_type: "Driven Piles",
        bifacial_surface: "Gravel",
      },
    };

    const res = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body.metadata.type).toBe("solar_fencing");
    expect(res.body.metadata.perimeter_length_ft).toBe(1200);
    expect(res.body.metadata.foundation_type).toBe("Driven Piles");
    createdIds.push(res.body.id);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({ notes: "missing required fields" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe("POST /api/surveys/validate/solar", () => {
  it("accepts a valid solar survey payload", async () => {
    const res = await request(app)
      .post("/api/surveys/validate/solar")
      .set("Authorization", authHeader)
      .send({
        customerName: "Jordan Solar",
        address: "100 Grid Avenue",
        gpsCoordinates: {
          latitude: 33.749,
          longitude: -84.388,
        },
        pitch: 27,
        azimuth: 185,
        roofType: "shingle",
        mainPanelAmps: 200,
        availableBreakerSlots: 4,
        photoUrls: ["https://example.com/photo-1.jpg"],
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.data.customerName).toBe("Jordan Solar");
    expect(res.body.data.roofType).toBe("shingle");
  });

  it("rejects an invalid solar survey payload with field issues", async () => {
    const res = await request(app)
      .post("/api/surveys/validate/solar")
      .set("Authorization", authHeader)
      .send({
        customerName: "",
        address: "100 Grid Avenue",
        gpsCoordinates: {
          latitude: 120,
          longitude: -84.388,
        },
        pitch: 95,
        azimuth: 420,
        roofType: "slate",
        mainPanelAmps: -1,
        availableBreakerSlots: 1.5,
        photoUrls: ["not-a-url"],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid solar survey payload");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    const paths = res.body.issues.map((issue: { path: string }) => issue.path);
    expect(paths).toContain("customerName");
    expect(paths).toContain("gpsCoordinates.latitude");
    expect(paths).toContain("photoUrls.0");
  });
});

describe("GET /api/surveys", () => {
  it("returns surveys array with total count", async () => {
    const res = await getAuth("/api/surveys");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.surveys)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("filters by status", async () => {
    const res = await getAuth("/api/surveys?status=draft");
    expect(res.status).toBe(200);
    res.body.surveys.forEach((s: { status: string }) => {
      expect(s.status).toBe("draft");
    });
  });
});

describe("GET /api/surveys/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await getAuth(
      "/api/surveys/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  it("returns full survey object for known id", async () => {
    // Create one first
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Fetch Test",
        inspector_name: "Bob",
        site_name: "Site X",
      });
    createdIds.push(create.body.id);

    const res = await getAuth(`/api/surveys/${create.body.id as string}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.id);
    expect(Array.isArray(res.body.checklist)).toBe(true);
    expect(Array.isArray(res.body.photos)).toBe(true);
  });
});

describe("PUT /api/surveys/:id", () => {
  it("updates a survey status", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Update Test",
        inspector_name: "Alice",
        site_name: "Site Y",
        status: "draft",
      });
    createdIds.push(create.body.id);

    const res = await request(app)
      .put(`/api/surveys/${create.body.id as string}`)
      .set("Authorization", authHeader)
      .send({ status: "submitted" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .put("/api/surveys/00000000-0000-0000-0000-000000000000")
      .set("Authorization", authHeader)
      .send({ status: "submitted" });
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------
// Batch Sync
// ----------------------------------------------------------------
describe("POST /api/surveys/sync", () => {
  it("syncs a batch of offline surveys", async () => {
    const offlineId = "11111111-1111-1111-1111-111111111111";
    createdIds.push(offlineId);

    const res = await request(app)
      .post("/api/surveys/sync")
      .set("Authorization", authHeader)
      .send({
        device_id: "test-device-001",
        surveys: [
          {
            action: "create",
            survey: {
              id: offlineId,
              project_name: "Offline Sync Project",
              inspector_name: "Sync Tester",
              site_name: "Offline Site",
              latitude: -33.8688,
              longitude: 151.2093,
              status: "submitted",
              checklist: [{ label: "Power", status: "pass", notes: "" }],
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);
    expect(res.body.results[0].success).toBe(true);
    expect(res.body.results[0].action).toBe("created");
  });

  it("returns 400 when surveys array is missing", async () => {
    const res = await request(app)
      .post("/api/surveys/sync")
      .set("Authorization", authHeader)
      .send({ device_id: "x" });
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// Export endpoints
// ----------------------------------------------------------------
describe("GET /api/surveys/export/geojson", () => {
  it("returns valid GeoJSON FeatureCollection", async () => {
    const res = await getAuth("/api/surveys/export/geojson");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.metadata.crs).toBe("EPSG:4326");
    // Every feature with a location has lon/lat in geometry
    res.body.features
      .filter((f: { geometry: unknown }) => f.geometry)
      .forEach(
        (f: {
          geometry: { type: string; coordinates: number[] };
          properties: {
            latitude: number;
            longitude: number;
            metadata: unknown;
          };
        }) => {
          expect(f.geometry.type).toBe("Point");
          expect(f.geometry.coordinates).toHaveLength(2);
          expect(typeof f.properties.latitude).toBe("number");
        },
      );
    // Features with solar metadata include the metadata property
    const solarFeatures = res.body.features.filter(
      (f: { properties: { metadata?: { type?: string } } }) =>
        f.properties.metadata?.type,
    );
    if (solarFeatures.length > 0) {
      const types = solarFeatures.map(
        (f: { properties: { metadata: { type: string } } }) =>
          f.properties.metadata.type,
      );
      types.forEach((t: string) => {
        expect(["ground_mount", "roof_mount", "solar_fencing"]).toContain(t);
      });
    }
  });
});

describe("GET /api/surveys/export/csv", () => {
  it("returns CSV with header row including metadata columns", async () => {
    const res = await getAuth("/api/surveys/export/csv");
    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).split("\n").filter(Boolean);
    // Header row should exist with base columns
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("project_name");
    expect(lines[0]).toContain("latitude");
    expect(lines[0]).toContain("longitude");
    expect(lines[0]).toContain("status");
    // Solar metadata columns should be present
    expect(lines[0]).toContain("soil_type");
    expect(lines[0]).toContain("roof_material");
    expect(lines[0]).toContain("perimeter_length_ft");
    expect(lines[0]).toContain("metadata_json");
  });

  it("includes flattened metadata fields for Ground Mount surveys", async () => {
    // Create a ground-mount survey
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "CSV Meta Test",
        inspector_name: "Tester",
        site_name: "Field C",
        latitude: 51.0,
        longitude: -1.0,
        metadata: {
          type: "ground_mount",
          soil_type: "Rocky",
          slope_degrees: 4.2,
          trenching_path: "Clear path",
          vegetation_clearing: false,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth("/api/surveys/export/csv");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Rocky");
    expect(res.text).toContain("4.2");
    expect(res.text).toContain("ground_mount");
  });
});

// ----------------------------------------------------------------
// Engineering Assessment Report
// ----------------------------------------------------------------
describe("GET /api/surveys/:id/report", () => {
  it("returns 404 for unknown survey id", async () => {
    const res = await getAuth(
      "/api/surveys/00000000-0000-0000-0000-000000000099/report",
    );
    expect(res.status).toBe(404);
  });

  it("returns a valid EngineeringReport JSON with no flags for a clean survey", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Report Test Clean",
        inspector_name: "Jane",
        site_name: "Clean Site",
        status: "submitted",
        checklist: [
          { label: "Site Access", status: "pass", notes: "" },
          { label: "Safety Check", status: "pass", notes: "" },
        ],
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.survey_id).toBe(create.body.id);
    expect(res.body.overall_risk).toBe("None");
    expect(Array.isArray(res.body.flags)).toBe(true);
    expect(res.body.flags).toHaveLength(0);
    expect(res.body.checklist_summary.pass).toBe(2);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.generated_at).toBeDefined();
  });

  it("flags High priority for old Roof Mount (age > 15)", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Old Roof Report Test",
        inspector_name: "Alice",
        site_name: "Old House",
        category_name: "Roof Mount",
        status: "submitted",
        metadata: {
          type: "roof_mount",
          roof_material: "Asphalt Shingle",
          rafter_size: "2x6",
          rafter_spacing: "16in",
          roof_age_years: 20,
          azimuth: 180,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.overall_risk).toBe("High");
    const flag = res.body.flags.find(
      (f: { field: string }) => f.field === "roof_age_years",
    );
    expect(flag).toBeDefined();
    expect(flag.priority).toBe("High");
  });

  it("flags High priority for Membrane roof material", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Membrane Roof Test",
        inspector_name: "Bob",
        site_name: "Commercial Unit 5",
        category_name: "Roof Mount",
        status: "submitted",
        metadata: {
          type: "roof_mount",
          roof_material: "Membrane",
          rafter_size: "2x8",
          rafter_spacing: "24in",
          roof_age_years: 5,
          azimuth: 200,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.overall_risk).toBe("High");
    const flag = res.body.flags.find(
      (f: { field: string }) => f.field === "roof_material",
    );
    expect(flag).toBeDefined();
    expect(flag.priority).toBe("High");
  });

  it("flags High priority for Rocky soil (Ground Mount)", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Rocky Ground Test",
        inspector_name: "Carlos",
        site_name: "Hill Farm",
        category_name: "Ground Mount",
        status: "submitted",
        metadata: {
          type: "ground_mount",
          soil_type: "Rocky",
          slope_degrees: 5.0,
          trenching_path: "Avoid east berm",
          vegetation_clearing: true,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.overall_risk).toBe("High");
    const flag = res.body.flags.find(
      (f: { field: string }) => f.field === "soil_type",
    );
    expect(flag).toBeDefined();
    expect(flag.priority).toBe("High");
  });

  it("flags High priority when lower_shade_risk is true (Solar Fencing)", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Fencing Shade Test",
        inspector_name: "Diana",
        site_name: "Agri Plot 3",
        category_name: "Solar Fencing",
        status: "submitted",
        metadata: {
          type: "solar_fencing",
          perimeter_length_ft: 800,
          lower_shade_risk: true,
          foundation_type: "Driven Piles",
          bifacial_surface: "Grass",
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.overall_risk).toBe("High");
    const flag = res.body.flags.find(
      (f: { field: string }) => f.field === "lower_shade_risk",
    );
    expect(flag).toBeDefined();
    expect(flag.priority).toBe("High");
  });

  it("flags High priority when Main Service Panel checklist item fails", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Electrical Panel Test",
        inspector_name: "Eve",
        site_name: "Residential Site 7",
        category_name: "Electrical",
        status: "submitted",
        checklist: [
          { label: "Main Service Panel", status: "fail", notes: "Overloaded" },
          { label: "Earthing", status: "pass", notes: "" },
        ],
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.overall_risk).toBe("High");
    const flag = res.body.flags.find(
      (f: { field: string }) => f.field === "checklist:Main Service Panel",
    );
    expect(flag).toBeDefined();
    expect(flag.priority).toBe("High");
    expect(res.body.checklist_summary.fail).toBe(1);
    expect(res.body.checklist_summary.pass).toBe(1);
  });

  it("returns Markdown download when ?format=markdown", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Markdown Report Test",
        inspector_name: "Frank",
        site_name: "Site MD",
        category_name: "Roof Mount",
        status: "submitted",
        metadata: {
          type: "roof_mount",
          roof_material: "Membrane",
          rafter_size: "2x4",
          rafter_spacing: "16in",
          roof_age_years: 18,
          azimuth: 175,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report?format=markdown`,
    );

    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toMatch(/text\/markdown/);
    expect(res.header["content-disposition"]).toMatch(/attachment/);
    expect(res.header["content-disposition"]).toMatch(/\.md/);
    // Markdown should contain core headings
    expect(res.text).toContain("# Engineering Assessment Report");
    expect(res.text).toContain("## Overall Risk");
    expect(res.text).toContain("High");
    expect(res.text).toContain("Membrane");
    expect(res.text).toContain("Markdown Report Test");
  });

  it("accumulates multiple flags on a single survey (old Membrane roof)", async () => {
    const create = await request(app)
      .post("/api/surveys")
      .set("Authorization", authHeader)
      .send({
        project_name: "Double Flag Test",
        inspector_name: "Grace",
        site_name: "Warehouse Roof",
        category_name: "Roof Mount",
        status: "submitted",
        metadata: {
          type: "roof_mount",
          roof_material: "Membrane",
          rafter_size: "2x6",
          rafter_spacing: "24in",
          roof_age_years: 22,
          azimuth: 190,
        },
      });
    createdIds.push(create.body.id);

    const res = await getAuth(
      `/api/surveys/${create.body.id as string}/report`,
    );
    expect(res.status).toBe(200);
    expect(res.body.flags.length).toBeGreaterThanOrEqual(2);
    const fields = res.body.flags.map((f: { field: string }) => f.field);
    expect(fields).toContain("roof_age_years");
    expect(fields).toContain("roof_material");
  });
});
