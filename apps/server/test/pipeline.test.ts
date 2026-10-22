import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@parley/shared';
import { LoopGuard } from '../src/translation/loopGuard.js';
import { type PipelineOptions, SpeakerPipeline } from '../src/translation/pipeline.js';
import type { RecognitionHandlers, SpeechProviders } from '../src/translation/providers.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
  overrides: Partial<PipelineOptions> = {},
  opts: {
    translate?: SpeechProviders['translation']['translate'];
    synthesize?: SpeechProviders['tts']['synthesize'];
  } = {},
) {
  const streams: {
    handlers: RecognitionHandlers;
    options: { languageCode: string };
    written: number;
    ended: boolean;
    destroyed: boolean;
  }[] = [];
  const translate = vi.fn(
    opts.translate ?? (async (text: string, _from: string, to: string) => `${to}:${text}`),
  );
  const synthesize = vi.fn(
    opts.synthesize ??
      (async (text: string) => ({ audio: Buffer.from(text), mimeType: 'audio/mpeg' })),
  );
  const providers: SpeechProviders = {
    name: 'mock',
    stt: {
      openStream(options, handlers) {
        const s = { handlers, options, written: 0, ended: false, destroyed: false };
        streams.push(s);
        return {
          write: (pcm) => void (s.written += pcm.length),
          end: () => void (s.ended = true),
          destroy: () => void (s.destroyed = true),
        };
      },
    },
    translation: { translate },
    tts: { synthesize },
    capabilities: async () => ({ translationLanguages: new Set(), voices: new Set() }),
    close: async () => {},
  };
  const toSpeaker: ServerMessage[] = [];
  const broadcast: ServerMessage[] = [];
  let clock = 1_000_000;
  const guard = new LoopGuard(30_000, 0.72, () => clock);
  const pipeline = new SpeakerPipeline({
    speaker: { id: 'host', spokenLanguage: 'hi-IN' },
    listener: { id: 'guest', outputLanguage: 'id-ID' },
    providers,
    guard,
    sendToSpeaker: (m) => toSpeaker.push(m),
    broadcast: (m) => broadcast.push(m),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => clock,
    ...overrides,
  });
  return {
    pipeline,
    streams,
    translate,
    synthesize,
    toSpeaker,
    broadcast,
    guard,
    advance: (ms: number) => (clock += ms),
    audio: (ms = 100) => pipeline.pushAudio(Buffer.alloc((16_000 * 2 * ms) / 1000)),
  };
}

const audioOut = (msgs: ServerMessage[]) =>
  msgs.filter(
    (m): m is Extract<ServerMessage, { type: 'translated-audio' }> => m.type === 'translated-audio',
  );

