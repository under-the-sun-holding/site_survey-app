import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { PasswordInput, StatusBanner } from '../components/AuthFormHelpers';
import { API_URL } from '../api/client';

export default function RegisterScreen() {
  const router = useRouter();
  const { registerWithPassword } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const passwordMismatch = password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword;

  const canSubmit = useMemo(() => {
    return (
      fullName.trim().length > 1 &&
      email.trim().length > 3 &&
      password.length >= 8 &&
      confirmPassword.length >= 8 &&
      password === confirmPassword
    );
  }, [confirmPassword, email, fullName, password]);

  async function handleRegister() {
    if (!canSubmit || submitting) return;
    setStatus(null);
    setSubmitting(true);
    try {
      await registerWithPassword(email.trim().toLowerCase(), password, fullName.trim());
      router.replace('/');
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Registration failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Register to start submitting surveys</Text>

            {status && <StatusBanner type={status.type} message={status.message} />}

            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full name"
              placeholderTextColor="#9ca3af"
              style={styles.input}
            />

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />

            <PasswordInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password (min 8 chars)"
              placeholderTextColor="#9ca3af"
            />

            <PasswordInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor="#9ca3af"
            />

            {passwordMismatch && (
              <Text style={styles.fieldError}>Passwords do not match</Text>
            )}

            {password.length > 0 && password.length < 8 && (
              <Text style={styles.fieldError}>Password must be at least 8 characters</Text>
            )}

            <TouchableOpacity
              style={[styles.button, (!canSubmit || submitting) && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={!canSubmit || submitting}
            >
              {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Create Account</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/login')} style={styles.linkRow}>
              <Text style={styles.linkText}>Back to Sign In</Text>
            </TouchableOpacity>
            <Text style={styles.apiHint}>API: {API_URL}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e7eefc' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#dbe3f3',
  },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#475569', marginTop: 6, marginBottom: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    height: 46,
    paddingHorizontal: 12,
    color: '#0f172a',
    marginBottom: 12,
    backgroundColor: '#f8fafc',
  },
  fieldError: { color: '#b91c1c', fontSize: 12, marginBottom: 8, marginTop: -6 },
  button: {
    height: 46,
    borderRadius: 10,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  linkRow: { marginTop: 14, alignItems: 'center' },
  linkText: { color: '#1d4ed8', fontSize: 13, fontWeight: '600' },
  apiHint: { marginTop: 6, fontSize: 11, color: '#94a3b8', textAlign: 'center' },
});
