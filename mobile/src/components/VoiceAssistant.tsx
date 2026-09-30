import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useVoiceBot } from '../hooks/useVoiceBot';
import { getVoiceAssistantBadge, VoiceBotStatus } from '../types/voiceBot';
import VoxiMascot from './VoxiMascot';

type VoiceAssistantProps = {
  autoStart?: boolean;
  onClose?: () => void;
};

const STATUS_COLORS: Record<VoiceBotStatus, string> = {
  disconnected: '#94A3B8',
  connecting: '#F59E0B',
  waiting_for_agent: '#38BDF8',
  connected: '#22C55E',
  reconnecting: '#F97316',
  error: '#EF4444',
};

export default function VoiceAssistant({ autoStart = false, onClose }: VoiceAssistantProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const voice = useVoiceBot();
  const transcriptRef = useRef<ScrollView>(null);
  const startedRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const [sessionSeconds, setSessionSeconds] = useState(0);

  const start = useCallback(async () => {
    try {
      await voice.initiateCall({ participantName: user?.name || user?.email || 'Mobile user' });
    } catch {
      // The hook exposes a safe, user-facing error object.
    }
  }, [user?.email, user?.name, voice.initiateCall]);

  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [autoStart, start]);

  useEffect(() => {
    if (!['connected', 'waiting_for_agent', 'reconnecting'].includes(voice.status)) return;
    const timer = setInterval(() => setSessionSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [voice.status]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: voice.isBotSpeaking ? 1.12 : 1.04,
          duration: voice.isBotSpeaking ? 420 : 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: voice.isBotSpeaking ? 420 : 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, voice.isBotSpeaking]);

  useEffect(() => {
    transcriptRef.current?.scrollToEnd({ animated: true });
  }, [voice.transcripts]);

  const end = useCallback(async () => {
    await voice.endCall();
    setSessionSeconds(0);
    onClose?.();
  }, [onClose, voice.endCall]);

  const badge = getVoiceAssistantBadge(voice.status);
  const minutes = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
  const seconds = (sessionSeconds % 60).toString().padStart(2, '0');
  const callActive = ['connecting', 'waiting_for_agent', 'connected', 'reconnecting'].includes(voice.status);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={[styles.statusPill, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[voice.status] }]} />
          <Text style={[styles.statusText, { color: colors.textBody }]}>{badge.label}</Text>
        </View>
        {onClose && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close voice assistant"
            onPress={end}
            style={[styles.closeButton, { backgroundColor: colors.cardSecondary }]}
          >
            <Text style={[styles.closeText, { color: colors.textBody }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.hero}>
        <Animated.View style={[styles.orb, { transform: [{ scale: pulse }], borderColor: colors.accent }]}>
          <View style={[styles.orbInner, { backgroundColor: colors.cardBg }]}>
            <VoxiMascot size={76} animated={voice.isBotSpeaking} />
          </View>
        </Animated.View>
        <Text style={[styles.assistantName, { color: colors.textHeading }]}>Aoede</Text>
        <Text style={[styles.timer, { color: colors.textMuted }]}>{minutes}:{seconds}</Text>
        <Text style={[styles.activity, { color: voice.isBotSpeaking ? colors.accent : colors.textMuted }]}>
          {voice.isBotSpeaking
            ? 'Assistant is speaking'
            : voice.isUserSpeaking
              ? 'Interrupting assistant…'
              : voice.status === 'waiting_for_agent'
                ? 'Waiting for assistant audio…'
                : voice.status === 'connected'
                  ? 'Listening'
                  : 'Ready for a secure voice session'}
        </Text>
        {callActive && (
          <View style={styles.meterRow}>
            <Text style={[styles.meterText, { color: colors.textSubtle }]}>Mic {voice.localAudioLevel}%</Text>
            <View style={[styles.meterTrack, { backgroundColor: colors.cardSecondary }]}>
              <View style={[styles.meterFill, { width: `${Math.max(3, voice.remoteAudioLevel)}%`, backgroundColor: colors.accent }]} />
            </View>
            <Text style={[styles.meterText, { color: colors.textSubtle }]}>Agent {voice.remoteAudioLevel}%</Text>
          </View>
        )}
      </View>

      {voice.error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Voice session unavailable</Text>
          <Text style={styles.errorText}>{voice.error.message}</Text>
        </View>
      )}

      {voice.activeTask && (
        <View style={[styles.taskBox, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
          <Text style={[styles.taskLabel, { color: colors.textMuted }]}>Current action</Text>
          <Text style={[styles.taskTitle, { color: colors.textBody }]}>
            {voice.activeTask.title || voice.activeTask.tool_name || 'Voice action'} · {voice.activeTask.status || 'running'}
          </Text>
        </View>
      )}

      <View style={[styles.transcriptCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
        <Text style={[styles.transcriptTitle, { color: colors.textHeading }]}>Live transcript</Text>
        <ScrollView ref={transcriptRef} contentContainerStyle={styles.transcriptContent}>
          {voice.transcripts.length === 0 ? (
            <Text style={[styles.emptyTranscript, { color: colors.textMuted }]}>
              Transcript messages will appear here after the assistant joins.
            </Text>
          ) : (
            voice.transcripts.map((message) => (
              <View key={message.id} style={styles.messageRow}>
                <Text style={[styles.messageRole, { color: message.role === 'user' ? colors.accent : colors.textMuted }]}>
                  {message.role === 'user' ? 'You' : 'Aoede'}
                </Text>
                <Text style={[styles.messageText, { color: colors.textBody }]}>{message.text}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {!callActive ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void start()}
          style={[styles.startButton, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.startText}>{voice.status === 'error' ? 'Try again' : 'Start voice call'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.controls}>
          <ControlButton
            label={voice.isMuted ? 'Unmute' : 'Mute'}
            icon={voice.isMuted ? '🔇' : '🎙️'}
            onPress={() => void voice.toggleMute()}
            colors={colors}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !voice.isBotSpeaking }}
            disabled={!voice.isBotSpeaking}
            onPress={() => void voice.interrupt()}
            style={[styles.interruptButton, { opacity: voice.isBotSpeaking ? 1 : 0.45 }]}
          >
            {voice.status === 'connecting' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.interruptIcon}>⚡</Text>}
            <Text style={styles.interruptText}>Interrupt</Text>
          </TouchableOpacity>
          <ControlButton
            label={voice.isSpeakerphoneOn ? 'Speaker' : 'Earpiece'}
            icon={voice.isSpeakerphoneOn ? '🔊' : '🔈'}
            onPress={() => void voice.toggleSpeakerphone()}
            colors={colors}
          />
        </View>
      )}

      {callActive && (
        <TouchableOpacity accessibilityRole="button" onPress={() => void end()} style={styles.endButton}>
          <Text style={styles.endText}>End call</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ControlButton({
  label,
  icon,
  onPress,
  colors,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.controlButton}>
      <View style={[styles.controlCircle, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
        <Text style={styles.controlIcon}>{icon}</Text>
      </View>
      <Text style={[styles.controlLabel, { color: colors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, fontWeight: '700' },
  hero: { alignItems: 'center', paddingTop: 24, paddingBottom: 14 },
  orb: { width: 132, height: 132, borderRadius: 66, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowColor: '#38BDF8', shadowOpacity: 0.35, shadowRadius: 18 },
  orbInner: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  assistantName: { marginTop: 15, fontSize: 22, fontWeight: '800' },
  timer: { marginTop: 3, fontSize: 13, fontVariant: ['tabular-nums'] },
  activity: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  meterRow: { marginTop: 12, width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterText: { fontSize: 10, minWidth: 50 },
  meterTrack: { height: 5, flex: 1, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 5, borderRadius: 3 },
  errorBox: { borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)', padding: 12, marginBottom: 12 },
  errorTitle: { color: '#FCA5A5', fontSize: 13, fontWeight: '800' },
  errorText: { color: '#FECACA', fontSize: 12, lineHeight: 17, marginTop: 3 },
  taskBox: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 10 },
  taskLabel: { fontSize: 10, textTransform: 'uppercase', fontWeight: '800' },
  taskTitle: { fontSize: 12, marginTop: 3, fontWeight: '600' },
  transcriptCard: { flex: 1, minHeight: 150, borderWidth: 1, borderRadius: 18, padding: 14 },
  transcriptTitle: { fontSize: 13, fontWeight: '800', marginBottom: 8 },
  transcriptContent: { flexGrow: 1, gap: 10, paddingBottom: 4 },
  emptyTranscript: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 28 },
  messageRow: { gap: 2 },
  messageRole: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  messageText: { fontSize: 13, lineHeight: 19 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 15 },
  controlButton: { alignItems: 'center', width: 78 },
  controlCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controlIcon: { fontSize: 19 },
  controlLabel: { marginTop: 5, fontSize: 10, fontWeight: '600' },
  interruptButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4F46E5', alignItems: 'center', justifyContent: 'center' },
  interruptIcon: { fontSize: 20 },
  interruptText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', marginTop: 2 },
  startButton: { marginTop: 15, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  startText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  endButton: { marginTop: 14, alignSelf: 'center', backgroundColor: '#DC2626', borderRadius: 99, paddingHorizontal: 24, paddingVertical: 10 },
  endText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
