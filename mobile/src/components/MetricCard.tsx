import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: string;
  trendUp?: boolean;
  statusPill?: { text: string; color: string };
  icon: React.ReactNode;
  accent?: string;
}

export default function MetricCard({
  label,
  value,
  sub,
  trend,
  trendUp,
  statusPill,
  icon,
  accent = '#3B5BDB',
}: MetricCardProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBg,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: `${accent}18` }]}>{icon}</View>
        {statusPill && (
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: `${statusPill.color}18`,
                borderColor: `${statusPill.color}35`,
              },
            ]}
          >
            <Text style={[styles.statusText, { color: statusPill.color }]}>{statusPill.text}</Text>
          </View>
        )}
      </View>

      <View style={styles.valueSection}>
        <Text style={[styles.valueText, { color: colors.textHeading }]}>{value}</Text>
        {sub && <Text style={[styles.subText, { color: colors.textMuted }]}>{sub}</Text>}
      </View>

      <View style={styles.bottomRow}>
        <Text style={[styles.labelText, { color: colors.textMuted }]}>{label}</Text>
        {trend && (
          <Text style={[styles.trendText, { color: trendUp ? '#22C55E' : '#EF4444' }]}>
            {trendUp ? '▲' : '▼'} {trend}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  valueSection: {
    marginTop: 2,
  },
  valueText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subText: {
    fontSize: 11,
    marginTop: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelText: {
    fontSize: 11,
    fontWeight: '500',
  },
  trendText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
