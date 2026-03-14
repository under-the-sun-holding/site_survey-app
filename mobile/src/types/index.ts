// ============================================================
// Shared TypeScript types for the mobile app
// ============================================================

export type SurveyStatus     = 'draft' | 'submitted' | 'synced';
export type SyncStatus       = 'pending' | 'syncing' | 'synced' | 'error';
export type ChecklistStatus  = 'pass' | 'fail' | 'n/a' | 'pending';

// ------------------------------------------------------------------
// Core domain models
// ------------------------------------------------------------------

export interface GpsCoordinates {
  latitude:  number;
  longitude: number;
  accuracy?: number;
}

export interface ChecklistItem {
  id:         string;
  survey_id:  string;
  label:      string;
  status:     ChecklistStatus;
  notes:      string;
  sort_order: number;
  created_at: string;
}

export interface SurveyPhoto {
  id:          string;
  survey_id:   string;
  /** Absolute local path inside the app's document directory */
  file_path:   string;
  label:       string;
  mime_type:   string;
  captured_at: string;
  created_at:  string;
}

export interface Survey {
  id:             string;
  project_name:   string;
  category_id:    string | null;
  category_name:  string | null;
  inspector_name: string;
  site_name:      string;
  site_address:   string;
  latitude:       number | null;
  longitude:      number | null;
  gps_accuracy:   number | null;
  survey_date:    string;
  notes:          string;
  /** Server-facing status */
  status:         SurveyStatus;
  /** Offline-sync tracking status (local only) */
  sync_status:    SyncStatus;
  sync_error:     string | null;
  device_id:      string | null;
  created_at:     string;
  updated_at:     string;
  /** Hydrated relations — populated when loading a full survey */
  checklist:      ChecklistItem[];
  photos:         SurveyPhoto[];
}

export type SurveyFormData = Omit<
  Survey,
  'id' | 'sync_status' | 'sync_error' | 'created_at' | 'updated_at' | 'checklist' | 'photos'
> & {
  checklist: Omit<ChecklistItem, 'id' | 'survey_id' | 'created_at'>[];
  photos:    Omit<SurveyPhoto,   'id' | 'survey_id' | 'created_at'>[];
};

// ------------------------------------------------------------------
// API response shapes
// ------------------------------------------------------------------

export interface ApiSurveyListResponse {
  surveys: Survey[];
  total:   number;
}

export interface ApiSyncResponse {
  synced:  number;
  results: Array<{ id: string; action: string; success: boolean; error?: string }>;
}

export interface ApiPhotoUploadResponse {
  uploaded: number;
  photos:   unknown[];
}

// ------------------------------------------------------------------
// Navigation
// ------------------------------------------------------------------

export type RootStackParamList = {
  Home:      undefined;
  NewSurvey: undefined;
  ViewSurvey: { surveyId: string };
};

// ------------------------------------------------------------------
// Default checklist items for new surveys
// ------------------------------------------------------------------
export const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'id' | 'survey_id' | 'created_at'>[] = [
  { label: 'Site Access',          status: 'pending', notes: '', sort_order: 0 },
  { label: 'Power Supply',         status: 'pending', notes: '', sort_order: 1 },
  { label: 'Network Connectivity', status: 'pending', notes: '', sort_order: 2 },
  { label: 'Safety Compliance',    status: 'pending', notes: '', sort_order: 3 },
  { label: 'Equipment Condition',  status: 'pending', notes: '', sort_order: 4 },
  { label: 'Documentation Review', status: 'pending', notes: '', sort_order: 5 },
];

export const SURVEY_CATEGORIES = [
  { id: '',              name: 'Select category…' },
  { id: 'electrical',   name: 'Electrical' },
  { id: 'structural',   name: 'Structural' },
  { id: 'network',      name: 'Network/Comms' },
  { id: 'environmental',name: 'Environmental' },
  { id: 'safety',       name: 'Safety' },
  { id: 'general',      name: 'General Inspection' },
];
