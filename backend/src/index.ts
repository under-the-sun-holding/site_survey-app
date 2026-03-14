import path from 'path';
import fs   from 'fs';

// Load .env before anything else
if (process.env.NODE_ENV !== 'production') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch { /* dotenv optional */ }
}

import express from 'express';
import cors    from 'cors';
import surveysRouter    from './routes/surveys';
import categoriesRouter from './routes/categories';
import { pool }         from './database';

const app         = express();
const PORT        = parseInt(process.env.PORT || '3001', 10);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ----------------------------------------------------------------
// CORS
// ----------------------------------------------------------------
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:5173,http://localhost:4173,http://localhost:8081'
).split(',').map(o => o.trim());

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ----------------------------------------------------------------
// Body parsing
// ----------------------------------------------------------------
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ----------------------------------------------------------------
// Serve uploaded photos statically
// ----------------------------------------------------------------
app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------------------------------------------------------
// Health check
// ----------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// ----------------------------------------------------------------
// API routes
// ----------------------------------------------------------------
app.use('/api/surveys',    surveysRouter);
app.use('/api/categories', categoriesRouter);

// ----------------------------------------------------------------
// 404
// ----------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ----------------------------------------------------------------
// Start server
// ----------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Site Survey API running on http://localhost:${PORT}`);
    console.log(`Photo uploads served from /uploads`);
  });
}

export default app;