describe('SpeakerPipeline', () => {
  it('uses the speaker language for recognition and the listener language for translation and voice', async () => {
    const t = setup();
    t.audio();
    expect(t.streams[0]!.options.languageCode).toBe('hi-IN');
    t.streams[0]!.handlers.onResult({ text: 'नमस्ते', isFinal: true });
    await flush();
    expect(t.translate).toHaveBeenCalledWith('नमस्ते', 'hi', 'id', expect.any(AbortSignal));
    expect(t.synthesize).toHaveBeenCalledWith(
      'id:नमस्ते',
      'id-ID',
      'id-ID-Wavenet-A',
      expect.any(AbortSignal),
    );
    const [audio] = audioOut(t.toSpeaker);
    expect(audio).toMatchObject({ sequence: 1, mimeType: 'audio/mpeg' });
    expect(Buffer.from(audio!.audioBase64, 'base64').toString()).toBe('id:नमस्ते');
    expect(t.broadcast.find((m) => m.type === 'translation')).toMatchObject({
      text: 'id:नमस्ते',
      language: 'id-ID',
      sourceText: 'नमस्ते',
    });
  });

  it('shows partial transcripts but only translates final ones', async () => {
    const t = setup();
    t.audio();
    const h = t.streams[0]!.handlers;
    h.onResult({ text: 'hel', isFinal: false });
    h.onResult({ text: 'hello', isFinal: false });
    h.onResult({ text: 'hello there', isFinal: true });
    await flush();
    const transcripts = t.broadcast.filter((m) => m.type === 'transcript');
    expect(transcripts.map((m) => m.type === 'transcript' && m.final)).toEqual([
      false,
      false,
      true,
    ]);
    // Partials and the final share one utterance id.
    expect(new Set(transcripts.map((m) => m.type === 'transcript' && m.utteranceId)).size).toBe(1);
    expect(t.translate).toHaveBeenCalledTimes(1);
  });

  it('delivers translated audio in speaking order even when later work finishes first', async () => {
    const slow = deferred<string>();
    const t = setup(
      {},
      { translate: async (text) => (text === 'first' ? slow.promise : `x:${text}`) },
    );
    t.audio();
    const h = t.streams[0]!.handlers;
    h.onResult({ text: 'first', isFinal: true });
    h.onResult({ text: 'second', isFinal: true });
    await flush();
    expect(audioOut(t.toSpeaker)).toHaveLength(0);
    slow.resolve('x:first');
    await flush();
    await flush();
    expect(audioOut(t.toSpeaker).map((m) => m.sequence)).toEqual([1, 2]);
    const ids = t.broadcast
      .filter((m) => m.type === 'transcript')
      .map((m) => m.type === 'transcript' && m.utteranceId);
    expect(new Set(ids).size).toBe(2);
  });

  it('drops a duplicate final transcript', async () => {
    const t = setup();
    t.audio();
    const h = t.streams[0]!.handlers;
    h.onResult({ text: 'Apa kabar?', isFinal: true });
    t.advance(500);
    h.onResult({ text: 'apa kabar', isFinal: true });
    await flush();
    expect(t.translate).toHaveBeenCalledTimes(1);
    t.advance(5_000);
    h.onResult({ text: 'apa kabar', isFinal: true });
    await flush();
    expect(t.translate).toHaveBeenCalledTimes(2);
  });

  it('does not translate speech that echoes a translation recently played to the speaker', async () => {
    const t = setup();
    t.guard.remember('host', 'आप कैसे हैं?');
    t.audio();
    t.streams[0]!.handlers.onResult({ text: 'आप कैसे हैं', isFinal: true });
    await flush();
    expect(t.translate).not.toHaveBeenCalled();
    // The speaker's own new sentence still goes through.
    t.streams[0]!.handlers.onResult({ text: 'मैं ठीक हूँ, धन्यवाद', isFinal: true });
    await flush();
    expect(t.translate).toHaveBeenCalledTimes(1);
  });

  it('registers what it synthesizes so the listener cannot loop it back', async () => {
    const t = setup();
    t.audio();
    t.streams[0]!.handlers.onResult({ text: 'hello friend', isFinal: true });
    await flush();
    expect(t.guard.isEcho('guest', 'id:hello friend')).toBe(true);
    expect(t.guard.isEcho('host', 'id:hello friend')).toBe(false);
  });

  it('reports translation failures without sending audio and recovers afterwards', async () => {
    let fail = true;
    const t = setup(
      {},
      {
        translate: async (text) => {
          if (fail) throw new Error('quota');
          return `ok:${text}`;
        },
      },
    );
    t.audio();
    t.streams[0]!.handlers.onResult({ text: 'one', isFinal: true });
    await flush();
    await flush();
    expect(audioOut(t.toSpeaker)).toHaveLength(0);
    expect(
      t.broadcast.find((m) => m.type === 'translation-status' && m.state === 'error'),
    ).toBeTruthy();
    fail = false;
    t.streams[0]!.handlers.onResult({ text: 'two', isFinal: true });
    await flush();
    await flush();
    expect(audioOut(t.toSpeaker)).toHaveLength(1);
    expect(t.broadcast.at(-1)).toMatchObject({ type: 'translation-status', state: 'listening' });
  });

  it('times out slow synthesis', async () => {
    vi.useFakeTimers();
    try {
      const t = setup(
        { timings: { synthesisTimeoutMs: 1_000 } },
        { synthesize: () => new Promise(() => {}) },
      );
      t.audio();
      t.streams[0]!.handlers.onResult({ text: 'hang', isFinal: true });
      await vi.advanceTimersByTimeAsync(1_100);
      expect(audioOut(t.toSpeaker)).toHaveLength(0);
      expect(t.broadcast.some((m) => m.type === 'translation-status' && m.state === 'error')).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops translated audio that would arrive too late', async () => {
    const gate = deferred<{ audio: Buffer; mimeType: string }>();
    const t = setup({}, { synthesize: () => gate.promise });
    t.audio();
    t.streams[0]!.handlers.onResult({ text: 'late', isFinal: true });
    await flush();
    t.advance(20_000);
    gate.resolve({ audio: Buffer.from('x'), mimeType: 'audio/mpeg' });
    await flush();
    await flush();
    expect(audioOut(t.toSpeaker)).toHaveLength(0);
    // Captions still show the translation.
    expect(t.broadcast.some((m) => m.type === 'translation')).toBe(true);
  });

  it('skips translation and speech when both people use the same language', async () => {
    const t = setup({ listener: { id: 'guest', outputLanguage: 'hi-IN' } });
    t.audio();
    t.streams[0]!.handlers.onResult({ text: 'same', isFinal: true });
    await flush();
    expect(t.translate).not.toHaveBeenCalled();
    expect(t.synthesize).not.toHaveBeenCalled();
    expect(t.broadcast.find((m) => m.type === 'translation')).toMatchObject({ text: 'same' });
  });

  it('measures recognition latency from when the recognized audio arrived', async () => {
    const t = setup();
    t.audio(500);
    t.advance(300);
    t.audio(500); // audio up to 1000 ms arrived at +300 ms
    t.advance(700);
    t.streams[0]!.handlers.onResult({ text: 'timed', isFinal: true, endOffsetMs: 900 });
    await flush();
    expect(audioOut(t.toSpeaker)[0]!.latency.recognitionMs).toBe(700);
  });

  it('rotates long streams and reopens after the provider closes one', () => {
    const t = setup({ timings: { streamRotateMs: 1_000 } });
    t.audio();
    t.advance(1_200);
    t.audio();
    expect(t.streams).toHaveLength(2);
    expect(t.streams[0]!.ended).toBe(true);
    t.streams[1]!.handlers.onClose();
    t.audio();
    expect(t.streams).toHaveLength(3);
  });

  it('pauses recognition after repeated stream errors', () => {
    const t = setup({ timings: { maxConsecutiveErrors: 2, errorCooldownMs: 10_000 } });
    t.audio();
    t.streams[0]!.handlers.onError(new Error('boom'));
    t.audio();
    t.streams[1]!.handlers.onError(new Error('boom'));
    t.audio();
    expect(t.streams).toHaveLength(2);
    expect(t.broadcast.at(-1)).toMatchObject({ type: 'translation-status', state: 'error' });
    t.advance(10_001);
    t.audio();
    expect(t.streams).toHaveLength(3);
  });

  it('ignores audio while disabled and after stop', () => {
    const t = setup();
    t.pipeline.setEnabled(false);
    t.audio();
    expect(t.streams).toHaveLength(0);
    t.pipeline.setEnabled(true);
    t.audio();
    t.pipeline.stop();
    expect(t.streams[0]!.destroyed).toBe(true);
    t.audio();
    expect(t.streams).toHaveLength(1);
  });
});
