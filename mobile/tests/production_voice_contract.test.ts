import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseVoicePacket } from '../src/services/voicePackets.ts';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('Production voice packet parser', () => {
  it('normalizes a user transcript using production defaults', () => {
    const result = parseVoicePacket(encode({ type: 'transcript', speaker: 'user', text: '  hello  ' }), 1234, () => 'generated-id');
    assert.deepEqual(result, {
      type: 'transcript',
      transcript: {
        id: 'generated-id',
        role: 'user',
        text: 'hello',
        isFinal: true,
        timestamp: 1234,
      },
    });
  });

  it('preserves assistant packet metadata and finality', () => {
    const result = parseVoicePacket(encode({
      type: 'transcript', id: 'a1', role: 'assistant', text: 'answer', is_final: false, timestamp: 55,
    }), 1234);
    assert.equal(result?.type, 'transcript');
    assert.deepEqual(result && result.type === 'transcript' ? result.transcript : null, {
      id: 'a1', role: 'assistant', text: 'answer', isFinal: false, timestamp: 55,
    });
  });

  it('passes task updates through and ignores malformed packets', () => {
    const task = { id: 'task-1', status: 'running', title: 'Book meeting' };
    assert.deepEqual(parseVoicePacket(encode({ type: 'task_update', task })), { type: 'task_update', task });
    assert.equal(parseVoicePacket(encode({ type: 'transcript', text: '   ' })), null);
    assert.equal(parseVoicePacket(new TextEncoder().encode('not-json')), null);
  });
});
