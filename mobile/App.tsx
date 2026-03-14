/**
 * App.tsx — Root entry point for the Site Survey mobile app.
 *
 * Responsibilities:
 *  1. Initialise the local SQLite database (useDatabase hook)
 *  2. Start the SyncManager (watches network + auto-syncs on reconnect)
 *  3. Mount the navigation stack once the DB is ready
 */
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar }  from 'expo-status-bar';
import { useDatabase } from './src/hooks/useDatabase';
import { initSyncManager, teardownSyncManager } from './src/services/SyncManager';
import AppNavigator   from './src/navigation/AppNavigator';
import { API_URL }    from './src/api/client';

export default function App() {
  const { ready, error, deviceId } = useDatabase();

  // Log the backend URL at startup so developers can verify the IP is correct
  // when opening the app in Expo Go. Visible in the Metro bundler terminal.
  useEffect(() => {
    console.log(`Connecting to Backend at: ${API_URL}`);
  }, []);

  // Initialise the background sync manager once the DB is ready
  useEffect(() => {
    if (!ready) return;
    initSyncManager(deviceId).catch(console.error);
    return () => { teardownSyncManager(); };
  }, [ready, deviceId]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Database Error</Text>
        <Text style={styles.errorMsg}>{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a56db" />
        <Text style={styles.loadingText}>Initialising…</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <AppNavigator dbReady={ready} deviceId={deviceId} />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f0f4ff', padding: 24,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#dc2626', marginBottom: 8 },
  errorMsg:   { fontSize: 14, color: '#374151', textAlign: 'center' },
  loadingText:{ fontSize: 14, color: '#6b7280', marginTop: 12 },
});
