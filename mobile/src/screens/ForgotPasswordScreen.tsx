import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

const BRAND_PRIMARY = '#6495ed';
const LOGO_URL = 'https://img1.wsimg.com/isteam/ip/b4ef19f7-7f46-446b-bbe2-755512fcd4f8/UNDER%20THE%20SUN%20LOGO.jpg/:/rs=w:300,h:300,m';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset, completePasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [resetDone, setResetDone] = useState(false);

  const canRequest = useMemo(() => email.trim().length > 3, [email]);
  const canReset = useMemo(() => {
    return email.trim().length > 3 && resetToken.trim().length > 5 && newPassword.length >= 8;
  }, [email, newPassword, resetToken]);

  async function handleRequestToken() {
    if (!canRequest || requesting) return;
    setStatus(null);
    setRequesting(true);
    try {
      const result = await requestPasswordReset(email.trim().toLowerCase());
      if (result.resetToken) {
        setResetToken(result.resetToken);
        setStatus({ type: 'success', message: `Token filled in automatically. Expires in ${result.expiresInMinutes ?? 30} minutes.` });
        return;
      }
      setStatus({ type: 'success', message: result.message });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Reset request failed. Please try again.' });
    } finally {
      setRequesting(false);
    }
  }

  async function handleResetPassword() {
    if (!canReset || resetting) return;
    setStatus(null);
    setResetting(true);
    try {
      const result = await completePasswordReset(email.trim().toLowerCase(), resetToken.trim(), newPassword);
      setStatus({ type: 'success', message: result.message });
      setResetDone(true);
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Password reset failed. Please try again.' });
    } finally {
      setResetting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>Request a reset token, then set a new password</Text>

            {status && <StatusBanner type={status.type} message={status.message} />}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Account email"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              editable={!resetDone}
            />

            <TouchableOpacity
              style={[styles.secondaryButton, (!canRequest || requesting || resetDone) && styles.buttonDisabled]}
              onPress={handleRequestToken}
              disabled={!canRequest || requesting || resetDone}
            >
              {requesting ? <ActivityIndicator color="#1d4ed8" /> : <Text style={styles.secondaryButtonText}>Request Reset Token</Text>}
            </TouchableOpacity>

            <TextInput
              value={resetToken}
              onChangeText={setResetToken}
              placeholder="Reset token"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              editable={!resetDone}
            />

            <PasswordInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password (min 8 chars)"
              placeholderTextColor="#9ca3af"
              editable={!resetDone}
            />

            {resetDone ? (
              <TouchableOpacity style={styles.button} onPress={() => router.replace('/login')}>
                <Text style={styles.buttonText}>Go to Sign In</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.button, (!canReset || resetting) && styles.buttonDisabled]}
                onPress={handleResetPassword}
                disabled={!canReset || resetting}
              >
                {resetting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Set New Password</Text>}
              </TouchableOpacity>
            )}

            {!resetDone && (
              <TouchableOpacity onPress={() => router.replace('/login')} style={styles.linkRow}>
                <Text style={styles.linkText}>Back to Sign In</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f2f8ff' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#cfe0fb',
  },
  logo: { width: 170, height: 72, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#1e3a5f', textAlign: 'center' },
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
    backgroundColor: BRAND_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  secondaryButton: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BRAND_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: '#edf4ff',
  },
  secondaryButtonText: { color: BRAND_PRIMARY, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  linkRow: { marginTop: 14, alignItems: 'center' },
  linkText: { color: BRAND_PRIMARY, fontSize: 13, fontWeight: '600' },
});
