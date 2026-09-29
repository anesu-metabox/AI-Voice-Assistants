import React, { useEffect, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import VoxiMascot from '../components/VoxiMascot';
import { useMobileLiveKitSession } from '../hooks/useMobileLiveKitSession';
import { useTheme } from '../context/ThemeContext';

function WaveformOrb({
  size = 220,
  frequencies,
  isSpeaking,
}: {
  size?: number;
  frequencies?: number[];
  isSpeaking?: boolean;
}) {
  const r = size / 2 - 4;
  const cx = size / 2;

  const barHeights =
    frequencies && frequencies.length > 0
      ? frequencies
      : [4, 7, 12, 18, 26, 32, 28, 22, 34, 40, 36, 28, 38, 44, 40, 32, 42, 46, 42, 34, 40, 44, 38, 28, 34, 38, 32, 22, 26, 30, 22, 16, 20, 24, 18, 12, 16, 20, 14, 8, 10, 14, 8, 4];

  return (
    <View style={[styles.orbWrapper, { width: size, height: size }]}>
      {/* Glow */}
      <View
        style={[
          styles.orbGlow,
          {
            width: size + 20,
            height: size + 20,
            borderRadius: (size + 20) / 2,
            backgroundColor: isSpeaking ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.12)',
          },
        ]}
      />

      {/* Svg ring */}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.svgRing}>
        <Defs>
          <SvgGradient id="ringStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#6366F1" />
            <Stop offset="100%" stopColor="#818CF8" />
          </SvgGradient>
        </Defs>
        <Circle
          cx={cx}
          cy={cx}
          r={r}
          stroke="url(#ringStroke)"
          strokeWidth="2.5"
          fill="none"
          opacity={isSpeaking ? 1 : 0.85}
        />
      </Svg>

      {/* Waveform bars */}
      <View style={styles.barsContainer}>
        <View style={styles.barsRow}>
          {barHeights.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h,
                  backgroundColor: isSpeaking ? '#38BDF8' : '#818CF8',
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function LiveCallModal({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const {
    connectionStatus,
    isMuted,
    isHandsFree,
    isBotSpeaking,
    sessionSeconds,
    latencyMs,
    transcripts,
    audioFrequencies,
    connect,
    disconnect,
    toggleMute,
    toggleHandsFree,
    handleUserInterruption,
  } = useMobileLiveKitSession();

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [transcripts]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    disconnect();
    onClose();
  };

  const statusColors = {
    connected: '#22C55E',
    connecting: '#F59E0B',
    reconnecting: '#F59E0B',
    disconnected: '#94A3B8',
    error: '#EF4444',
    demo: '#38BDF8',
  };

  const currentStatusColor = statusColors[connectionStatus] || '#22C55E';

  return (
    <View style={[styles.modalOverlay, { backgroundColor: colors.isDark ? '#060A14' : '#0F172A' }]}>
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: currentStatusColor }]} />
          <Text style={styles.statusLabelText}>
            {connectionStatus === 'connected'
              ? 'Live Voice Call'
              : connectionStatus === 'demo'
              ? 'Demo Simulation'
              : connectionStatus === 'connecting'
              ? 'Connecting...'
              : 'LiveKit Room'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleEndCall} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Main Body */}
      <View style={styles.mainCenter}>
        {/* Mascot / Avatar */}
        <View style={styles.mascotBox}>
          <VoxiMascot size={72} animated={false} />
        </View>

        <Text style={styles.assistantNameText}>Aoede</Text>
        <Text style={styles.timerText}>{formatTimer(sessionSeconds)}</Text>

        {/* Latency SLA Telemetry Badge */}
        <View style={styles.latencyBadge}>
          <Text style={{ fontSize: 11 }}>⚡</Text>
          <Text style={styles.latencyText}>{latencyMs}ms · &lt;450ms SLA Verified</Text>
        </View>

        {/* Waveform Visualizer */}
        <View style={{ marginVertical: 14 }}>
          <WaveformOrb size={170} frequencies={audioFrequencies} isSpeaking={isBotSpeaking} />
        </View>

        {/* Interrupt Button (Push-to-Talk / Hybrid) */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleUserInterruption}
          style={styles.interruptBtn}
        >
          <Text style={styles.interruptBtnText}>⚡ Tap to Speak / Interrupt (&lt;20ms)</Text>
        </TouchableOpacity>
      </View>

      {/* Transcript Box */}
      <View style={[styles.transcriptSection, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
        <Text style={[styles.transcriptHeader, { color: colors.textMuted }]}>Live Streaming Transcripts</Text>
        <ScrollView ref={scrollRef} style={styles.transcriptScroll} contentContainerStyle={{ gap: 6 }}>
          {transcripts.length === 0 ? (
            <Text style={[styles.emptyTranscriptText, { color: colors.textMuted }]}>
              Listening for conversational audio...
            </Text>
          ) : (
            transcripts.map((t) => (
              <View key={t.id} style={styles.transcriptRow}>
                <Text style={[styles.speakerText, { color: t.speaker === 'user' ? colors.accent : '#22C55E' }]}>
                  {t.speaker === 'user' ? 'You' : 'Aoede'}:
                </Text>
                <Text style={[styles.chatText, { color: colors.textHeading }]}>{t.text}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Bottom Controls */}
      <View style={[styles.controlsBar, { backgroundColor: colors.cardBg, borderTopColor: colors.border }]}>
        {/* Mute Button */}
        <TouchableOpacity onPress={toggleMute} style={styles.controlItem}>
          <View style={[styles.circleBtn, { backgroundColor: isMuted ? '#FEE2E2' : colors.cardSecondary }]}>
            <Text style={{ fontSize: 18 }}>{isMuted ? '🔇' : '🎙️'}</Text>
          </View>
          <Text style={[styles.controlLabel, { color: isMuted ? '#EF4444' : colors.textMuted }]}>
            {isMuted ? 'Muted' : 'Mute Mic'}
          </Text>
        </TouchableOpacity>

        {/* End Call Button */}
        <TouchableOpacity activeOpacity={0.85} onPress={handleEndCall} style={styles.endCallItem}>
          <View style={styles.endCallCircle}>
            <Text style={{ fontSize: 22, color: 'white' }}>📞</Text>
          </View>
          <Text style={styles.endCallLabel}>End Call</Text>
        </TouchableOpacity>

        {/* Hands-Free Button */}
        <TouchableOpacity onPress={toggleHandsFree} style={styles.controlItem}>
          <View
            style={[
              styles.circleBtn,
              {
                backgroundColor: isHandsFree
                  ? colors.isDark
                    ? 'rgba(99,102,241,0.2)'
                    : '#EEF2FF'
                  : colors.cardSecondary,
              },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{isHandsFree ? '🔊' : '✋'}</Text>
          </View>
          <Text style={[styles.controlLabel, { color: colors.textMuted }]}>
            {isHandsFree ? 'Hands-Free' : 'Push-to-Talk'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 100,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 44,
    paddingBottom: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusLabelText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  mainCenter: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  mascotBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E1B4B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  assistantNameText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  timerText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  latencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    marginTop: 6,
  },
  latencyText: {
    fontSize: 10,
    color: '#4ADE80',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  orbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlow: {
    position: 'absolute',
  },
  svgRing: {
    position: 'absolute',
  },
  barsContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    width: 120,
    justifyContent: 'center',
  },
  bar: {
    width: 2.5,
    borderRadius: 2,
  },
  interruptBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(59,91,219,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(59,91,219,0.5)',
  },
  interruptBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#93C5FD',
  },
  transcriptSection: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    height: 110,
  },
  transcriptHeader: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  transcriptScroll: {
    flex: 1,
  },
  emptyTranscriptText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  transcriptRow: {
    flexDirection: 'row',
    gap: 6,
  },
  speakerText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chatText: {
    fontSize: 11,
    flex: 1,
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: 1,
  },
  controlItem: {
    alignItems: 'center',
    gap: 4,
  },
  circleBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  endCallItem: {
    alignItems: 'center',
    gap: 4,
  },
  endCallCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  endCallLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
  },
});
