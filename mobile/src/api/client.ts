/**
 * api/client.ts
 *
 * Typed fetch wrappers for the Site Survey backend.
 * In development the server runs on localhost:3001.
 * In production set EXPO_PUBLIC_API_URL in your Expo environment.
 */
import type { Survey, SurveyFormData, ApiSyncResponse, ApiPhotoUploadResponse } from '../types';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'user';
  createdAt: string;
  username?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
}

export interface ForgotPasswordResponse {
  message: string;
  delivery?: 'sent' | 'failed';
  resetToken?: string;
  expiresInMinutes?: number;
}

// ----------------------------------------------------------------
// Engineering Report types (mirrors backend/src/utils/reportGenerator.ts)
// ----------------------------------------------------------------

export type FlagPriority = 'High' | 'Medium' | 'Low';
export type OverallRisk  = 'High' | 'Medium' | 'Low' | 'None';

export interface ReportFlag {
  priority: FlagPriority;
  category: string;
  field?:   string;
  message:  string;
}

export interface ChecklistSummary {
  total:   number;
  pass:    number;
  fail:    number;
  na:      number;
  pending: number;
}

export interface EngineeringReport {
  survey_id:         string;
  project_name:      string;
  site_name:         string;
  site_address:      string | null;
  inspector_name:    string;
  category:          string | null;
  latitude:          number | null;
  longitude:         number | null;
  survey_date:       string;
  generated_at:      string;
  overall_risk:      OverallRisk;
  flags:             ReportFlag[];
  checklist_summary: ChecklistSummary;
  recommendations:   string[];
  metadata:          Record<string, unknown> | null;
}

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3001';

const API_NETWORK_ERROR =
  `Cannot reach API at ${API_URL}. Ensure backend is running and your phone is on the same Wi-Fi as this machine.`;

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
// Authentication
// ----------------------------------------------------------------

export async function signIn(identifier: string, password: string): Promise<AuthResponse> {
  try {
    const res = await fetch(`${API_URL}/api/users/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    return handleResponse<AuthResponse>(res);
  } catch (err) {
    if (err instanceof Error && /^HTTP\s\d+$/.test(err.message)) {
      throw err;
    }
    throw new Error(API_NETWORK_ERROR);
  }
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  try {
    const res = await fetch(`${API_URL}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        full_name: input.fullName,
      }),
    });
    return handleResponse<AuthResponse>(res);
  } catch (err) {
    if (err instanceof Error && /^HTTP\s\d+$/.test(err.message)) {
      throw err;
    }
    throw new Error(API_NETWORK_ERROR);
  }
}

export async function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  const res = await fetch(`${API_URL}/api/users/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse<ForgotPasswordResponse>(res);
}

export async function resetPassword(email: string, token: string, newPassword: string): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/api/users/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, new_password: newPassword }),
  });
  return handleResponse<{ message: string }>(res);
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
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
      /** Category-specific metadata (Ground Mount / Roof Mount / Solar Fencing) */
      metadata:       survey.metadata ?? null,
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

// ----------------------------------------------------------------
// Engineering Report
// ----------------------------------------------------------------

/**
 * GET /api/surveys/:id/report
 * Returns the EngineeringReport JSON for a survey.
 */
export async function fetchReport(surveyId: string): Promise<EngineeringReport> {
  const res = await fetch(`${API_URL}/api/surveys/${surveyId}/report`);
  return handleResponse<EngineeringReport>(res);
}

/**
 * GET /api/surveys/:id/report?format=markdown
 * Downloads the Markdown report text.
 */
export async function downloadReportMarkdown(surveyId: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/surveys/${surveyId}/report?format=markdown`);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.text();
}
