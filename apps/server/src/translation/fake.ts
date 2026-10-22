import { LANGUAGES } from '@parley/shared';
import type { SpeechProviders } from './providers.js';

/**
 * Deterministic stand-in providers for automated browser tests (only allowed when NODE_ENV=test).
 * "Recognizes" one utterance for every `utteranceMs` of audio received, "translates" by tagging
 * the text, and "synthesizes" a short tone as WAV. It proves routing, not translation quality.
 */
export function createFakeProviders(utteranceMs = 3_000): SpeechProviders {
  let counter = 0;
  return {
    name: 'fake',
    stt: {
      openStream(options, handlers) {
        let audioMs = 0;
        let nextAt = utteranceMs;
        let closed = false;
        return {
          write(pcm) {
            if (closed) return;
            audioMs += (pcm.length / 2 / options.sampleRateHertz) * 1000;
            if (audioMs >= nextAt - utteranceMs / 2 && audioMs < nextAt) {
              handlers.onResult({
                text: `test utterance ${counter + 1}`,
                isFinal: false,
                endOffsetMs: audioMs,
              });
            }
            if (audioMs >= nextAt) {
              counter += 1;
              nextAt += utteranceMs;
              handlers.onResult({
                text: `test utterance ${counter} in ${options.languageCode}`,
                isFinal: true,
                endOffsetMs: audioMs,
              });
            }
          },
          end() {
            closed = true;
            handlers.onClose();
          },
          destroy() {
            closed = true;
          },
        };
      },
    },
    translation: {
      async translate(text, _from, to) {
        return `[${to}] ${text}`;
      },
    },
    tts: {
      async synthesize() {
        return { audio: toneWav(), mimeType: 'audio/wav' };
      },
    },
    async capabilities() {
      return {
        translationLanguages: new Set(LANGUAGES.map((l) => l.translationCode)),
        voices: new Set(LANGUAGES.map((l) => l.ttsVoice)),
      };
    },
    async close() {},
  };
}

/** 0.8 s, 440 Hz sine tone as 16-bit mono WAV. */
function toneWav(sampleRate = 16_000, seconds = 0.8): Buffer {
  const samples = Math.floor(sampleRate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12_000),
      44 + i * 2,
    );
  }
  return buf;
}
