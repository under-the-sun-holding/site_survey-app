import request from 'supertest';
import app from '../index';
import { pool } from '../database';

// Clean up test surveys after each test
const createdIds: string[] = [];

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM surveys WHERE id = ANY($1)', [createdIds]);
  }
  await pool.end();
});

// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
describe('GET /api/health', () => {
  it('returns status ok with database connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Categories
// ----------------------------------------------------------------
describe('GET /api/categories', () => {
  it('returns seeded categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThanOrEqual(6);
    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toContain('Electrical');
    expect(names).toContain('Safety');
  });
});

// ----------------------------------------------------------------
// Surveys CRUD
// ----------------------------------------------------------------
describe('POST /api/surveys', () => {
  it('creates a survey with checklist and returns 201', async () => {
    const payload = {
      project_name:   'Test Project Alpha',
      inspector_name: 'Jane Inspector',
      site_name:      'Test Site 1',
      site_address:   '123 Test Street',
      latitude:       51.5074,
      longitude:      -0.1278,
      gps_accuracy:   5.0,
      notes:          'Integration test survey',
      status:         'draft',
      checklist: [
        { label: 'Site Access',       status: 'pass',    notes: 'OK' },
        { label: 'Power Supply',      status: 'fail',    notes: 'No power' },
        { label: 'Safety Compliance', status: 'pending', notes: '' },
      ],
    };

    const res = await request(app)
      .post('/api/surveys')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.project_name).toBe('Test Project Alpha');
    expect(res.body.inspector_name).toBe('Jane Inspector');
    expect(res.body.latitude).toBeCloseTo(51.5074);
    expect(res.body.longitude).toBeCloseTo(-0.1278);
    expect(Array.isArray(res.body.checklist)).toBe(true);
    expect(res.body.checklist.length).toBe(3);
    expect(res.body.checklist[0].label).toBe('Site Access');
    expect(res.body.checklist[1].status).toBe('fail');

    createdIds.push(res.body.id);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/surveys')
      .send({ notes: 'missing required fields' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('GET /api/surveys', () => {
  it('returns surveys array with total count', async () => {
    const res = await request(app).get('/api/surveys');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.surveys)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/surveys?status=draft');
    expect(res.status).toBe(200);
    res.body.surveys.forEach((s: { status: string }) => {
      expect(s.status).toBe('draft');
    });
  });
});

describe('GET /api/surveys/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/surveys/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns full survey object for known id', async () => {
    // Create one first
    const create = await request(app)
      .post('/api/surveys')
      .send({ project_name: 'Fetch Test', inspector_name: 'Bob', site_name: 'Site X' });
    createdIds.push(create.body.id);

    const res = await request(app).get(`/api/surveys/${create.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.id);
    expect(Array.isArray(res.body.checklist)).toBe(true);
    expect(Array.isArray(res.body.photos)).toBe(true);
  });
});

describe('PUT /api/surveys/:id', () => {
  it('updates a survey status', async () => {
    const create = await request(app)
      .post('/api/surveys')
      .send({ project_name: 'Update Test', inspector_name: 'Alice', site_name: 'Site Y', status: 'draft' });
    createdIds.push(create.body.id);

    const res = await request(app)
      .put(`/api/surveys/${create.body.id}`)
      .send({ status: 'submitted' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/surveys/00000000-0000-0000-0000-000000000000')
      .send({ status: 'submitted' });
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------
// Batch Sync
// ----------------------------------------------------------------
describe('POST /api/surveys/sync', () => {
  it('syncs a batch of offline surveys', async () => {
    const offlineId = '11111111-1111-1111-1111-111111111111';
    createdIds.push(offlineId);

    const res = await request(app)
      .post('/api/surveys/sync')
      .send({
        device_id: 'test-device-001',
        surveys: [
          {
            action: 'create',
            survey: {
              id:             offlineId,
              project_name:   'Offline Sync Project',
              inspector_name: 'Sync Tester',
              site_name:      'Offline Site',
              latitude:       -33.8688,
              longitude:      151.2093,
              status:         'submitted',
              checklist: [
                { label: 'Power', status: 'pass', notes: '' },
              ],
            },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);
    expect(res.body.results[0].success).toBe(true);
    expect(res.body.results[0].action).toBe('created');
  });

  it('returns 400 when surveys array is missing', async () => {
    const res = await request(app)
      .post('/api/surveys/sync')
      .send({ device_id: 'x' });
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// Export endpoints
// ----------------------------------------------------------------
describe('GET /api/surveys/export/geojson', () => {
  it('returns valid GeoJSON FeatureCollection', async () => {
    const res = await request(app).get('/api/surveys/export/geojson');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.metadata.crs).toBe('EPSG:4326');
    // Every feature with a location has lon/lat in geometry
    res.body.features
      .filter((f: { geometry: unknown }) => f.geometry)
      .forEach((f: { geometry: { type: string; coordinates: number[] }; properties: { latitude: number; longitude: number } }) => {
        expect(f.geometry.type).toBe('Point');
        expect(f.geometry.coordinates).toHaveLength(2);
        expect(typeof f.properties.latitude).toBe('number');
      });
  });
});

describe('GET /api/surveys/export/csv', () => {
  it('returns CSV with header row', async () => {
    const res = await request(app).get('/api/surveys/export/csv');
    expect(res.status).toBe(200);
    expect(res.header['content-type']).toMatch(/text\/csv/);
    const lines = (res.text as string).split('\n').filter(Boolean);
    // Header row should exist
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('project_name');
    expect(lines[0]).toContain('latitude');
    expect(lines[0]).toContain('longitude');
    expect(lines[0]).toContain('status');
  });
});
