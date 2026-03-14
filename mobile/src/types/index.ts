// ============================================================
// Shared TypeScript types for the mobile app
// ============================================================

export type SurveyStatus     = 'draft' | 'submitted' | 'synced';
export type SyncStatus       = 'pending' | 'syncing' | 'synced' | 'error';
export type ChecklistStatus  = 'pass' | 'fail' | 'n/a' | 'pending';

// ------------------------------------------------------------------
// Solar installation metadata types
// Stored as JSONB on the server and as JSON text in local SQLite.
// The `type` discriminator matches the category_id slug.
// ------------------------------------------------------------------

export interface GroundMountMetadata {
  type:                'ground_mount';
  soil_type:           'Rocky' | 'Sandy' | 'Clay' | 'Organic/Loam' | null;
  slope_degrees:       number | null;
  trenching_path:      string;
  vegetation_clearing: boolean;
}

export interface RoofMountMetadata {
  type:            'roof_mount';
  roof_material:   'Asphalt Shingle' | 'Metal' | 'Tile' | 'Membrane' | null;
  rafter_size:     '2x4' | '2x6' | '2x8' | null;
  rafter_spacing:  '16in' | '24in' | null;
  roof_age_years:  number | null;
  azimuth:         number | null;
}

export interface SolarFencingMetadata {
  type:                'solar_fencing';
  perimeter_length_ft: number | null;
  lower_shade_risk:    boolean;
  foundation_type:     'Driven Piles' | 'Concrete Footer' | null;
  bifacial_surface:    'Concrete' | 'Gravel' | 'Grass' | 'Dirt' | null;
}

export type SurveyMetadata =
  | GroundMountMetadata
  | RoofMountMetadata
  | SolarFencingMetadata;

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
  /** Category-specific fields — Ground Mount / Roof Mount / Solar Fencing */
  metadata:       SurveyMetadata | null;
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
  // Solar installation categories — trigger category-specific metadata sections
  { id: 'ground_mount',  name: 'Ground Mount' },
  { id: 'roof_mount',    name: 'Roof Mount' },
  { id: 'solar_fencing', name: 'Solar Fencing' },
];
