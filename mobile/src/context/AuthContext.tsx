import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchCurrentUser, forgotPassword, register, resetPassword, signIn, type AuthUser } from '../api/client';

// Bump key version to invalidate stale sessions after auth flow rollout.
const AUTH_TOKEN_KEY = 'site-survey.auth.token.v2';

async function getStoredToken(): Promise<string | null> {
  if (!AsyncStorage || typeof AsyncStorage.getItem !== 'function') {
    return null;
  }

  try {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function setStoredToken(token: string): Promise<void> {
  if (!AsyncStorage || typeof AsyncStorage.setItem !== 'function') {
    return;
  }

  try {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Ignore persistence failures; auth can still proceed in-memory.
  }
}

async function clearStoredToken(): Promise<void> {
  if (!AsyncStorage || typeof AsyncStorage.removeItem !== 'function') {
    return;
  }

  try {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore persistence failures.
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  registerWithPassword: (email: string, password: string, fullName: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ message: string; resetToken?: string; expiresInMinutes?: number }>;
  completePasswordReset: (email: string, token: string, newPassword: string) => Promise<{ message: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await clearStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const savedToken = await getStoredToken();
        if (!savedToken) return;

        const currentUser = await fetchCurrentUser(savedToken);
        if (!mounted) return;
        setToken(savedToken);
        setUser(currentUser);
      } catch {
        await clearStoredToken();
      } finally {
        if (mounted) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const signInWithPassword = useCallback(async (identifier: string, password: string) => {
    const result = await signIn(identifier, password);
    await setStoredToken(result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const registerWithPassword = useCallback(async (email: string, password: string, fullName: string) => {
    const result = await register({ email, password, fullName });
    await setStoredToken(result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const result = await forgotPassword(email);
    return {
      message: result.message,
      resetToken: result.resetToken,
      expiresInMinutes: result.expiresInMinutes,
    };
  }, []);

  const completePasswordReset = useCallback(async (email: string, tokenValue: string, newPassword: string) => {
    return resetPassword(email, tokenValue, newPassword);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      signInWithPassword,
      registerWithPassword,
      requestPasswordReset,
      completePasswordReset,
      signOut,
    }),
    [
      user,
      token,
      loading,
      signInWithPassword,
      registerWithPassword,
      requestPasswordReset,
      completePasswordReset,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
