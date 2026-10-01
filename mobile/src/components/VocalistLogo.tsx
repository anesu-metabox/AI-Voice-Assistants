import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from 'react-native-svg';

/** Modern vector logo mark: gradient rounded square with a voice-wave. Scales crisply. */
export default function VocalistLogo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="vlg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5B7CFF" />
          <Stop offset="1" stopColor="#7C3AED" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="18" fill="url(#vlg)" />
      <Path
        d="M14 32v0M21 25v14M28 18v28M36 22v20M43 27v10M50 31v2"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
