import { randomUUID } from 'node:crypto';
import { AUDIO_SAMPLE_RATE, findLanguage, type ServerMessage, type TranslationState } from '@parley/shared';
import type { RecognitionResult, RecognitionStream, SpeechProviders } from './providers.js';
import type { LoopGuard } from './loopGuard.js';
import { normalize } from './loopGuard.js';
import { withTimeout } from './timeout.js';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface PipelineOptions {
  speaker: { id: string; spokenLanguage: string };
  listener: { id: string; outputLanguage: string };
  providers: SpeechProviders;
  guard: LoopGuard;
  /** Sends to the speaker only (translated audio is injected into their outgoing translation track). */
  sendToSpeaker: (msg: ServerMessage) => void;
  /** Sends to both participants (transcripts, translations, status). */
  broadcast: (msg: ServerMessage) => void;
  log: Logger;
  timings?: Partial<typeof DEFAULT_TIMINGS>;
  now?: () => number;
}

export const DEFAULT_TIMINGS = {
  translateTimeoutMs: 5_000,
  synthesisTimeoutMs: 8_000,
  /** Translated audio older than this is dropped rather than played late. */
  maxAudioDelayMs: 12_000,
  /** Streams are rotated before the provider's ~5 minute streaming limit. */
  streamRotateMs: 240_000,
  /** A repeated final transcript within this window is treated as a duplicate. */
  duplicateWindowMs: 3_000,
  /** After this many consecutive stream errors, pause recognition for `errorCooldownMs`. */
  maxConsecutiveErrors: 3,
  errorCooldownMs: 30_000,
};

interface StreamHandle {
  stream: RecognitionStream;
  openedAt: number;
  /** Milliseconds of audio written to this stream. */
  audioMs: number;
  /** (audio offset, wall clock) samples used to measure recognition latency. */
  marks: { audioMs: number; at: number }[];
  utteranceId: string | null;
}

/**
 * Translates one participant's speech for the other participant:
 * microphone PCM → streaming recognition → translation → speech synthesis.
 * Final transcripts are processed concurrently but delivered strictly in order.
 */
export class SpeakerPipeline {
  private readonly timings: typeof DEFAULT_TIMINGS;
  private readonly now: () => number;
  private current: StreamHandle | null = null;
  private enabled = true;
  private stopped = false;
  private sequence = 0;
  private delivery: Promise<void> = Promise.resolve();
  private lastFinal: { text: string; at: number } | null = null;
  private consecutiveErrors = 0;
  private pausedUntil = 0;
  private state: TranslationState = 'idle';

  constructor(private readonly opts: PipelineOptions) {
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.now = opts.now ?? Date.now;
  }

  get speakerId() {
    return this.opts.speaker.id;
  }

  /** Accepts 16 kHz, 16-bit little-endian mono PCM from the speaker's microphone. */
  pushAudio(pcm: Buffer): void {
    if (this.stopped || !this.enabled || pcm.length === 0 || pcm.length % 2 !== 0) return;
    const now = this.now();
    if (now < this.pausedUntil) return;

    if (this.current && now - this.current.openedAt >= this.timings.streamRotateMs) {
      // Half-close the old stream so its last results still arrive, then start a fresh one.
      this.current.stream.end();
      this.current = null;
    }
    const handle = this.current ?? this.open();
    handle.stream.write(pcm);
    handle.audioMs += (pcm.length / 2 / AUDIO_SAMPLE_RATE) * 1000;
    handle.marks.push({ audioMs: handle.audioMs, at: now });
    if (handle.marks.length > 600) handle.marks.splice(0, handle.marks.length - 600);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.closeCurrent();
    this.setState(enabled ? 'idle' : 'disabled');
  }

  stop(): void {
    this.stopped = true;
    this.closeCurrent(true);
  }

  private closeCurrent(destroy = false) {
    if (!this.current) return;
    if (destroy) this.current.stream.destroy();
    else this.current.stream.end();
    this.current = null;
  }

  private setState(state: TranslationState, message?: string) {
    if (state === this.state && !message) return;
    this.state = state;
    this.opts.broadcast({ type: 'translation-status', participantId: this.speakerId, state, ...(message ? { message } : {}) });
  }

  private open(): StreamHandle {
    const handle: StreamHandle = {
      stream: undefined as unknown as RecognitionStream,
      openedAt: this.now(),
      audioMs: 0,
      marks: [],
      utteranceId: null,
    };
    handle.stream = this.opts.providers.stt.openStream(
      { languageCode: this.opts.speaker.spokenLanguage, sampleRateHertz: AUDIO_SAMPLE_RATE },
      {
        onResult: (result) => this.onResult(handle, result),
        onError: (error) => this.onStreamError(handle, error),
        onClose: () => {
          if (this.current === handle) this.current = null;
        },
      },
    );
    this.current = handle;
    this.setState('listening');
    return handle;
  }

