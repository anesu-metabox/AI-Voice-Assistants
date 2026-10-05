import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  isNativeLiveKitSupported,
  SafeAndroidAudioTypePresets as AndroidAudioTypePresets,
  SafeAudioSession as AudioSession,
} from '../services/livekitNative';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { LiveKitApiClient, liveKitApiClient } from '../services/livekitApi';
import { parseVoicePacket } from '../services/voicePackets';
import type {
  InterruptResult,
  LiveKitSessionConfig,
  LiveKitTokenResponse,
  VoiceBotError,
  VoiceBotHookReturn,
  VoiceBotStatus,
  VoiceBotTask,
  VoiceBotTranscript,
} from '../types/voiceBot';

export interface UseVoiceBotOptions {
  apiClient?: LiveKitApiClient;
  sessionConfig?: LiveKitSessionConfig;
}

function toVoiceBotError(error: unknown): VoiceBotError {
  if (error && typeof error === 'object') {
    const value = error as { code?: string; message?: string; status?: number };
    return {
      code: value.code || 'VOICE_SESSION_FAILED',
      message: value.message || 'The voice session could not be started.',
      status: value.status,
    };
  }
  return { code: 'VOICE_SESSION_FAILED', message: 'The voice session could not be started.' };
}

async function selectOutput(useSpeaker: boolean): Promise<void> {
  const output = Platform.OS === 'ios'
    ? (useSpeaker ? 'force_speaker' : 'default')
    : (useSpeaker ? 'speaker' : 'earpiece');
  await AudioSession.selectAudioOutput(output);
}

