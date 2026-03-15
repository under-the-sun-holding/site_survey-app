/**
 * Shared helpers for auth forms:
 *  - StatusBanner: inline success / error message replaces Alert.alert
 *  - PasswordInput: TextInput with a show/hide toggle
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

// ----------------------------------------------------------------
// StatusBanner
// ----------------------------------------------------------------
interface StatusBannerProps {
  type: 'success' | 'error';
  message: string;
}

export function StatusBanner({ type, message }: StatusBannerProps) {
  const bannerStyle = type === 'success' ? styles.bannerSuccess : styles.bannerError;
  const textStyle = type === 'success' ? styles.bannerSuccessText : styles.bannerErrorText;
  return (
    <View style={[styles.banner, bannerStyle]}>
      <Text style={textStyle}>{message}</Text>
    </View>
  );
}

// ----------------------------------------------------------------
// PasswordInput
// ----------------------------------------------------------------
type PasswordInputProps = Omit<TextInputProps, 'secureTextEntry'>;

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.pwRow}>
      <TextInput
        {...props}
        secureTextEntry={!visible}
        style={[styles.pwInput, props.style as object | undefined]}
      />
      <TouchableOpacity
        onPress={() => setVisible(v => !v)}
        style={styles.pwToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.pwToggleText}>{visible ? '🙈' : '👁'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------
const styles = StyleSheet.create({
  banner: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  bannerSuccess: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac' },
  bannerError:   { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5' },
  bannerSuccessText: { color: '#15803d', fontSize: 13, fontWeight: '600' },
  bannerErrorText:   { color: '#b91c1c', fontSize: 13, fontWeight: '600' },

  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
    height: 46,
    paddingHorizontal: 12,
  },
  pwInput: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    height: '100%',
    borderWidth: 0,
    marginBottom: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  pwToggle: { paddingLeft: 8 },
  pwToggleText: { fontSize: 16 },
});