  private onStreamError(handle: StreamHandle, error: Error) {
    if (this.current === handle) this.current = null;
    if (this.stopped) return;
    this.consecutiveErrors += 1;
    this.opts.log.warn({ err: error.message, speakerId: this.speakerId }, 'speech recognition stream error');
    if (this.consecutiveErrors >= this.timings.maxConsecutiveErrors) {
      this.pausedUntil = this.now() + this.timings.errorCooldownMs;
      this.consecutiveErrors = 0;
      this.setState('error', 'Speech recognition is unavailable. Retrying shortly.');
    }
    // Otherwise the next audio chunk opens a new stream.
  }

  private onResult(handle: StreamHandle, result: RecognitionResult) {
    if (this.stopped) return;
    this.consecutiveErrors = 0;
    handle.utteranceId ??= randomUUID();
    const utteranceId = handle.utteranceId;
    const text = result.text.trim();

    if (!result.isFinal) {
      this.opts.broadcast({
        type: 'transcript',
        utteranceId,
        speakerId: this.speakerId,
        language: this.opts.speaker.spokenLanguage,
        text,
        final: false,
      });
      return;
    }

    handle.utteranceId = null;
    const finalAt = this.now();
    const normalized = normalize(text);
    if (!normalized) return;
    if (this.lastFinal && this.lastFinal.text === normalized && finalAt - this.lastFinal.at < this.timings.duplicateWindowMs) {
      return;
    }
    this.lastFinal = { text: normalized, at: finalAt };

    this.opts.broadcast({
      type: 'transcript',
      utteranceId,
      speakerId: this.speakerId,
      language: this.opts.speaker.spokenLanguage,
      text,
      final: true,
    });

    if (this.opts.guard.isEcho(this.speakerId, text)) {
      this.opts.log.info({ utteranceId, speakerId: this.speakerId }, 'dropped utterance matching recently played translation');
      return;
    }

    const recognitionMs = Math.max(0, finalAt - this.wallClockAt(handle, result.endOffsetMs));
    this.process(utteranceId, text, finalAt, recognitionMs);
  }

  /** Wall-clock time at which the audio at `offsetMs` reached the server. */
  private wallClockAt(handle: StreamHandle, offsetMs: number | undefined): number {
    if (offsetMs === undefined) return handle.marks.at(-1)?.at ?? this.now();
    const mark = handle.marks.find((m) => m.audioMs >= offsetMs);
    return (mark ?? handle.marks.at(-1))?.at ?? this.now();
  }

  private process(utteranceId: string, text: string, finalAt: number, recognitionMs: number) {
    const sequence = ++this.sequence;
    const from = findLanguage(this.opts.speaker.spokenLanguage);
    const to = findLanguage(this.opts.listener.outputLanguage);
    if (!from || !to) return;

    const work = (async () => {
      const t0 = this.now();
      const translated =
        from.translationCode === to.translationCode
          ? text
          : await withTimeout('translation', this.timings.translateTimeoutMs, (signal) =>
              this.opts.providers.translation.translate(text, from.translationCode, to.translationCode, signal),
            );
      const translationMs = this.now() - t0;
      this.opts.broadcast({
        type: 'translation',
        utteranceId,
        speakerId: this.speakerId,
        sourceText: text,
        language: to.code,
        text: translated,
        latency: { recognitionMs, translationMs },
      });
      if (from.translationCode === to.translationCode) return null; // Listener already understands the original audio.
      // Remember before playback starts so an echo cannot race the registration.
      this.opts.guard.remember(this.opts.listener.id, translated);
      const t1 = this.now();
      const audio = await withTimeout('synthesis', this.timings.synthesisTimeoutMs, (signal) =>
        this.opts.providers.tts.synthesize(translated, to.code, to.ttsVoice, signal),
      );
      return { audio, translationMs, synthesisMs: this.now() - t1 };
    })();

    this.delivery = this.delivery.then(async () => {
      let result: Awaited<typeof work>;
      try {
        result = await work;
      } catch (err) {
        this.opts.log.warn({ utteranceId, err: (err as Error).message }, 'translation failed');
        this.setState('error', 'Translation is temporarily unavailable. Captions may be missing.');
        return;
      }
      if (!result || this.stopped) return;
      if (this.state === 'error') this.setState('listening');
      const delay = this.now() - finalAt;
      const latency = {
        recognitionMs,
        translationMs: result.translationMs,
        synthesisMs: result.synthesisMs,
        totalMs: recognitionMs + delay,
      };
      if (delay > this.timings.maxAudioDelayMs) {
        this.opts.log.warn({ utteranceId, delay }, 'dropped stale translated audio');
        return;
      }
      this.opts.log.info({ utteranceId, speakerId: this.speakerId, ...latency }, 'utterance translated');
      this.opts.sendToSpeaker({
        type: 'translated-audio',
        utteranceId,
        sequence,
        mimeType: result.audio.mimeType,
        audioBase64: result.audio.audio.toString('base64'),
        latency,
      });
    });
  }
}
