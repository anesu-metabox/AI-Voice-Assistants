import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Check if the runtime is the standard Expo Go store client.
 * Expo Go cannot run third-party native code like @livekit/react-native or WebRTC.
 */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const isNativeLiveKitSupported = !isExpoGo && Platform.OS !== 'web';

let livekitModule: any = null;

if (isNativeLiveKitSupported) {
  try {
    // Dynamic require so Metro bundling doesn't crash runtime in Expo Go / Web
    livekitModule = require('@livekit/react-native');
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[LiveKit] Native WebRTC module not available in this environment. Falling back to mock session.',
        error,
      );
    }
    livekitModule = null;
  }
}

/**
 * Safely registers native WebRTC globals when supported.
 * In Expo Go or Web, gracefully no-ops without throwing Invariant Violation.
 */
export function registerLiveKitGlobals(): void {
  if (livekitModule && typeof livekitModule.registerGlobals === 'function') {
    try {
      livekitModule.registerGlobals();
    } catch (error) {
      console.warn('[LiveKit] Failed to register native WebRTC globals:', error);
    }
  } else if (__DEV__) {
    console.log(
      '[LiveKit] Native WebRTC globals bypassed (running in Expo Go or Web mode).',
    );
  }
}

export const registerGlobals = registerLiveKitGlobals;

export const SafeAudioSession = {
  async selectAudioOutput(output: string): Promise<void> {
    if (livekitModule?.AudioSession) {
      return livekitModule.AudioSession.selectAudioOutput(output);
    }
  },
  async configureAudio(options: any): Promise<void> {
    if (livekitModule?.AudioSession) {
      return livekitModule.AudioSession.configureAudio(options);
    }
  },
  async startAudioSession(): Promise<void> {
    if (livekitModule?.AudioSession) {
      return livekitModule.AudioSession.startAudioSession();
    }
  },
  async stopAudioSession(): Promise<void> {
    if (livekitModule?.AudioSession) {
      return livekitModule.AudioSession.stopAudioSession();
    }
  },
};

export const SafeAndroidAudioTypePresets = {
  communication: (livekitModule?.AndroidAudioTypePresets?.communication ?? {
    audioMode: 3,
    audioFocusMode: 'gain_transient',
  }) as any,
};
