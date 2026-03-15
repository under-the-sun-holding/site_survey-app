import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppBootstrapProvider, useAppBootstrap } from '../src/context/AppBootstrapContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { ready, error } = useAppBootstrap();

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
        <Text style={styles.loadingText}>Initialising...</Text>
      </View>
    );
  }

  return <>{children}</>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  React.useEffect(() => {
    if (loading) return;

    const authRoutes = new Set(['/login', '/register', '/forgot-password']);
    const onAuthRoute = authRoutes.has(pathname);

    if (!user && !onAuthRoute) {
      router.replace('/login');
      return;
    }

    if (user && onAuthRoute) {
      router.replace('/');
    }
  }, [loading, pathname, router, user]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a56db" />
        <Text style={styles.loadingText}>Checking session...</Text>
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AppBootstrapProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <BootstrapGate>
          <AuthGate>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: '#1a56db' },
                headerTintColor: '#ffffff',
                headerTitleStyle: { fontWeight: '700', fontSize: 18 },
                contentStyle: { backgroundColor: '#f0f4ff' },
              }}
            >
              <Stack.Screen name="index" options={{ title: 'Site Surveys', headerShown: false }} />
              <Stack.Screen name="login" options={{ title: 'Sign In', headerShown: false }} />
              <Stack.Screen name="register" options={{ title: 'Create Account', headerShown: false }} />
              <Stack.Screen name="forgot-password" options={{ title: 'Reset Password', headerShown: false }} />
              <Stack.Screen name="new-survey" options={{ title: 'New Survey', headerShown: true }} />
              <Stack.Screen name="survey/[id]" options={{ title: 'Survey Details', headerShown: true }} />
            </Stack>
          </AuthGate>
        </BootstrapGate>
      </AuthProvider>
    </AppBootstrapProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f4ff',
    padding: 24,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#dc2626', marginBottom: 8 },
  errorMsg: { fontSize: 14, color: '#374151', textAlign: 'center' },
  loadingText: { fontSize: 14, color: '#6b7280', marginTop: 12 },
});
