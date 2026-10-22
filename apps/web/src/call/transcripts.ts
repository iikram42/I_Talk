import type { ServerMessage } from '@parley/shared';

export interface Utterance {
  id: string;
  speakerId: string;
  sourceLanguage: string;
  sourceText: string;
  final: boolean;
  translation?: { language: string; text: string };
  latencyMs?: number;
  at: number;
}

const MAX_UTTERANCES = 100;

type TranscriptMessage = Extract<ServerMessage, { type: 'transcript' | 'translation' | 'translated-audio' }>;

/** Keeps captions in arrival order, merging partial → final → translation for each utterance. */
export function transcriptReducer(state: Utterance[], msg: TranscriptMessage): Utterance[] {
  const index = state.findIndex((u) => u.id === msg.utteranceId);
  const existing = index >= 0 ? state[index] : undefined;
  let next: Utterance;
  if (msg.type === 'transcript') {
    if (existing?.final && !msg.final) return state; // A late partial must not overwrite the final text.
    next = {
      id: msg.utteranceId,
      speakerId: msg.speakerId,
      sourceLanguage: msg.language,
      sourceText: msg.text,
      final: msg.final,
      at: existing?.at ?? Date.now(),
      ...(existing?.translation ? { translation: existing.translation } : {}),
    };
  } else if (msg.type === 'translation') {
    next = {
      id: msg.utteranceId,
      speakerId: msg.speakerId,
      sourceLanguage: existing?.sourceLanguage ?? '',
      sourceText: existing?.sourceText ?? msg.sourceText,
      final: true,
      at: existing?.at ?? Date.now(),
      translation: { language: msg.language, text: msg.text },
      latencyMs: msg.latency.recognitionMs + msg.latency.translationMs,
    };
  } else {
    if (!existing) return state;
    next = { ...existing, latencyMs: msg.latency.totalMs };
  }
  const updated = existing ? state.map((u, i) => (i === index ? next : u)) : [...state, next];
  return updated.length > MAX_UTTERANCES ? updated.slice(-MAX_UTTERANCES) : updated;
}
