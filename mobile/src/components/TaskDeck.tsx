import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { apiService, TaskRecord } from '../services/api';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs_reconnect' | 'cancelled';

export interface MobileTaskItem {
  id: string;
  title: string;
  toolName: string;
  status: TaskStatus;
  idempotencyKey?: string;
  executionTimeMs?: number;
  output?: Record<string, any> | string;
  errorMessage?: string;
  category: 'calendar' | 'telephony' | 'general';
  timestamp: string;
}

interface TaskCardProps {
  task: MobileTaskItem;
  onDismiss: (id: string) => void;
  onCancel: (id: string) => void;
}

function TaskCard({ task, onDismiss, onCancel }: TaskCardProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const renderBadge = () => {
    switch (task.status) {
      case 'completed':
        return (
          <View style={[styles.badge, { backgroundColor: 'rgba(34, 197, 94, 0.12)', borderColor: 'rgba(34, 197, 94, 0.25)' }]}>
            <Svg width="11" height="11" viewBox="0 0 24 24">
              <Path d="M20 6L9 17L4 12" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={[styles.badgeText, { color: '#22C55E' }]}>Done</Text>
          </View>
        );
      case 'running':
        return (
          <View style={[styles.badge, { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
            <View style={[styles.pulseDot, { backgroundColor: '#38BDF8' }]} />
            <Text style={[styles.badgeText, { color: '#38BDF8' }]}>Executing</Text>
          </View>
        );
      case 'failed':
        return (
          <View style={[styles.badge, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
            <Text style={[styles.badgeText, { color: '#EF4444' }]}>Failed</Text>
          </View>
        );
      case 'cancelled':
        return (
          <View style={[styles.badge, { backgroundColor: 'rgba(148, 163, 184, 0.12)', borderColor: 'rgba(148, 163, 184, 0.3)' }]}>
            <Text style={[styles.badgeText, { color: '#94A3B8' }]}>Cancelled</Text>
          </View>
        );
      default:
        return (
          <View style={[styles.badge, { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.3)' }]}>
            <Text style={[styles.badgeText, { color: '#F59E0B' }]}>Pending</Text>
          </View>
        );
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => setExpanded(!expanded)}
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBg,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.iconEmoji}>
            {task.category === 'calendar' ? '📅' : task.category === 'telephony' ? '📞' : '⚡'}
          </Text>
          <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.textHeading }]}>
            {task.title}
          </Text>
        </View>
        <View style={styles.badgeRow}>
          {renderBadge()}
          {task.status === 'running' && (
            <TouchableOpacity onPress={() => onCancel(task.id)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onDismiss(task.id)} style={styles.dismissBtn}>
            <Text style={[styles.dismissText, { color: colors.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tool Name & Latency */}
      <View style={styles.toolRow}>
        <View style={[styles.toolBadge, { backgroundColor: colors.isDark ? 'rgba(99,102,241,0.12)' : 'rgba(79,70,229,0.08)' }]}>
          <Text style={[styles.toolText, { color: colors.isDark ? '#818CF8' : '#4F46E5' }]}>{task.toolName}</Text>
        </View>
        {task.executionTimeMs && (
          <Text style={[styles.latencyText, { color: colors.textMuted }]}>⚡ {task.executionTimeMs}ms</Text>
        )}
      </View>

      {/* Idempotency Key */}
      {task.idempotencyKey && (
        <View style={[styles.lockRow, { backgroundColor: colors.isDark ? '#0A0E1F' : '#F1F5F9', borderColor: colors.border }]}>
          <Svg width="12" height="12" viewBox="0 0 24 24">
            <Rect x="3" y="11" width="18" height="11" rx="2" stroke="#F59E0B" strokeWidth="2" />
            <Path d="M7 11V7a5 5 0 0110 0v4" stroke="#F59E0B" strokeWidth="2" />
          </Svg>
          <Text numberOfLines={1} style={[styles.lockText, { color: colors.textMuted }]}>
            lock: {task.idempotencyKey}
          </Text>
        </View>
      )}

      {/* Expandable Payload */}
      {expanded && (task.output || task.errorMessage) && (
        <View style={[styles.outputBox, { backgroundColor: colors.isDark ? '#060A14' : '#F8FAFC', borderColor: colors.border }]}>
          <Text style={[styles.outputText, { color: task.errorMessage ? '#EF4444' : colors.isDark ? '#34D399' : '#059669' }]}>
            {task.errorMessage || (typeof task.output === 'string' ? task.output : JSON.stringify(task.output, null, 2))}
          </Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.cardFooter}>
        <Text style={[styles.timestampText, { color: colors.textSubtle }]}>{task.timestamp}</Text>
        <Text style={[styles.hintText, { color: colors.accent }]}>
          {expanded ? '▲ Hide details' : '▼ Tap to inspect'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TaskDeck() {
  const { colors } = useTheme();
  const [tasks, setTasks] = useState<MobileTaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'calendar' | 'telephony'>('all');
  const [lastDismissed, setLastDismissed] = useState<MobileTaskItem | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const rawTasks = await apiService.getTasks();
      const mapped: MobileTaskItem[] = rawTasks.map((t: TaskRecord) => {
        const category: 'calendar' | 'telephony' | 'general' = t.tool_name.includes('calendar')
          ? 'calendar'
          : t.tool_name.includes('3cx') || t.tool_name.includes('telephony')
          ? 'telephony'
          : 'general';

        const created = t.created_at ? new Date(t.created_at) : new Date();
        const timestamp = created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return {
          id: String(t.id),
          title: t.title || t.tool_name,
          toolName: t.tool_name,
          status: (t.status as TaskStatus) || 'completed',
          output: t.output_result,
          errorMessage: t.error_message,
          category,
          timestamp,
        };
      });
      setTasks(mapped);
    } catch {
      // Empty task deck when backend or table is uninitialized
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleDismiss = (id: string) => {
    const target = tasks.find((t) => t.id === id);
    if (target) {
      setLastDismissed(target);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const handleUndo = () => {
    if (lastDismissed) {
      setTasks((prev) => [lastDismissed, ...prev]);
      setLastDismissed(null);
    }
  };

  const handleCancelTask = async (id: string) => {
    await apiService.cancelTask(id);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            status: 'cancelled' as TaskStatus,
            output: { cancelledAt: new Date().toISOString(), reason: 'User requested cancellation' },
          };
        }
        return t;
      })
    );
  };

  const filteredTasks = tasks.filter((t) => {
    if (activeFilter === 'calendar') return t.category === 'calendar';
    if (activeFilter === 'telephony') return t.category === 'telephony';
    return true;
  });

  return (
    <View style={styles.deckContainer}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.headerTextGroup}>
          <Text style={[styles.sectionTitle, { color: colors.textHeading }]}>Live Task Execution Deck</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
            Background tool dispatches &amp; verified locks
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {loading && <ActivityIndicator size="small" color={colors.accent} />}
          {tasks.length > 0 && (
            <View style={[styles.activePill, { backgroundColor: colors.pillBg }]}>
              <Text style={[styles.activePillText, { color: colors.isDark ? '#38BDF8' : '#2563EB' }]}>
                {tasks.length} active
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Filter Tabs */}
      {tasks.length > 0 && (
        <View style={styles.filterRow}>
          {(['all', 'calendar', 'telephony'] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              onPress={() => setActiveFilter(filter)}
              style={[
                styles.filterTab,
                {
                  borderColor: activeFilter === filter ? colors.primary : colors.border,
                  backgroundColor:
                    activeFilter === filter
                      ? colors.isDark
                        ? 'rgba(59,91,219,0.3)'
                        : '#3B5BDB'
                      : colors.cardBg,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterTabText,
                  {
                    color:
                      activeFilter === filter
                        ? colors.isDark
                          ? '#93C5FD'
                          : '#FFFFFF'
                        : colors.textMuted,
                  },
                ]}
              >
                {filter === 'all' ? 'All Tasks' : filter === 'calendar' ? '📅 Calendar' : '📞 Telephony'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Undo Banner */}
      {lastDismissed && (
        <View style={[styles.undoBanner, { backgroundColor: colors.isDark ? '#16223F' : '#EEF2FF', borderColor: colors.border }]}>
          <Text style={[styles.undoText, { color: colors.textBody }]}>
            Dismissed: <Text style={{ fontWeight: '700' }}>{lastDismissed.title}</Text>
          </Text>
          <TouchableOpacity onPress={handleUndo}>
            <Text style={[styles.undoBtnText, { color: colors.accent }]}>Undo ↩</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Cards List */}
      <View style={styles.cardsList}>
        {filteredTasks.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>⚡</Text>
            <Text style={[styles.emptyTitle, { color: colors.textHeading }]}>
              No Background Tasks Queued
            </Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              Tool executions (such as Google Calendar scheduling and 3CX SIP transfers) will stream and show execution locks here in real time.
            </Text>
            <TouchableOpacity onPress={fetchTasks} style={[styles.restoreBtn, { backgroundColor: colors.pillBg, borderColor: colors.border }]}>
              <Text style={[styles.restoreBtnText, { color: colors.accent }]}>Refresh Tasks</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} onDismiss={handleDismiss} onCancel={handleCancelTask} />
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  deckContainer: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextGroup: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  sectionSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: '600',
  },
  undoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  undoText: {
    fontSize: 11,
  },
  undoBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardsList: {
    gap: 10,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  iconEmoji: {
    fontSize: 15,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cancelBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  cancelText: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '600',
  },
  dismissBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dismissText: {
    fontSize: 12,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  toolBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  toolText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  latencyText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  lockText: {
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
  },
  outputBox: {
    marginTop: 6,
    marginBottom: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  outputText: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timestampText: {
    fontSize: 10,
  },
  hintText: {
    fontSize: 10,
    fontWeight: '500',
  },
  emptyBox: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  restoreBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
  },
  restoreBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
