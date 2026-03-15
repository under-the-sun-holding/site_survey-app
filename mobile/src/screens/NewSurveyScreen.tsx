/**
 * screens/NewSurveyScreen.tsx
 *
 * Form to create a new site survey.
 *
 * Flow:
 *  1. Fill in project name, category, inspector, site details.
 *  2. Tap "Capture Location" — high-accuracy GPS fix via useLocation hook.
 *     Coordinates are shown to user before saving.
 *  3. Add/edit checklist items.
 *  4. Add photos (camera or library) with optional labels.
 *  5. Tap "Save" → writes to local SQLite first.
 *     SyncManager picks it up and pushes to server when online.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DEFAULT_CHECKLIST, SURVEY_CATEGORIES } from '../types';
import type { SurveyMetadata } from '../types';
import { createSurvey } from '../database/surveyDb';
import { useLocation }   from '../hooks/useLocation';
import GPSCapture        from '../components/GPSCapture';
import ChecklistEditor, { type ChecklistItemDraft } from '../components/ChecklistEditor';
import PhotoCapture,     { type PhotoDraft }        from '../components/PhotoCapture';
import SolarMetadataForm from '../components/SolarMetadataForm';
import { useAppBootstrap } from '../context/AppBootstrapContext';

export default function NewSurveyScreen() {
  const router = useRouter();
  const { deviceId } = useAppBootstrap();
  // ── Form state ────────────────────────────────────────────────
  const [projectName,    setProjectName]    = useState('');
  const [categoryIdx,    setCategoryIdx]    = useState(0);
  const [inspectorName,  setInspectorName]  = useState('');
  const [siteName,       setSiteName]       = useState('');
  const [siteAddress,    setSiteAddress]    = useState('');
  const [notes,          setNotes]          = useState('');
  const [surveyDate,     setSurveyDate]     = useState(
    new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
  );
  const [checklist, setChecklist] = useState<ChecklistItemDraft[]>(
    DEFAULT_CHECKLIST.map(d => ({ label: d.label, status: d.status, notes: d.notes }))
  );
  const [photos,    setPhotos]    = useState<PhotoDraft[]>([]);
  // Solar installation metadata — populated conditionally by SolarMetadataForm
  const [metadata,  setMetadata]  = useState<SurveyMetadata | null>(null);
  const [saving,    setSaving]    = useState(false);

  // ── GPS ───────────────────────────────────────────────────────
  const gps = useLocation();

  // ── Validation ────────────────────────────────────────────────
  function validate(): string | null {
    if (!projectName.trim()) return 'Project name is required.';
    if (!inspectorName.trim()) return 'Inspector name is required.';
    if (!siteName.trim()) return 'Site name is required.';
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────
  async function handleSave() {
    const err = validate();
    if (err) { Alert.alert('Validation Error', err); return; }

    setSaving(true);
    try {
      const category = SURVEY_CATEGORIES[categoryIdx];
      await createSurvey(
        {
          project_name:   projectName.trim(),
          category_id:    category.id || null,
          category_name:  category.id ? category.name : null,
          inspector_name: inspectorName.trim(),
          site_name:      siteName.trim(),
          site_address:   siteAddress.trim(),
          latitude:       gps.coordinates?.latitude  ?? null,
          longitude:      gps.coordinates?.longitude ?? null,
          gps_accuracy:   gps.coordinates?.accuracy  ?? null,
          survey_date:    new Date(surveyDate).toISOString(),
          notes:          notes.trim(),
          status:         'draft',
          device_id:      deviceId,
          metadata:       metadata,
          checklist:      checklist.map((c, i) => ({ ...c, sort_order: i })),
          photos:         photos.map((p, i) => ({
            file_path:   p.uri,
            label:       p.label,
            mime_type:   p.mimeType,
            captured_at: new Date().toISOString(),
            sort_order:  i,
          })),
        },
        deviceId
      );
      router.back();
    } catch (saveErr) {
      Alert.alert('Save Error', saveErr instanceof Error ? saveErr.message : String(saveErr));
    } finally {
      setSaving(false);
    }
  }

  // ── UI ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Project Details ─────────────────────── */}
          <Text style={styles.sectionTitle}>Project Details</Text>

          <Text style={styles.label}>Project Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Downtown Tower Survey"
            placeholderTextColor="#9ca3af"
            value={projectName}
            onChangeText={setProjectName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryRow}>
            {SURVEY_CATEGORIES.slice(1).map((cat, idx) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.catBtn,
                  categoryIdx === idx + 1 && styles.catBtnActive,
                ]}
                onPress={() => {
                  setCategoryIdx(idx + 1);
                  // Clear metadata when switching away from a solar category
                  const isSolar = ['ground_mount', 'roof_mount', 'solar_fencing'].includes(cat.id);
                  if (!isSolar) setMetadata(null);
                }}
              >
                <Text
                  style={[
                    styles.catBtnText,
                    categoryIdx === idx + 1 && styles.catBtnTextActive,
                  ]}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Inspector ───────────────────────────── */}
          <Text style={styles.sectionTitle}>Inspector</Text>

          <Text style={styles.label}>Inspector Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Jane Smith"
            placeholderTextColor="#9ca3af"
            value={inspectorName}
            onChangeText={setInspectorName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Survey Date & Time</Text>
          <TextInput
            style={styles.input}
            value={surveyDate}
            onChangeText={setSurveyDate}
            placeholder="YYYY-MM-DDTHH:mm"
            placeholderTextColor="#9ca3af"
          />

          {/* ── Site ────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Site Information</Text>

          <Text style={styles.label}>Site Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Unit 4B, North Campus"
            placeholderTextColor="#9ca3af"
            value={siteName}
            onChangeText={setSiteName}
          />

          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 123 Main Street, City"
            placeholderTextColor="#9ca3af"
            value={siteAddress}
            onChangeText={setSiteAddress}
          />

          {/* ── GPS ─────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Location</Text>
          <GPSCapture
            coordinates={gps.coordinates}
            status={gps.status}
            errorMsg={gps.errorMsg}
            onCapture={gps.capture}
            onClear={gps.clear}
          />

          {/* ── Notes ───────────────────────────────── */}
          <Text style={styles.sectionTitle}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Any observations or additional context…"
            placeholderTextColor="#9ca3af"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
          />

          {/* ── Solar Metadata (conditional) ────────── */}
          {['ground_mount', 'roof_mount', 'solar_fencing'].includes(
            SURVEY_CATEGORIES[categoryIdx]?.id ?? ''
          ) && (
            <>
              <Text style={styles.sectionTitle}>
                {SURVEY_CATEGORIES[categoryIdx].name} Specifications
              </Text>
              <SolarMetadataForm
                categoryId={SURVEY_CATEGORIES[categoryIdx].id}
                metadata={metadata}
                onChange={setMetadata}
              />
            </>
          )}

          {/* ── Checklist ───────────────────────────── */}
          <ChecklistEditor items={checklist} onChange={setChecklist} />

          {/* ── Photos ──────────────────────────────── */}
          <PhotoCapture photos={photos} onChange={setPhotos} />

          {/* ── Actions ─────────────────────────────── */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => router.back()}
              disabled={saving}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={styles.saveBtnText}>Save Survey</Text>
              }
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f0f4ff' },
  scroll:  { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize:     17,
    fontWeight:   '800',
    color:        '#111827',
    marginTop:    20,
    marginBottom:  10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom:  6,
  },
  label:  { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    backgroundColor: '#ffffff',
    borderWidth:     1,
    borderColor:     '#d1d5db',
    borderRadius:    10,
    paddingHorizontal: 14,
    paddingVertical:   12,
    fontSize:        15,
    color:           '#111827',
    marginBottom:    12,
    minHeight:       48,
  },
  textArea:    { height: 100, textAlignVertical: 'top' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  catBtn: {
    paddingHorizontal: 12,
    paddingVertical:    7,
    borderRadius:      20,
    borderWidth:       1.5,
    borderColor:       '#d1d5db',
    backgroundColor:   '#ffffff',
    minHeight:         36,
    justifyContent:    'center',
  },
  catBtnActive:     { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  catBtnText:       { fontSize: 13, color: '#374151', fontWeight: '600' },
  catBtnTextActive: { color: '#ffffff' },
  actionRow: {
    flexDirection: 'row',
    gap:            12,
    marginTop:      20,
  },
  cancelBtn: {
    flex:            1,
    paddingVertical: 15,
    borderRadius:    12,
    alignItems:      'center',
    backgroundColor: '#f3f4f6',
    borderWidth:     1,
    borderColor:     '#d1d5db',
    minHeight:       52,
    justifyContent:  'center',
  },
  cancelBtnText:   { color: '#374151', fontWeight: '700', fontSize: 16 },
  saveBtn: {
    flex:            2,
    paddingVertical: 15,
    borderRadius:    12,
    alignItems:      'center',
    backgroundColor: '#1a56db',
    minHeight:       52,
    justifyContent:  'center',
  },
  saveBtnDisabled: { backgroundColor: '#93c5fd' },
  saveBtnText:     { color: '#ffffff', fontWeight: '700', fontSize: 16 },
});
