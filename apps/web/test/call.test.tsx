import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CallControls } from '../src/call/CallControls';
import { TranslationPlayer } from '../src/call/translationPlayer';
import { transcriptReducer } from '../src/call/transcripts';

describe('transcriptReducer', () => {
  it('merges partials, finals and translations per utterance', () => {
    let state = transcriptReducer([], {
      type: 'transcript',
      utteranceId: 'u1',
      speakerId: 'a',
      language: 'hi-IN',
      text: 'नम',
      final: false,
    });
    state = transcriptReducer(state, {
      type: 'transcript',
      utteranceId: 'u1',
      speakerId: 'a',
      language: 'hi-IN',
      text: 'नमस्ते',
      final: true,
    });
    // A late partial must not overwrite the final text.
    state = transcriptReducer(state, {
      type: 'transcript',
      utteranceId: 'u1',
      speakerId: 'a',
      language: 'hi-IN',
      text: 'नम',
      final: false,
    });
    state = transcriptReducer(state, {
      type: 'translation',
      utteranceId: 'u1',
      speakerId: 'a',
      sourceText: 'नमस्ते',
      language: 'id-ID',
      text: 'Halo',
      latency: { recognitionMs: 300, translationMs: 120 },
    });
    state = transcriptReducer(state, {
      type: 'transcript',
      utteranceId: 'u2',
      speakerId: 'b',
      language: 'id-ID',
      text: 'Apa',
      final: false,
    });
    expect(state).toHaveLength(2);
    expect(state[0]).toMatchObject({
      sourceText: 'नमस्ते',
      final: true,
      translation: { language: 'id-ID', text: 'Halo' },
      latencyMs: 420,
    });
    expect(state[1]).toMatchObject({ id: 'u2', final: false });
  });
});

class FakeSource {
  onended: (() => void) | null = null;
  buffer: unknown = null;
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}

function fakeContext() {
  const sources: FakeSource[] = [];
  const track = { stop: vi.fn() };
  const context = {
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [track] } }),
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    decodeAudioData: vi.fn(async () => ({})),
  };
  return { context: context as unknown as AudioContext, sources };
}

describe('TranslationPlayer', () => {
  it('plays clips one at a time and reports each state', async () => {
    const events: string[] = [];
    const { context, sources } = fakeContext();
    const player = new TranslationPlayer(
      context,
      (id, state) => events.push(`${id}:${state}`),
      () => 0,
    );
    player.enqueue({ utteranceId: 'a', audio: new ArrayBuffer(4), receivedAt: 0 });
    player.enqueue({ utteranceId: 'b', audio: new ArrayBuffer(4), receivedAt: 0 });
    await vi.waitFor(() => expect(events).toEqual(['a:started']));
    expect(player.busy).toBe(true);
    vi.useFakeTimers();
    sources[0]!.onended!();
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await vi.waitFor(() => expect(events).toEqual(['a:started', 'a:ended', 'b:started']));
  });

  it('skips the oldest clips when speech backs up, and clears on demand', async () => {
    const events: string[] = [];
    const { context } = fakeContext();
    const player = new TranslationPlayer(
      context,
      (id, state) => events.push(`${id}:${state}`),
      () => 0,
    );
    for (const id of ['a', 'b', 'c', 'd'])
      player.enqueue({ utteranceId: id, audio: new ArrayBuffer(4), receivedAt: 0 });
    await vi.waitFor(() => expect(events).toContain('a:started'));
    expect(events).toContain('b:skipped');
    player.clear();
    expect(events).toEqual(expect.arrayContaining(['c:skipped', 'd:skipped', 'a:skipped']));
  });

  it('drops clips that waited too long', async () => {
    const events: string[] = [];
    const { context } = fakeContext();
    const player = new TranslationPlayer(
      context,
      (id, state) => events.push(`${id}:${state}`),
      () => 10_000,
    );
    player.enqueue({ utteranceId: 'old', audio: new ArrayBuffer(4), receivedAt: 0 });
    await vi.waitFor(() => expect(events).toEqual(['old:skipped']));
  });
});

describe('CallControls', () => {
  it('exposes accessible, working controls', async () => {
    const handlers = {
      onMic: vi.fn(),
      onCamera: vi.fn(),
      onCaptions: vi.fn(),
      onTranslation: vi.fn(),
      onAudio: vi.fn(),
      onEnd: vi.fn(),
    };
    render(
      <CallControls
        isVideo
        micMuted
        cameraOff={false}
        cameraAvailable
        captionsOn
        translationEnabled
        audio={{ originalVolume: 0.25, sinkId: '' }}
        {...handlers}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide captions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause translating my speech' }));
    await userEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(handlers.onMic).toHaveBeenCalledOnce();
    expect(handlers.onCamera).toHaveBeenCalledOnce();
    expect(handlers.onCaptions).toHaveBeenCalledOnce();
    expect(handlers.onTranslation).toHaveBeenCalledOnce();
    expect(handlers.onEnd).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    const slider = screen.getByLabelText("Other person's original voice");
    expect(slider).toHaveValue('0.25');
  });
});
