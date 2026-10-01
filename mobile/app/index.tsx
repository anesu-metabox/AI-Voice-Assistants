import React, { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';

const mascotImg = require('../src/assets/mascot-1.png');

export default function IndexPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated, hasCompletedSetup } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      if (hasCompletedSetup) {
        router.replace('/(tabs)');
      } else {
        router.replace('/setup');
      }
    } else {
      router.replace('/splash');
    }
  }, [isLoading, isAuthenticated, hasCompletedSetup, router]);

  // Always show loading while determining auth state
  return (
    <LinearGradient
      colors={['#0D1526', '#111C36', '#090D16']}
      style={styles.loadingContainer}
    >
      <View style={styles.loadingLogoRow}>
        <Image source={mascotImg} style={styles.loadingMascot} />
        <Text style={styles.loadingWordmark}>
          vocalist<Text style={styles.loadingSuffix}>.ai</Text>
        </Text>
      </View>
      <ActivityIndicator size="large" color="#3B5BDB" style={{ marginTop: 24 }} />
      <Text style={styles.loadingText}>Connecting to your workspace…</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingMascot: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  loadingWordmark: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  loadingSuffix: {
    color: '#3B5BDB',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 14,
    letterSpacing: 0.2,
  },
});

