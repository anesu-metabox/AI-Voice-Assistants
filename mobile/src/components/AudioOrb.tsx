import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function AudioOrb({ size = 180 }: { size?: number }) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Outer glow ring 3 */}
      <View
        style={[
          styles.glowRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: 'rgba(79,70,229,0.12)',
          },
        ]}
      />
      {/* Glow ring 2 */}
      <View
        style={[
          styles.glowRing,
          {
            width: size * 0.78,
            height: size * 0.78,
            borderRadius: (size * 0.78) / 2,
            backgroundColor: 'rgba(6,182,212,0.18)',
          },
        ]}
      />
      {/* Glow ring 1 */}
      <View
        style={[
          styles.glowRing,
          {
            width: size * 0.58,
            height: size * 0.58,
            borderRadius: (size * 0.58) / 2,
            backgroundColor: 'rgba(59,91,219,0.3)',
          },
        ]}
      />
      {/* Core orb with LinearGradient */}
      <LinearGradient
        colors={['#4F46E5', '#3B5BDB', '#06B6D4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.coreOrb,
          {
            width: size * 0.4,
            height: size * 0.4,
            borderRadius: (size * 0.4) / 2,
          },
        ]}
      >
        <View style={styles.waveformRow}>
          {[8, 14, 10, 16, 11].map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveformBar,
                {
                  height: h,
                },
              ]}
            />
          ))}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
  },
  coreOrb: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
