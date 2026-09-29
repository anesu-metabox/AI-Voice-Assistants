import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

const mascot1 = require('../assets/mascot-1.png');
const mascot2 = require('../assets/mascot-2.png');

interface VoxiMascotProps {
  size?: number;
  animated?: boolean;
  variant?: 1 | 2;
  showHalo?: boolean;
}

export default function VoxiMascot({
  size = 200,
  animated = false,
  variant = 1,
  showHalo = true,
}: VoxiMascotProps) {
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const haloAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!animated) return;

    // Smooth floating animation
    const floating = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -10,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // Subtle scale breathing animation
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // Ambient glow pulsing
    const haloGlow = Animated.loop(
      Animated.sequence([
        Animated.timing(haloAnim, {
          toValue: 0.9,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(haloAnim, {
          toValue: 0.5,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    floating.start();
    breathing.start();
    haloGlow.start();

    return () => {
      floating.stop();
      breathing.stop();
      haloGlow.stop();
    };
  }, [animated, floatAnim, pulseAnim, haloAnim]);

  const source = variant === 2 ? mascot2 : mascot1;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Ambient Neon Cyan Halo Glow */}
      {showHalo && (
        <Animated.View
          style={[
            styles.haloGlow,
            {
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: (size * 0.9) / 2,
              opacity: animated ? haloAnim : 0.65,
            },
          ]}
        />
      )}

      {/* Floating Animated Mascot Character */}
      <Animated.View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [
            { translateY: animated ? floatAnim : 0 },
            { scale: animated ? pulseAnim : 1 },
          ],
        }}
      >
        <Image
          source={source}
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.2,
            resizeMode: 'contain',
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  haloGlow: {
    position: 'absolute',
    backgroundColor: 'rgba(6, 182, 212, 0.22)',
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 28,
  },
});
