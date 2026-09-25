import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Line, G, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

export interface DayActivity {
  day: string;
  calls: number;
}

interface BarChartProps {
  data?: DayActivity[];
}

const DEFAULT_DATA: DayActivity[] = [
  { day: 'Mon', calls: 0 },
  { day: 'Tue', calls: 0 },
  { day: 'Wed', calls: 0 },
  { day: 'Thu', calls: 0 },
  { day: 'Fri', calls: 0 },
  { day: 'Sat', calls: 0 },
  { day: 'Sun', calls: 0 },
];

export default function BarChart({ data = DEFAULT_DATA }: BarChartProps) {
  const { colors } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.calls));
  const hasActivity = data.some((d) => d.calls > 0);
  const chartH = 80;
  const barW = 26;
  const gap = 10;
  const totalW = data.length * (barW + gap) - gap;
  const todayIdx = (new Date().getDay() + 6) % 7; // Map Sunday=0 to index 6, Monday=1 to index 0

  return (
    <View style={styles.container}>
      <Svg width="100%" height={chartH + 32} viewBox={`0 0 ${totalW + 12} ${chartH + 32}`}>
        <Defs>
          <LinearGradient id="barGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#4F46E5" />
            <Stop offset="100%" stopColor="#3B5BDB" stopOpacity="0.7" />
          </LinearGradient>
          <LinearGradient id="barGradActive" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#06B6D4" />
            <Stop offset="100%" stopColor="#4F46E5" />
          </LinearGradient>
        </Defs>

        {/* Y-axis grid lines */}
        {[0, 0.33, 0.66, 1].map((frac, i) => (
          <Line
            key={i}
            x1="4"
            y1={chartH - frac * chartH}
            x2={totalW + 8}
            y2={chartH - frac * chartH}
            stroke={colors.border}
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ))}

        {data.map((d, i) => {
          const x = 6 + i * (barW + gap);
          const barH = hasActivity && d.calls > 0 ? Math.max(6, (d.calls / max) * chartH) : 4;
          const y = chartH - barH;
          const isActive = i === todayIdx;

          return (
            <G key={d.day}>
              <Rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={hasActivity && d.calls > 0 ? 6 : 2}
                ry={hasActivity && d.calls > 0 ? 6 : 2}
                fill={
                  hasActivity && d.calls > 0
                    ? isActive
                      ? 'url(#barGradActive)'
                      : 'url(#barGrad)'
                    : colors.border
                }
                opacity={isActive ? 1 : 0.6}
              />
              <SvgText
                x={x + barW / 2}
                y={chartH + 16}
                textAnchor="middle"
                fontSize="9"
                fontWeight={isActive ? '600' : '400'}
                fill={isActive ? '#3B5BDB' : '#94A3B8'}
              >
                {d.day}
              </SvgText>
              {isActive && d.calls > 0 && (
                <SvgText
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="#3B5BDB"
                >
                  {d.calls}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
