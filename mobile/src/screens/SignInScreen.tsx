import React, { useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { apiService } from '../services/api';

const mascotImg = require('../assets/mascot-1.png');

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
  const [busy, setBusy] = useState(false);
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

  return (
    <LinearGradient
      colors={['#0D1526', '#111C36', '#0D1526']}
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Top navigation row */}
          <View style={styles.navRow}>
            <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            
            <View style={styles.brandRow}>
              <Image source={mascotImg} style={styles.brandLogo} />
              <Text style={styles.brandWordmark}>
                vocalist<Text style={styles.brandSuffix}>.ai</Text>
              </Text>
            </View>
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.heading}>
              {mode === 'signin' ? 'Sign In to Workspace' : 'Create an Account'}
            </Text>
            <Text style={styles.subheading}>
              {mode === 'signin'
                ? 'Access your company’s AI voice assistant and live call metrics.'
                : 'Set up an isolated company workspace with Google Calendar sync.'}
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {mode === 'signup' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#64748B"
                  style={styles.input}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Work Email</Text>
              <TextInput
                value={email}
                onChangeText={(val) => { setEmail(val); setError(null); }}
                placeholder="name@company.com"
                placeholderTextColor="#64748B"
                style={styles.input}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={(val) => { setPassword(val); setError(null); }}
                placeholder="Minimum 8 characters"
                placeholderTextColor="#64748B"
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            {/* Primary Action Button */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleSubmit}
              disabled={busy}
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {mode === 'signin' ? 'Sign In' : 'Create Workspace'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Toggle Mode */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
              }}
              style={styles.toggleBtn}
            >
              <Text style={styles.toggleText}>
                {mode === 'signin'
                  ? "Don't have a workspace? Create an account"
                  : 'Already registered? Sign in'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 36,
    justifyContent: 'center',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  backText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  brandWordmark: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  brandSuffix: {
    color: '#3B5BDB',
  },
  formCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  subheading: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: '#3B5BDB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.65,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleBtn: {
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 4,
  },
  toggleText: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '500',
  },
});
