/**
 * api/client.ts
 *
 * Typed fetch wrappers for the Site Survey backend.
 * In development the server runs on localhost:3001.
 * In production set EXPO_PUBLIC_API_URL in your Expo environment.
 */
import type { Survey, SurveyFormData, ApiSyncResponse, ApiPhotoUploadResponse } from '../types';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3001';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------
// Categories
// ----------------------------------------------------------------

export interface ApiCategory {
  id: string; name: string; description: string | null; color: string;
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  const res = await fetch(`${API_URL}/api/categories`);
  const data = await handleResponse<{ categories: ApiCategory[] }>(res);
  return data.categories;
}

// ----------------------------------------------------------------
// Surveys
// ----------------------------------------------------------------

/** POST a single survey — used for initial create during sync. */
export async function postSurvey(survey: SurveyFormData & { id: string }): Promise<Survey> {
  const res = await fetch(`${API_URL}/api/surveys`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id:             survey.id,
      project_name:   survey.project_name,
      category_id:    survey.category_id,
      category_name:  survey.category_name,
      inspector_name: survey.inspector_name,
      site_name:      survey.site_name,
      site_address:   survey.site_address,
      latitude:       survey.latitude,
      longitude:      survey.longitude,
      gps_accuracy:   survey.gps_accuracy,
      survey_date:    survey.survey_date,
      notes:          survey.notes,
      status:         'submitted',
      device_id:      survey.device_id,
      // Checklist items are sent with the survey for atomic creation
      checklist: (survey.checklist ?? []).map(c => ({
        label:  c.label,
        status: c.status,
        notes:  c.notes,
      })),
    }),
  });
  return handleResponse<Survey>(res);
}

/**
 * POST /api/surveys/:id/photos — multipart/form-data upload.
 * Accepts an array of { uri, label } objects from expo-image-picker.
 */
export async function uploadPhotos(
  surveyId: string,
  photos:   Array<{ uri: string; label: string; mimeType?: string }>
): Promise<ApiPhotoUploadResponse> {
  const form = new FormData();

  const labels: string[] = [];
  for (const photo of photos) {
    // React Native FormData accepts an object with uri/type/name
    form.append('photos', {
      uri:  photo.uri,
      type: photo.mimeType ?? 'image/jpeg',
      name: photo.uri.split('/').pop() ?? 'photo.jpg',
    } as unknown as Blob);
    labels.push(photo.label);
  }
  form.append('labels', JSON.stringify(labels));

  const res = await fetch(`${API_URL}/api/surveys/${surveyId}/photos`, {
    method: 'POST',
    body:   form,
    // Do NOT manually set Content-Type — fetch sets it with the boundary
  });
  return handleResponse<ApiPhotoUploadResponse>(res);
}

/** POST /api/surveys/sync — batch offline sync. */
export async function batchSync(payload: {
  device_id: string;
  surveys:   Array<{ action: 'create' | 'update'; survey: Survey }>;
}): Promise<ApiSyncResponse> {
  const res = await fetch(`${API_URL}/api/surveys/sync`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  return handleResponse<ApiSyncResponse>(res);
}
