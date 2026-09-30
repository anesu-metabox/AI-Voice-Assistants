import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const mobileDir = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(resolve(mobileDir, relativePath), 'utf8');

describe('Production voice component wiring', () => {
  it('VoiceAssistant uses the production hook and exposes manual call controls', () => {
    const source = read('src/components/VoiceAssistant.tsx');
    assert.match(source, /useVoiceBot\(\)/);
    assert.match(source, /Start voice call/);
    assert.match(source, /End call/);
    assert.match(source, /toggleMute/);
    assert.match(source, /toggleSpeakerphone/);
    assert.match(source, /interrupt/);
  });

  it('the production hook owns native audio setup and teardown', () => {
    const source = read('src/hooks/useVoiceBot.ts');
    assert.match(source, /AudioSession\.configureAudio/);
    assert.match(source, /AudioSession\.startAudioSession/);
    assert.match(source, /AudioSession\.stopAudioSession/);
    assert.match(source, /room\.localParticipant\.setMicrophoneEnabled/);
    assert.match(source, /room\.removeAllListeners/);
  });
});
