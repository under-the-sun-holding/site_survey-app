/**
 * screens/HomeScreen.tsx
 *
 * Main landing screen — survey list with:
 *  • SyncStatusBar at the top (pending count + online/offline state)
 *  • Export GeoJSON button → downloads file and opens system Share sheet
 *  • Survey cards sorted by most-recent date
 *  • FAB to create a new survey
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  Alert, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing   from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Survey } from '../types';
import { getAllSurveys } from '../database/surveyDb';
import { useSyncManager } from '../hooks/useSyncManager';
import { API_URL }         from '../api/client';
import SyncStatusBar       from '../components/SyncStatusBar';
import SurveyCard          from '../components/SurveyCard';
import { useAppBootstrap } from '../context/AppBootstrapContext';
import { useAuth }         from '../context/AuthContext';

export default function HomeScreen() {
  const router = useRouter();
  const { ready: dbReady } = useAppBootstrap();
  const { signOut } = useAuth();
  const [surveys,      setSurveys]      = useState<Omit<Survey, 'checklist' | 'photos'>[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [exporting,    setExporting]    = useState(false);

  const sync = useSyncManager(dbReady);

  // ----------------------------------------------------------------
  // Load surveys from local SQLite
  // ----------------------------------------------------------------
  const loadSurveys = useCallback(async () => {
    if (!dbReady) return;
    try {
      const rows = await getAllSurveys();
      setSurveys(rows);
    } catch (err) {
      console.error('HomeScreen loadSurveys:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dbReady]);

  useEffect(() => {
    loadSurveys();
  }, [loadSurveys]);

  // Reload when the screen is navigated back to
  useFocusEffect(
    useCallback(() => {
      loadSurveys();
    }, [loadSurveys])
  );

  // ----------------------------------------------------------------
  // Export GeoJSON — download from server, share via system sheet
  // ----------------------------------------------------------------
  const handleExportGeoJSON = useCallback(async () => {
    if (!sync.isOnline) {
      Alert.alert('Offline', 'Connect to the internet to export GeoJSON.');
      return;
    }

    setExporting(true);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing Unavailable', 'File sharing is not available on this device.');
        return;
      }

      const filename   = `site_surveys_${Date.now()}.geojson`;
      const destUri    = `${FileSystem.documentDirectory}${filename}`;

      // Download the GeoJSON from the backend
      const download = await FileSystem.downloadAsync(
        `${API_URL}/api/surveys/export/geojson`,
        destUri
      );

      if (download.status !== 200) {
        throw new Error(`Server returned ${download.status}`);
      }

      // Open the system share sheet (email, cloud storage, AirDrop, etc.)
      await Sharing.shareAsync(download.uri, {
        mimeType:    'application/geo+json',
        dialogTitle: 'Share Site Survey GeoJSON',
        UTI:         'public.json',
      });
    } catch (err) {
      Alert.alert(
        'Export Failed',
        err instanceof Error ? err.message : 'Could not export surveys.'
      );
    } finally {
      setExporting(false);
    }
  }, [sync.isOnline]);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  if (!dbReady || loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#1a56db" />
        <Text style={styles.loadingText}>Loading surveys…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Sync status banner */}
      <SyncStatusBar
        isOnline={sync.isOnline}
        pendingCount={sync.pending}
        syncingCount={sync.syncing}
        errorCount={sync.error}
        onSyncPress={sync.triggerSync}
      />

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.title}>Site Surveys</Text>
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            style={[styles.exportBtn, (!sync.isOnline || exporting) && styles.exportBtnDisabled]}
            onPress={handleExportGeoJSON}
            disabled={!sync.isOnline || exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text style={styles.exportBtnText}>⬇ GeoJSON</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={() => { signOut().catch(console.error); }}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Survey list */}
      <FlatList
        data={surveys}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadSurveys(); }}
            tintColor="#1a56db"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No surveys yet</Text>
            <Text style={styles.emptySubtitle}>Tap + to create your first site survey</Text>
          </View>
        }
        renderItem={({ item }) => (
          <SurveyCard
            survey={item}
            onPress={() => router.push({ pathname: '/survey/[id]', params: { id: item.id } })}
          />
        )}
      />

      {/* Floating action button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/new-survey')}
        accessibilityLabel="New survey"
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#f0f4ff' },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f4ff' },
  loadingText:  { marginTop: 12, color: '#6b7280', fontSize: 14 },
  toolbar: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor:   '#ffffff',
    borderBottomWidth:  1,
    borderBottomColor: '#e5e7eb',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  exportBtn: {
    backgroundColor: '#1a56db',
    paddingHorizontal: 14,
    paddingVertical:    8,
    borderRadius:       8,
    minHeight:         36,
    justifyContent:    'center',
    minWidth:          90,
    alignItems:        'center',
  },
  exportBtnDisabled: { backgroundColor: '#93c5fd' },
  exportBtnText:     { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  logoutBtn: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    minHeight: 36,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: { color: '#1f2937', fontSize: 13, fontWeight: '700' },
  list:              { padding: 16, paddingBottom: 80 },
  empty: {
    alignItems:  'center',
    paddingTop:   80,
    paddingHorizontal: 32,
  },
  emptyIcon:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:    { fontSize: 20, fontWeight: '700', color: '#374151', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 8 },
  fab: {
    position:        'absolute',
    bottom:           24,
    right:            24,
    width:            60,
    height:           60,
    borderRadius:     30,
    backgroundColor: '#1a56db',
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     '#1a56db',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.4,
    shadowRadius:    8,
    elevation:       6,
  },
  fabText: { color: '#ffffff', fontSize: 30, lineHeight: 34, fontWeight: '300' },
});
