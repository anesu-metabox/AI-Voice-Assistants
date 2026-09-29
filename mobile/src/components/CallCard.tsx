import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

interface CallCardProps {
  did: string;
  direction: 'inbound' | 'outbound';
  dateTime: string;
  duration: string;
  status: 'Ended' | 'Failed' | 'Missed' | 'Active' | 'Ringing';
  onClick: () => void;
}

export default function CallCard({
  did,
  direction,
  dateTime,
  duration,
  status,
  onClick,
}: CallCardProps) {
  const { colors } = useTheme();
  const statusColor =
    status === 'Ended'
      ? '#22C55E'
      : status === 'Failed'
      ? '#EF4444'
      : status === 'Active'
      ? '#38BDF8'
      : '#F59E0B';
  const dirColor = direction === 'inbound' ? '#3B5BDB' : '#8B5CF6';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onClick}
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBg,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Direction icon */}
      <View style={[styles.iconBox, { backgroundColor: `${dirColor}15` }]}>
        <Svg width="18" height="18" viewBox="0 0 24 24">
          {direction === 'inbound' ? (
            <Path
              d="M20 5L5 20M5 20H14M5 20V11"
              stroke={dirColor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <Path
              d="M4 19L19 4M19 4H10M19 4V13"
              stroke={dirColor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      </View>

      <View style={styles.infoCol}>
        <View style={styles.topRow}>
          <Text style={[styles.didText, { color: colors.textHeading }]}>{did}</Text>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: `${statusColor}18`,
                borderColor: `${statusColor}30`,
              },
            ]}
          >
            <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
          </View>
        </View>

        <View style={styles.bottomRow}>
          <Text style={[styles.dateText, { color: colors.textMuted }]}>{dateTime}</Text>
          <View style={[styles.dot, { backgroundColor: colors.borderLight }]} />
          <View style={[styles.durationBadge, { backgroundColor: colors.cardSecondary }]}>
            <Text style={[styles.durationText, { color: colors.textBody }]}>{duration}</Text>
          </View>
        </View>
      </View>

      {/* Chevron */}
      <Svg width="14" height="14" viewBox="0 0 24 24">
        <Path d="M9 6L15 12L9 18" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
      </Svg>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCol: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  didText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateText: {
    fontSize: 11,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  durationBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
