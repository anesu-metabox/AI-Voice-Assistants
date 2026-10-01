import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { apiService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import VocalistLogo from '../components/VocalistLogo';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';

interface SignInScreenProps {
  onSuccess: () => void;
  onBack: () => void;
  initialMode?: 'signin' | 'signup';
}

export default function SignInScreen({ onSuccess, onBack, initialMode = 'signin' }: SignInScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please provide both email and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (mode === 'signin') {
        const res = await apiService.signInEmail(email.trim(), password);
        if (!res.success) {
          setError(res.error || 'Invalid email or password.');
          setBusy(false);
          return;
        }
        const session = await apiService.checkSession();
        if (!session.authenticated) {
          setError('Sign-in succeeded, but the session could not be established. Please retry.');
          return;
        }
        onSuccess();
      } else {
        const res = await apiService.signUpEmail(email.trim(), password, name.trim());
        if (!res.success) {
          setError(res.error || 'Failed to create account.');
          setBusy(false);
          return;
        }
        // Verify that the session is now active
        const session = await apiService.checkSession();
        if (session.authenticated) {
          onSuccess();
        } else {
          setError('Authentication succeeded, but session could not be established. Please retry.');
        }
      }
    } catch (err) {
      setError((err as any)?.message || 'Authentication failed. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.cardSecondary, borderColor: colors.border, color: colors.textHeading },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={onBack}
            style={[styles.backBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.backText, { color: colors.textMuted }]}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.brandRow}>
            <VocalistLogo size={28} />
            <Text style={[styles.brandWordmark, { color: colors.textHeading }]}>
              vocalist<Text style={{ color: colors.primary }}>.ai</Text>
            </Text>
          </View>
        </View>

        <View style={[styles.formCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <Text style={[styles.heading, { color: colors.textHeading }]}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={[styles.subheading, { color: colors.textMuted }]}>
            {mode === 'signin'
              ? 'Sign in to manage your AI voice assistant and live call metrics.'
              : 'Set up your company workspace with Google Calendar sync.'}
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {mode === 'signup' && (
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textBody }]}>Full name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Jane Doe"
                placeholderTextColor={colors.textSubtle}
                style={inputStyle}
                autoCapitalize="words"
                textContentType="name"
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textBody }]}>Work email</Text>
            <TextInput
              value={email}
              onChangeText={(val) => { setEmail(val); setError(null); }}
              placeholder="name@company.com"
              placeholderTextColor={colors.textSubtle}
              style={inputStyle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textBody }]}>Password</Text>
            <View style={[styles.passwordWrap, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
              <TextInput
                value={password}
                onChangeText={(val) => { setPassword(val); setError(null); }}
                placeholder="Minimum 8 characters"
                placeholderTextColor={colors.textSubtle}
                style={[styles.passwordInput, { color: colors.textHeading }]}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={mode === 'signin' ? 'password' : 'newPassword'}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.eyeBtn}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Svg width="22" height="22" viewBox="0 0 24 24">
                  <Path
                    d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                    stroke={colors.textMuted}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <Circle cx="12" cy="12" r="3" stroke={colors.textMuted} strokeWidth="2" fill="none" />
                  {!showPassword && (
                    <Path d="M3 3l18 18" stroke={colors.textMuted} strokeWidth="2" strokeLinecap="round" />
                  )}
                </Svg>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSubmit}
            disabled={busy}
            style={[styles.primaryBtn, { backgroundColor: colors.primary, shadowColor: colors.primary }, busy && styles.btnDisabled]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === 'signin' ? 'Sign in' : 'Create workspace'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
            style={styles.toggleBtn}
          >
            <Text style={[styles.toggleText, { color: colors.primary }]}>
              {mode === 'signin' ? "New here? Create an account" : 'Already registered? Sign in'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 24 }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, justifyContent: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  backBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  backText: { fontSize: 13, fontWeight: '600' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandWordmark: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  formCard: {
    borderRadius: 24, padding: 24, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 6,
  },
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 6, letterSpacing: -0.4 },
  subheading: { fontSize: 13, lineHeight: 19, marginBottom: 22 },
  errorBox: { backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: '#EF4444', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#EF4444', fontSize: 12, lineHeight: 16 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  passwordWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingRight: 12 },
  passwordInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  eyeBtn: { paddingLeft: 8, paddingVertical: 4 },
  primaryBtn: {
    borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  btnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  toggleBtn: { alignItems: 'center', marginTop: 18, paddingVertical: 4 },
  toggleText: { fontSize: 13, fontWeight: '600' },
});
