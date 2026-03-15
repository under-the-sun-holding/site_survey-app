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

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithPassword } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSubmit = useMemo(() => identifier.trim().length > 0 && password.trim().length > 0, [identifier, password]);

  async function handleSignIn() {
    if (!canSubmit || submitting) return;
    setStatus(null);
    setSubmitting(true);
    try {
      await signInWithPassword(identifier.trim(), password);
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Please check your credentials and try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Site Survey</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>

            {status && <StatusBanner type={status.type} message={status.message} />}

            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Email or username"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <PasswordInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
            />

            <TouchableOpacity
              style={[styles.button, (!canSubmit || submitting) && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={!canSubmit || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.linksRow}>
              <TouchableOpacity onPress={() => router.push('/register')}>
                <Text style={styles.linkText}>Create account</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/forgot-password')}>
                <Text style={styles.linkText}>Forgot password</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.hint}>Admin test login: admin / admin123!</Text>
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
  button: {
    height: 46,
    borderRadius: 10,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  linksRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  linkText: { color: '#1d4ed8', fontSize: 13, fontWeight: '600' },
  hint: { marginTop: 14, fontSize: 12, color: '#64748b' },
});