export function useVoiceBot(options: UseVoiceBotOptions = {}): VoiceBotHookReturn {
  const apiClient = options.apiClient || liveKitApiClient;
  const roomRef = useRef<Room | null>(null);
  const generationRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const botSpeakingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const mutedRef = useRef(false);
  const speakerRef = useRef(true);

  const [status, setStatus] = useState<VoiceBotStatus>('disconnected');
  const [isBotSpeaking, setBotSpeakingState] = useState(false);
  const [isUserSpeaking, setUserSpeakingState] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerphoneOn, setIsSpeakerphoneOn] = useState(true);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const [transcripts, setTranscripts] = useState<VoiceBotTranscript[]>([]);
  const [activeTask, setActiveTask] = useState<VoiceBotTask | null>(null);
  const [error, setError] = useState<VoiceBotError | null>(null);

  const setIsBotSpeaking = useCallback((value: boolean) => {
    botSpeakingRef.current = value;
    setBotSpeakingState(value);
  }, []);

  const setIsUserSpeaking = useCallback((value: boolean) => {
    userSpeakingRef.current = value;
    setUserSpeakingState(value);
  }, []);

  const stopNativeAudio = useCallback(async () => {
    try {
      await AudioSession.stopAudioSession();
    } catch {
      // Teardown remains best-effort if the OS already released audio.
    }
  }, []);

  const clearSessionState = useCallback(() => {
    setIsBotSpeaking(false);
    setIsUserSpeaking(false);
    setLocalAudioLevel(0);
    setRemoteAudioLevel(0);
  }, [setIsBotSpeaking, setIsUserSpeaking]);

  const endCall = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    intentionalDisconnectRef.current = true;
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      await Promise.resolve(room.disconnect()).catch(() => undefined);
      room.removeAllListeners();
    }
    await stopNativeAudio();
    clearSessionState();
    setStatus('disconnected');
  }, [clearSessionState, stopNativeAudio]);

  const initiateCall = useCallback(async (
    config: LiveKitSessionConfig = options.sessionConfig || {},
  ): Promise<LiveKitTokenResponse | null> => {
    if (roomRef.current) return null;

    if (!isNativeLiveKitSupported) {
      setStatus('error');
      setError({
        code: 'DEV_BUILD_REQUIRED',
        message:
          'Voice calls require an Expo Development Build. Expo Go does not support custom WebRTC native modules.',
      });
      return null;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    intentionalDisconnectRef.current = false;
    setError(null);
    setTranscripts([]);
    setActiveTask(null);
    setStatus('connecting');

    let room: Room | null = null;
    try {
      const token = await apiClient.fetchToken(config);
      if (generationRef.current !== generation) return null;

      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
        ios: { defaultOutput: 'speaker' },
      });
      await AudioSession.startAudioSession();
      await selectOutput(speakerRef.current).catch(() => undefined);

      room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const activeRoom = room;
      let hasAgentAudio = false;
      const isCurrent = () => roomRef.current === activeRoom && generationRef.current === generation;

      room.on(RoomEvent.Reconnecting, () => {
        if (isCurrent()) setStatus('reconnecting');
      });
      room.on(RoomEvent.Reconnected, () => {
        if (!isCurrent()) return;
        setStatus(hasAgentAudio ? 'connected' : 'waiting_for_agent');
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        // Native LiveKit renders subscribed audio through the platform audio session.
        if (isCurrent() && track.kind === Track.Kind.Audio) {
          hasAgentAudio = true;
          setStatus('connected');
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (!isCurrent() || track.kind !== Track.Kind.Audio) return;
        hasAgentAudio = false;
        setIsBotSpeaking(false);
        if (activeRoom.state === ConnectionState.Connected) setStatus('waiting_for_agent');
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!isCurrent() || userSpeakingRef.current) return;
        setIsBotSpeaking(speakers.some((participant) => !participant.isLocal));
      });
      room.on(RoomEvent.DataReceived, (payload) => {
        if (!isCurrent()) return;
        const packet = parseVoicePacket(payload);
        if (packet?.type === 'transcript') setTranscripts((current) => [...current, packet.transcript]);
        if (packet?.type === 'task_update') setActiveTask(packet.task);
        if (packet?.type === 'quota_exhausted') {
          setError({
            code: packet.error || 'RESOURCE_EXHAUSTED',
            message: packet.message,
          });
          setStatus('error');
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!isCurrent()) return;
        roomRef.current = null;
        activeRoom.removeAllListeners();
        clearSessionState();
        void stopNativeAudio();
        setStatus(intentionalDisconnectRef.current ? 'disconnected' : 'error');
        if (!intentionalDisconnectRef.current) {
          setError({ code: 'ROOM_DISCONNECTED', message: 'The LiveKit room disconnected unexpectedly.' });
        }
      });

      await room.connect(token.wsUrl, token.token);
      if (!isCurrent()) {
        await Promise.resolve(room.disconnect());
        return null;
      }
      setStatus(hasAgentAudio ? 'connected' : 'waiting_for_agent');
      await room.localParticipant.setMicrophoneEnabled(!mutedRef.current);
      return token;
    } catch (caught) {
      if (generationRef.current !== generation) return null;
      roomRef.current = null;
      if (room) {
        await Promise.resolve(room.disconnect()).catch(() => undefined);
        room.removeAllListeners();
      }
      await stopNativeAudio();
      clearSessionState();
      setError(toVoiceBotError(caught));
      setStatus('error');
      throw caught;
    }
  }, [apiClient, clearSessionState, options.sessionConfig, setIsBotSpeaking, stopNativeAudio]);

  const toggleMute = useCallback(async (): Promise<void> => {
    const previous = mutedRef.current;
    const next = !previous;
    const room = roomRef.current;
    mutedRef.current = next;
    setIsMuted(next);
    if (next) setLocalAudioLevel(0);
    try {
      if (room) await room.localParticipant.setMicrophoneEnabled(!next);
    } catch (caught) {
      mutedRef.current = previous;
      setIsMuted(previous);
      setError(toVoiceBotError(caught));
    }
  }, []);

  const toggleSpeakerphone = useCallback(async (): Promise<void> => {
    const previous = speakerRef.current;
    const next = !previous;
    speakerRef.current = next;
    setIsSpeakerphoneOn(next);
    try {
      await selectOutput(next);
    } catch (caught) {
      speakerRef.current = previous;
      setIsSpeakerphoneOn(previous);
      setError(toVoiceBotError(caught));
    }
  }, []);

  const interrupt = useCallback(async (): Promise<InterruptResult> => {
    const room = roomRef.current;
    if (mutedRef.current) return { interrupted: false, reason: 'muted' };
    if (!botSpeakingRef.current) return { interrupted: false, reason: 'bot_not_speaking' };
    if (!room || room.state !== ConnectionState.Connected) {
      return { interrupted: false, reason: 'disconnected' };
    }

    const started = performance.now();
    setIsUserSpeaking(true);
    setIsBotSpeaking(false);
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'response.cancel' }));
    await room.localParticipant.publishData(payload, { reliable: true });
    setTimeout(() => {
      setIsUserSpeaking(false);
      if (roomRef.current === room) {
        setIsBotSpeaking(room.activeSpeakers.some((participant) => !participant.isLocal));
      }
    }, 350);
    return { interrupted: true, elapsedMs: performance.now() - started };
  }, [setIsBotSpeaking, setIsUserSpeaking]);

  useEffect(() => {
    if (!['connected', 'waiting_for_agent', 'reconnecting'].includes(status)) return;
    const timer = setInterval(() => {
      const room = roomRef.current;
      if (!room) return;
      setLocalAudioLevel(mutedRef.current ? 0 : Math.round(room.localParticipant.audioLevel * 100));
      const remote = Math.max(0, ...Array.from(room.remoteParticipants.values(), (p) => p.audioLevel));
      setRemoteAudioLevel(Math.round(remote * 100));
    }, 120);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => () => {
    generationRef.current += 1;
    intentionalDisconnectRef.current = true;
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    room?.removeAllListeners();
    void stopNativeAudio();
  }, [stopNativeAudio]);

  return {
    status,
    isConnected: status === 'connected',
    isBotSpeaking,
    isUserSpeaking,
    isMuted,
    isSpeakerphoneOn,
    localAudioLevel,
    remoteAudioLevel,
    transcripts,
    activeTask,
    error,
    initiateCall,
    endCall,
    toggleMute,
    toggleSpeakerphone,
    interrupt,
  };
}

export default useVoiceBot;
