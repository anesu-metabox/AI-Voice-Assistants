import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import VoxiMascot from '../components/VoxiMascot';

const mascotImg = require('../assets/mascot-1.png');

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

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  return (
    <LinearGradient
      colors={['#EEF2FF', '#F0F4FF', '#F8FAFC']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.container}
    >
      {/* Top logo */}
      <View style={styles.topLogoRow}>
        {/* Soundwave bars */}
        <View style={styles.soundwaveRow}>
          {[10, 16, 22, 16, 11].map((h, i) => (
            <View key={i} style={[styles.soundwaveBar, { height: h }]} />
          ))}
        </View>
        <Image source={mascotImg} style={styles.mascotIcon} />
        <Text style={styles.wordmark}>
          vocalist<Text style={styles.wordmarkSuffix}>.ai</Text>
        </Text>
      </View>

      {/* Mascot — centered */}
      <View style={styles.mascotCenter}>
        <VoxiMascot size={210} animated />
      </View>

      {/* Bottom card */}
      <View style={styles.bottomCard}>
        <Text style={styles.slideHeading}>{SLIDES[0].heading}</Text>
        <Text style={styles.slideBody}>{SLIDES[0].body}</Text>

        {/* Pagination dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  width: i === 0 ? 20 : 8,
                  backgroundColor: i === 0 ? '#3B5BDB' : '#D1D5DB',
                },
              ]}
            />
          ))}
        </View>

        {/* Get Started button */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onDone}
          style={styles.getStartedBtn}
        >
          <Text style={styles.getStartedText}>Get Started</Text>
        </TouchableOpacity>

        {/* Sign in link */}
        <TouchableOpacity activeOpacity={0.7} style={styles.signInBtn}>
          <Text style={styles.signInText}>Sign In to Workspace</Text>
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
    paddingTop: 36,
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
    color: '#1D3461',
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
  bottomCard: {
    backgroundColor: '#FFFFFF',
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
