import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import MetricCard from '../components/MetricCard';
import BarChart, { DayActivity } from '../components/BarChart';
import VoxiMascot from '../components/VoxiMascot';
import VocalistLogo from '../components/VocalistLogo';
import TaskDeck from '../components/TaskDeck';
import { useTheme } from '../context/ThemeContext';
import {
  apiService,
  AssistantConfig,
  CallRecord,
  CompanyProfile,
  GoogleAuthStatus,
  ThreeCXStatus,
} from '../services/api';

function PhoneIcon() {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24">
      <Path
        d="M6.62 10.79C8.06 13.62 10.38 15.93 13.21 17.38L15.41 15.18C15.68 14.91 16.08 14.82 16.43 14.94C17.55 15.31 18.76 15.51 20 15.51C20.55 15.51 21 15.96 21 16.51V20C21 20.55 20.55 21 20 21C10.61 21 3 13.39 3 4C3 3.45 3.45 3 4 3H7.5C8.05 3 8.5 3.45 8.5 4C8.5 5.25 8.7 6.45 9.07 7.57C9.18 7.92 9.1 8.31 8.82 8.59L6.62 10.79Z"
        fill="#3B5BDB"
      />
    </Svg>
  );
}

function ClockIcon() {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke="#8B5CF6" strokeWidth="2" fill="none" />
      <Path d="M12 7V12L15 15" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function CalendarIcon() {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="18" rx="3" stroke="#22C55E" strokeWidth="2" fill="none" />
      <Path d="M8 2V6M16 2V6M3 10H21" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function TelephonyIcon() {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24">
      <Rect x="2" y="2" width="9" height="9" rx="2" fill="#06B6D4" />
      <Rect x="13" y="2" width="9" height="9" rx="2" fill="#06B6D4" opacity="0.6" />
      <Rect x="2" y="13" width="9" height="9" rx="2" fill="#06B6D4" opacity="0.6" />
      <Rect x="13" y="13" width="9" height="9" rx="2" fill="#06B6D4" opacity="0.3" />
    </Svg>
  );
}

function BellIcon({ color }: { color?: string }) {
  return (
    <Svg width="20" height="20" viewBox="0 0 24 24">
      <Path
        d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
        stroke={color || '#64748B'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export default function DashboardScreen({
  onQuickTest,
  onConfigureAssistant,
}: {
  onQuickTest: () => void;
  onConfigureAssistant?: () => void;
}) {
  const { colors, theme, toggleTheme } = useTheme();

  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [assistant, setAssistant] = useState<AssistantConfig | null>(null);
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus>({ connected: false });
  const [threeCX, setThreeCX] = useState<ThreeCXStatus>({ configured: false, state: 'unconfigured' });
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const [compRes, asstRes, gRes, tRes, callRes] = await Promise.allSettled([
        apiService.getCompanyProfile(),
        apiService.getAssistantConfig(),
        apiService.getGoogleAuthStatus(),
        apiService.getThreeCXStatus(),
        apiService.getCallHistory(100),
      ]);

      if (compRes.status === 'fulfilled' && compRes.value) {
        setCompany(compRes.value);
      }
      if (asstRes.status === 'fulfilled' && asstRes.value) {
        setAssistant(asstRes.value);
      }
      if (gRes.status === 'fulfilled' && gRes.value) {
        setGoogleAuth(gRes.value);
      }
      if (tRes.status === 'fulfilled' && tRes.value) {
        setThreeCX(tRes.value);
      }
      if (callRes.status === 'fulfilled' && callRes.value) {
        setCalls(callRes.value);
      }
    } catch {
      // Fall through to empty live states
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDashboardData();
  }, [loadDashboardData]);

  // Compute live metrics from database call logs
  const totalCalls = calls.length;
  const avgDurationSeconds =
    totalCalls > 0
      ? Math.round(calls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0) / totalCalls)
      : 0;
  const avgMins = Math.floor(avgDurationSeconds / 60);
  const avgSecs = avgDurationSeconds % 60;
  const avgDurationStr = totalCalls > 0 ? `${avgMins}m ${avgSecs.toString().padStart(2, '0')}s` : '0s';

  // Compute 7-day distribution for BarChart
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayBuckets: Record<string, number> = {
    Mon: 0,
    Tue: 0,
    Wed: 0,
    Thu: 0,
    Fri: 0,
    Sat: 0,
    Sun: 0,
  };

  calls.forEach((c) => {
    const d = new Date(c.createdAt);
    if (!isNaN(d.getTime())) {
      const jsDay = d.getDay(); // 0 is Sun, 1 is Mon...
      const mapped = jsDay === 0 ? 'Sun' : dayNames[jsDay - 1];
      dayBuckets[mapped] = (dayBuckets[mapped] || 0) + 1;
    }
  });

  const weeklyActivity: DayActivity[] = dayNames.map((day) => ({
    day,
    calls: dayBuckets[day] || 0,
  }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const companyName = company?.company_name || 'Your company';
  const assistantName = assistant?.assistant_name || 'Your assistant';
  const assistantTone = assistant?.tone ? `${assistant.tone.charAt(0).toUpperCase() + assistant.tone.slice(1)} tone` : 'Professional tone';
  const voiceEngine = assistant?.voice_engine || 'Not configured';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.primary]}
        />
      }
    >
      {/* Top App Bar */}
      <View style={styles.topBar}>
        <VocalistLogo size={38} />
        <View style={styles.companyInfo}>
          <Text style={[styles.companyName, { color: colors.textHeading }]} numberOfLines={1}>
            {companyName}
          </Text>
          <Text style={[styles.companyPlan, { color: colors.textMuted }]}>Workspace</Text>
        </View>

        <TouchableOpacity
          onPress={toggleTheme}
          accessibilityLabel="Toggle light and dark mode"
          style={[styles.themeBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
        >
          {theme === 'dark' ? (
            <Svg width="16" height="16" viewBox="0 0 24 24">
              <Circle cx="12" cy="12" r="5" stroke="#F59E0B" strokeWidth="2" fill="#F59E0B" fillOpacity="0.2" />
              <Path
                d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22"
                stroke="#F59E0B"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </Svg>
          ) : (
            <Svg width="15" height="15" viewBox="0 0 24 24">
              <Path
                d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79Z"
                stroke="#4F46E5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="#4F46E5"
                fillOpacity="0.2"
              />
            </Svg>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.themeBtn, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={onRefresh}
          accessibilityLabel="Refresh"
        >
          <BellIcon color={colors.textMuted} />
          {loading && <View style={[styles.bellDot, { borderColor: colors.cardBg }]} />}
        </TouchableOpacity>
      </View>

      {/* Body Content */}
      <View style={styles.body}>
        {/* Greeting */}
        <View>
          <Text style={[styles.greetingSub, { color: colors.textMuted }]}>{greeting}</Text>
          <Text style={[styles.greetingTitle, { color: colors.textHeading }]}>Live assistant status</Text>
        </View>

        {/* Hero assistant card */}
        <TouchableOpacity activeOpacity={0.92} onPress={onConfigureAssistant} style={styles.assistantCardWrapper}>
          <LinearGradient
            colors={colors.isDark ? ['#1E2A6B', '#3B2A8C'] : ['#3B5BDB', '#6D4AE0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.assistantCard}
          >
            <View style={styles.mascotWrap}>
              <VoxiMascot size={56} animated={false} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.assistantName} numberOfLines={1}>{assistantName}</Text>
              <View style={styles.publishedBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.publishedText}>Ready</Text>
              </View>
              <Text style={styles.assistantTone} numberOfLines={1}>{voiceEngine} · {assistantTone}</Text>
            </View>
            <TouchableOpacity activeOpacity={0.85} onPress={onQuickTest} style={styles.quickTestBtn}>
              <Text style={styles.quickTestText}>Test call</Text>
            </TouchableOpacity>
          </LinearGradient>
        </TouchableOpacity>

        {/* Metric Cards 2x2 Grid */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Voice Calls"
              value={String(totalCalls)}
              trend={totalCalls > 0 ? `${totalCalls} logged` : 'No calls yet'}
              trendUp={totalCalls > 0}
              icon={<PhoneIcon />}
              accent="#3B5BDB"
            />
            <MetricCard
              label="Avg Duration"
              value={avgDurationStr}
              sub="per session"
              icon={<ClockIcon />}
              accent="#8B5CF6"
            />
          </View>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Google Calendar"
              value={googleAuth.connected ? 'Active' : 'Offline'}
              statusPill={{
                text: googleAuth.connected ? 'Active' : 'Unlinked',
                color: googleAuth.connected ? '#22C55E' : '#94A3B8',
              }}
              icon={<CalendarIcon />}
              accent="#22C55E"
            />
            <MetricCard
              label="3CX Telephony"
              value={threeCX.configured ? 'Online' : 'Pending'}
              statusPill={{
                text: threeCX.configured ? 'Connected' : 'Setup Required',
                color: threeCX.configured ? '#06B6D4' : '#F59E0B',
              }}
              icon={<TelephonyIcon />}
              accent="#06B6D4"
            />
          </View>
        </View>

        {/* Bar Chart Card */}
        <View style={[styles.chartCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={[styles.chartTitle, { color: colors.textHeading }]}>Voice Session Activity</Text>
              <Text style={[styles.chartSub, { color: colors.textMuted }]}>
                {totalCalls > 0 ? `${totalCalls} total sessions logged` : 'Last 7 days (No calls logged yet)'}
              </Text>
            </View>
            {totalCalls > 0 && (
              <View style={styles.chartTrendPill}>
                <Text style={styles.chartTrendText}>▲ Live Verified</Text>
              </View>
            )}
          </View>
          <BarChart data={weeklyActivity} />
        </View>

        {/* Task Execution Deck */}
        <TaskDeck />
      </View>
      <View style={{ height: 90 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  companyBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 14,
    fontWeight: '700',
  },
  companyPlan: {
    fontSize: 11,
  },
  themeBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBtn: {
    padding: 4,
    position: 'relative',
  },
  bellDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    padding: 20,
    gap: 18,
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  greetingSub: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 2,
  },
  metricsGrid: {
    gap: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  chartCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  chartSub: {
    fontSize: 11,
  },
  chartTrendPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  chartTrendText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#22C55E',
  },
  assistantCardWrapper: {
    borderRadius: 20,
  },
  assistantCard: {
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  assistantName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  publishedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  publishedText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#22C55E',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  mascotWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTone: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  quickTestBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  quickTestText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
