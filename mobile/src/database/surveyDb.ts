/**
 * database/surveyDb.ts
 *
 * All local SQLite CRUD operations.
 * Uses the expo-sqlite v15 async API exclusively.
 *
 * Every write first goes here — the sync manager reads from
 * here and pushes to the server when a connection is available.
 */
import * as SQLite from 'expo-sqlite';
import { v4 as uuidv4 } from 'uuid';
import type { Survey, ChecklistItem, SurveyPhoto, SurveyFormData, SyncStatus } from '../types';

let _db: SQLite.SQLiteDatabase | null = null;

// ----------------------------------------------------------------
// DB accessor — callers must call initDb() before using this
// ----------------------------------------------------------------
export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialised. Call initDb() first.');
  return _db;
}

export function setDb(db: SQLite.SQLiteDatabase): void {
  _db = db;
}

// ----------------------------------------------------------------
// Row types (raw SQLite rows — nullables come back as null)
// ----------------------------------------------------------------
interface SurveyRow {
  id: string; project_name: string; category_id: string | null;
  category_name: string | null; inspector_name: string;
  site_name: string; site_address: string;
  latitude: number | null; longitude: number | null; gps_accuracy: number | null;
  survey_date: string; notes: string;
  status: string; sync_status: string; sync_error: string | null;
  device_id: string | null; created_at: string; updated_at: string;
}

interface ChecklistRow {
  id: string; survey_id: string; label: string; status: string;
  notes: string; sort_order: number; created_at: string;
}

interface PhotoRow {
  id: string; survey_id: string; file_path: string;
  label: string; mime_type: string; captured_at: string; created_at: string;
}

// ----------------------------------------------------------------
// Mapping helpers
// ----------------------------------------------------------------
function rowToSurvey(r: SurveyRow): Omit<Survey, 'checklist' | 'photos'> {
  return {
    id:             r.id,
    project_name:   r.project_name,
    category_id:    r.category_id,
    category_name:  r.category_name,
    inspector_name: r.inspector_name,
    site_name:      r.site_name,
    site_address:   r.site_address ?? '',
    latitude:       r.latitude,
    longitude:      r.longitude,
    gps_accuracy:   r.gps_accuracy,
    survey_date:    r.survey_date,
    notes:          r.notes ?? '',
    status:         r.status as Survey['status'],
    sync_status:    r.sync_status as SyncStatus,
    sync_error:     r.sync_error,
    device_id:      r.device_id,
    created_at:     r.created_at,
    updated_at:     r.updated_at,
  };
}

function rowToChecklist(r: ChecklistRow): ChecklistItem {
  return { ...r, status: r.status as ChecklistItem['status'] };
}

function rowToPhoto(r: PhotoRow): SurveyPhoto {
  return { ...r };
}

// ----------------------------------------------------------------
// Surveys
// ----------------------------------------------------------------

/** Insert a new survey (and its checklist/photos) as a single transaction. */
export async function createSurvey(data: SurveyFormData, deviceId: string): Promise<Survey> {
  const db = getDb();
  const id        = uuidv4();
  const now       = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO surveys
         (id, project_name, category_id, category_name, inspector_name,
          site_name, site_address, latitude, longitude, gps_accuracy,
          survey_date, notes, status, sync_status, device_id,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        data.project_name,
        data.category_id   ?? null,
        data.category_name ?? null,
        data.inspector_name,
        data.site_name,
        data.site_address  ?? '',
        data.latitude      ?? null,
        data.longitude     ?? null,
        data.gps_accuracy  ?? null,
        data.survey_date   ?? now,
        data.notes         ?? '',
        data.status        ?? 'draft',
        'pending',
        deviceId,
        now,
        now,
      ]
    );

    // Insert checklist items
    for (let i = 0; i < (data.checklist ?? []).length; i++) {
      const item = data.checklist[i];
      await db.runAsync(
        `INSERT INTO checklist_items
           (id, survey_id, label, status, notes, sort_order, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [uuidv4(), id, item.label, item.status, item.notes ?? '', i, now]
      );
    }

    // Insert photos
    for (const photo of data.photos ?? []) {
      await db.runAsync(
        `INSERT INTO survey_photos
           (id, survey_id, file_path, label, mime_type, captured_at, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [
          uuidv4(), id,
          photo.file_path, photo.label ?? '',
          photo.mime_type ?? 'image/jpeg',
          photo.captured_at ?? now, now,
        ]
      );
    }
  });

  return getSurveyById(id) as Promise<Survey>;
}

