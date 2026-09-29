import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import CallCard from '../components/CallCard';
import { useTheme } from '../context/ThemeContext';
import { apiService, CallRecord } from '../services/api';

const FILTERS = ['All Calls', 'Inbound', 'Outbound', 'Completed', 'Failed'];

export default function CallsScreen() {
  const { colors } = useTheme();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All Calls');
  const [selectedCallId, setSelectedCallId] = useState<string | number | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const records = await apiService.getCallHistory(50);
      setCalls(records);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCalls();
  }, [fetchCalls]);

  const filtered = calls.filter((c) => {
    if (activeFilter === 'All Calls') return true;
    if (activeFilter === 'Inbound') return c.direction === 'inbound';
    if (activeFilter === 'Outbound') return c.direction === 'outbound';
    if (activeFilter === 'Completed') return c.status === 'Ended';
    if (activeFilter === 'Failed') return c.status === 'Failed';
    return true;
  });

  const selected = calls.find((c) => c.id === selectedCallId);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.headerTitle, { color: colors.textHeading }]}>Call History</Text>
          {loading && <ActivityIndicator size="small" color={colors.accent} />}
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const isActive = activeFilter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.cardBg,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.filterChipText, { color: isActive ? '#FFFFFF' : colors.textMuted }]}>
                  {f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Call feed */}
      <ScrollView
        contentContainerStyle={styles.feedScroll}
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
        <View style={styles.feedSummaryRow}>
          <Text style={[styles.feedCountText, { color: colors.textMuted }]}>{filtered.length} calls logged</Text>
          {calls.length > 0 && calls[0]?.did && (
            <Text style={[styles.feedDidText, { color: colors.accent }]}>Trunk: {calls[0].did}</Text>
          )}
        </View>

        {loading && calls.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading call records from database...</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={[styles.emptyIconCircle, { backgroundColor: colors.pillBg }]}>
              <Text style={{ fontSize: 32 }}>📞</Text>
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textHeading }]}>
              {activeFilter === 'All Calls' ? 'No Call Sessions Logged' : `No ${activeFilter} Found`}
            </Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>
              {activeFilter === 'All Calls'
                ? 'When inbound callers reach your 3CX PBX or Live Voice assistant, call sessions will appear here with full duration, routing, and telemetry.'
                : `There are currently no call sessions matching the "${activeFilter}" filter.`}
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onRefresh}
              style={[styles.refreshBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.refreshBtnText}>↻ Refresh Call Logs</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((call) => (
            <CallCard
              key={String(call.id)}
              did={call.did}
              direction={call.direction}
              dateTime={call.dateTime}
              duration={call.duration}
              status={call.status}
              onClick={() => setSelectedCallId(call.id)}
            />
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Details Modal Drawer */}
      <Modal
        visible={selectedCallId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedCallId(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSelectedCallId(null)}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.borderLight }]} />

            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textHeading }]}>Call Details</Text>
              <TouchableOpacity
                onPress={() => setSelectedCallId(null)}
                style={[styles.closeBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
              >
                <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {selected && (
              <View style={styles.detailsList}>
                {[
                  { label: 'DID / Trunk', value: selected.did },
                  { label: 'Direction', value: selected.direction === 'inbound' ? '↙ Inbound' : '↗ Outbound' },
                  { label: 'Date & Time', value: selected.dateTime },
                  { label: 'Duration', value: selected.duration },
                  { label: 'State', value: selected.status },
                  { label: 'PBX Host', value: selected.pbxHost || 'pbx.apexglobal.com:5060' },
                  { label: 'Route Point DN', value: selected.routePointDn || 'RP_INBOUND_MAIN' },
                  { label: 'Session ID', value: selected.transcriptId || String(selected.id) },
                ].map((row) => (
                  <View key={row.label} style={[styles.detailRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{row.label}</Text>
                    <Text style={[styles.detailValue, { color: colors.textHeading }]}>{row.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Privacy notice */}
            <View style={[styles.privacyBox, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
              <Text style={{ fontSize: 14 }}>🔒</Text>
              <Text style={[styles.privacyText, { color: colors.textMuted }]}>
                Call metadata is stored securely in Neon PostgreSQL with Row-Level Security. Audio recordings are not retained.
              </Text>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    borderBottomWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  filterScroll: {
    gap: 6,
    paddingBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1.5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  feedScroll: {
    padding: 16,
    gap: 8,
  },
  feedSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  feedCountText: {
    fontSize: 11,
    fontWeight: '500',
  },
  feedDidText: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyCard: {
    marginTop: 24,
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  refreshBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  refreshBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 12,
  },
  detailsList: {
    gap: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  privacyBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  privacyText: {
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
