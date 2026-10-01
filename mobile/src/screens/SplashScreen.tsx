import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import VoxiMascot from '../components/VoxiMascot';
import VocalistLogo from '../components/VocalistLogo';
import { useTheme } from '../context/ThemeContext';



const SLIDES = [
  {
    heading: 'Meet Your AI\nVoice Assistant',
    body: 'Intelligent call handling, Google Calendar scheduling, and voice receptionist tailored for your company.',
  },
  {
    heading: 'Always On,\nAlways Ready',
    body: 'Your AI answers every inbound call 24/7 with the right voice, tone, and knowledge for your brand.',
  },
  {
    heading: 'Set Up in\nMinutes',
    body: "Configure your assistant's name, voice model, greeting, and capabilities — no coding required.",
  },
];

export default function SplashScreen({
  onDone,
  onSignInPress,
}: {
  onDone: () => void;
  onSignInPress?: () => void;
}) {
  const { colors } = useTheme();
  const bgGradient: [string, string, string] = colors.isDark
    ? ['#0B1120', '#101A33', '#0B1120']
    : ['#EEF2FF', '#F3F6FF', '#F4F6FB'];

  return (
    <LinearGradient
      colors={bgGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.container}
    >
      <View style={styles.topLogoRow}>
        <VocalistLogo size={34} />
        <Text style={[styles.wordmark, { color: colors.textHeading }]}>
          vocalist<Text style={{ color: colors.primary }}>.ai</Text>
        </Text>
      </View>

      <View style={styles.mascotCenter}>
        <View
          style={[
            styles.mascotGlow,
            { backgroundColor: colors.isDark ? 'rgba(79,107,255,0.18)' : 'rgba(59,91,219,0.10)' },
          ]}
        />
        <VoxiMascot size={210} animated />
      </View>

      <View
        style={[
          styles.bottomCard,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.slideHeading, { color: colors.textHeading }]}>{SLIDES[0].heading}</Text>
        <Text style={[styles.slideBody, { color: colors.textMuted }]}>{SLIDES[0].body}</Text>

        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  width: i === 0 ? 22 : 8,
                  backgroundColor: i === 0 ? colors.primary : colors.borderLight,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onDone}
          style={[styles.getStartedBtn, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
        >
          <Text style={styles.getStartedText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.7} onPress={onSignInPress || onDone} style={styles.signInBtn}>
          <Text style={[styles.signInText, { color: colors.textMuted }]}>
            Already have an account? <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 56,
  },
  soundwaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
  },
  soundwaveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: '#1D3461',
    opacity: 0.85,
  },
  mascotIcon: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
    borderRadius: 14,
  },
  wordmark: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  wordmarkSuffix: {
    color: '#6B7280',
    fontWeight: '700',
  },
  mascotCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  bottomCard: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 36,
    shadowColor: '#0D1526',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  slideHeading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0D1526',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 30,
  },
  slideBody: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 99,
  },
  getStartedBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: '#3B5BDB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  getStartedText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  signInBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  signInText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94A3B8',
  },
});
