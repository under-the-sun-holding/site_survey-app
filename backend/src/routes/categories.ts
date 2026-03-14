import { Router, Request, Response } from 'express';
import { pool } from '../database';

const router = Router();

// GET /api/categories
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, description, color, created_at FROM categories ORDER BY name'
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
});

// POST /api/categories
router.post('/', async (req: Request, res: Response) => {
  const { name, description, color } = req.body as {
    name: string;
    description?: string;
    color?: string;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Category name is required' });
    return;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO categories (name, description, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, color = EXCLUDED.color
       RETURNING *`,
      [name.trim(), description || null, color || '#1a56db']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

export default router;
