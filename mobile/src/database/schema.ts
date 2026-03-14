/**
 * database/schema.ts
 *
 * SQL statements to initialise the local SQLite database.
 * Mirrors the PostgreSQL schema so offline surveys sync cleanly.
 */

export const CREATE_SURVEYS_TABLE = `
  CREATE TABLE IF NOT EXISTS surveys (
    id             TEXT    PRIMARY KEY,
    project_name   TEXT    NOT NULL,
    category_id    TEXT,
    category_name  TEXT,
    inspector_name TEXT    NOT NULL,
    site_name      TEXT    NOT NULL,
    site_address   TEXT    DEFAULT '',
    latitude       REAL,
    longitude      REAL,
    gps_accuracy   REAL,
    survey_date    TEXT    NOT NULL,
    notes          TEXT    DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'draft',
    sync_status    TEXT    NOT NULL DEFAULT 'pending',
    sync_error     TEXT,
    device_id      TEXT,
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
  );
`;

export const CREATE_CHECKLIST_TABLE = `
  CREATE TABLE IF NOT EXISTS checklist_items (
    id         TEXT    PRIMARY KEY,
    survey_id  TEXT    NOT NULL,
    label      TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending',
    notes      TEXT    DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
  );
`;

export const CREATE_PHOTOS_TABLE = `
  CREATE TABLE IF NOT EXISTS survey_photos (
    id          TEXT PRIMARY KEY,
    survey_id   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    label       TEXT DEFAULT '',
    mime_type   TEXT DEFAULT 'image/jpeg',
    captured_at TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
  );
`;

/** Run once at app startup to ensure all tables exist. */
export const INIT_STATEMENTS = [
  'PRAGMA journal_mode = WAL;',
  'PRAGMA foreign_keys = ON;',
  CREATE_SURVEYS_TABLE,
  CREATE_CHECKLIST_TABLE,
  CREATE_PHOTOS_TABLE,
];
