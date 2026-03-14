import React, { createContext, useContext, useEffect } from 'react';
import { useDatabase } from '../hooks/useDatabase';
import { initSyncManager, teardownSyncManager } from '../services/SyncManager';
import { API_URL } from '../api/client';

interface AppBootstrapValue {
  ready: boolean;
  error: string | null;
  deviceId: string;
}

const AppBootstrapContext = createContext<AppBootstrapValue | null>(null);

export function AppBootstrapProvider({ children }: { children: React.ReactNode }) {
  const { ready, error, deviceId } = useDatabase();

  useEffect(() => {
    console.log(`Connecting to Backend at: ${API_URL}`);
  }, []);

  useEffect(() => {
    if (!ready || !deviceId) return;
    initSyncManager(deviceId).catch(console.error);
    return () => {
      teardownSyncManager();
    };
  }, [ready, deviceId]);

  return (
    <AppBootstrapContext.Provider value={{ ready, error, deviceId }}>
      {children}
    </AppBootstrapContext.Provider>
  );
}

export function useAppBootstrap() {
  const ctx = useContext(AppBootstrapContext);
  if (!ctx) {
    throw new Error('useAppBootstrap must be used inside AppBootstrapProvider');
  }
  return ctx;
}