/** Update survey fields. Resets sync_status to 'pending' so it re-syncs. */
export async function updateSurvey(
  id: string,
  patch: Partial<SurveyFormData>
): Promise<void> {
  const db  = getDb();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE surveys SET
         project_name   = COALESCE(?, project_name),
         category_id    = COALESCE(?, category_id),
         category_name  = COALESCE(?, category_name),
         inspector_name = COALESCE(?, inspector_name),
         site_name      = COALESCE(?, site_name),
         site_address   = COALESCE(?, site_address),
         latitude       = COALESCE(?, latitude),
         longitude      = COALESCE(?, longitude),
         gps_accuracy   = COALESCE(?, gps_accuracy),
         survey_date    = COALESCE(?, survey_date),
         notes          = COALESCE(?, notes),
         status         = COALESCE(?, status),
         sync_status    = 'pending',
         sync_error     = NULL,
         updated_at     = ?
       WHERE id = ?`,
      [
        patch.project_name   ?? null,
        patch.category_id    ?? null,
        patch.category_name  ?? null,
        patch.inspector_name ?? null,
        patch.site_name      ?? null,
        patch.site_address   ?? null,
        patch.latitude       ?? null,
        patch.longitude      ?? null,
        patch.gps_accuracy   ?? null,
        patch.survey_date    ?? null,
        patch.notes          ?? null,
        patch.status         ?? null,
        now,
        id,
      ]
    );

    // Overwrite checklist if provided
    if (patch.checklist !== undefined) {
      await db.runAsync('DELETE FROM checklist_items WHERE survey_id = ?', [id]);
      for (let i = 0; i < patch.checklist.length; i++) {
        const item = patch.checklist[i];
        await db.runAsync(
          `INSERT INTO checklist_items
             (id, survey_id, label, status, notes, sort_order, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          [uuidv4(), id, item.label, item.status, item.notes ?? '', i, now]
        );
      }
    }

    // Overwrite photos if provided
    if (patch.photos !== undefined) {
      await db.runAsync('DELETE FROM survey_photos WHERE survey_id = ?', [id]);
      for (const photo of patch.photos) {
        await db.runAsync(
          `INSERT INTO survey_photos
             (id, survey_id, file_path, label, mime_type, captured_at, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          [
            uuidv4(), id,
            photo.file_path, photo.label ?? '',
            photo.mime_type ?? 'image/jpeg',
            photo.captured_at ?? now, now,
          ]
        );
      }
    }
  });
}

/** Get all surveys ordered by most-recent survey_date first. */
export async function getAllSurveys(): Promise<Omit<Survey, 'checklist' | 'photos'>[]> {
  const db = getDb();
  const rows = await db.getAllAsync<SurveyRow>(
    'SELECT * FROM surveys ORDER BY survey_date DESC, updated_at DESC'
  );
  return rows.map(rowToSurvey);
}

/** Get a single survey with its checklist and photos hydrated. */
export async function getSurveyById(id: string): Promise<Survey | null> {
  const db  = getDb();
  const row = await db.getFirstAsync<SurveyRow>(
    'SELECT * FROM surveys WHERE id = ?',
    [id]
  );
  if (!row) return null;

  const checklist = await db.getAllAsync<ChecklistRow>(
    'SELECT * FROM checklist_items WHERE survey_id = ? ORDER BY sort_order, created_at',
    [id]
  );
  const photos = await db.getAllAsync<PhotoRow>(
    'SELECT * FROM survey_photos WHERE survey_id = ? ORDER BY captured_at',
    [id]
  );

  return {
    ...rowToSurvey(row),
    checklist: checklist.map(rowToChecklist),
    photos:    photos.map(rowToPhoto),
  };
}

/** Count surveys by sync_status. Used by the sync status indicator. */
export async function getSyncCounts(): Promise<{
  pending: number;
  syncing: number;
  synced:  number;
  error:   number;
}> {
  const db = getDb();
  const rows = await db.getAllAsync<{ sync_status: string; count: number }>(
    `SELECT sync_status, COUNT(*) AS count
       FROM surveys
      GROUP BY sync_status`
  );
  const result = { pending: 0, syncing: 0, synced: 0, error: 0 };
  for (const r of rows) {
    const key = r.sync_status as keyof typeof result;
    if (key in result) result[key] = Number(r.count);
  }
  return result;
}

/** Get all surveys that need to be pushed to the server. */
export async function getPendingSurveys(): Promise<Survey[]> {
  const db = getDb();
  const rows = await db.getAllAsync<SurveyRow>(
    `SELECT * FROM surveys
      WHERE sync_status IN ('pending', 'error')
      ORDER BY created_at ASC`
  );
  const surveys: Survey[] = [];
  for (const row of rows) {
    const full = await getSurveyById(row.id);
    if (full) surveys.push(full);
  }
  return surveys;
}

/** Mark a survey as currently being synced. */
export async function setSyncStatus(
  id:          string,
  syncStatus:  SyncStatus,
  errorMsg?:   string
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE surveys
        SET sync_status = ?, sync_error = ?, updated_at = ?
      WHERE id = ?`,
    [syncStatus, errorMsg ?? null, new Date().toISOString(), id]
  );
}

/** Add a photo record linked to an existing survey. */
export async function addPhotoToSurvey(
  surveyId:  string,
  filePath:  string,
  label:     string,
  mimeType:  string = 'image/jpeg'
): Promise<SurveyPhoto> {
  const db  = getDb();
  const now = new Date().toISOString();
  const id  = uuidv4();

  await db.runAsync(
    `INSERT INTO survey_photos
       (id, survey_id, file_path, label, mime_type, captured_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, surveyId, filePath, label, mimeType, now, now]
  );

  // Reset survey sync_status so the new photo gets uploaded
  await db.runAsync(
    `UPDATE surveys SET sync_status = 'pending', updated_at = ? WHERE id = ?`,
    [now, surveyId]
  );

  return { id, survey_id: surveyId, file_path: filePath, label, mime_type: mimeType,
           captured_at: now, created_at: now };
}

/** Delete a photo from a survey. */
export async function deletePhoto(photoId: string, surveyId: string): Promise<void> {
  const db  = getDb();
  const now = new Date().toISOString();
  await db.runAsync('DELETE FROM survey_photos WHERE id = ?', [photoId]);
  await db.runAsync(
    `UPDATE surveys SET sync_status = 'pending', updated_at = ? WHERE id = ?`,
    [now, surveyId]
  );
}

/** Delete a survey and all its children (cascade). */
export async function deleteSurvey(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM surveys WHERE id = ?', [id]);
}
