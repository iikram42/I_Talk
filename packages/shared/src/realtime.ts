import { z } from 'zod';
import type { ParticipantView, RoomView } from './api.js';

/** Messages the browser sends over the room WebSocket (JSON text frames). Audio goes as binary frames. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), roomId: z.string().max(64), token: z.string().max(128) }),
  z.object({
    type: z.literal('signal'),
    /** Identifies the host's peer connection so stale signals from a replaced one are ignored. */
    connectionId: z.string().max(64).optional(),
    description: z
      .object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(100_000) })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(2_000),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('media-state'), micMuted: z.boolean(), cameraOff: z.boolean() }),
  z.object({ type: z.literal('translation-control'), enabled: z.boolean() }),
  z.object({
    type: z.literal('playback'),
    utteranceId: z.string().max(64),
    state: z.enum(['started', 'ended', 'skipped']),
  }),
  /** The answerer has a fresh peer connection and is ready for an offer. */
  z.object({ type: z.literal('peer-ready') }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type TranslationState = 'idle' | 'listening' | 'unavailable' | 'error' | 'disabled';

export interface UtteranceLatency {
  recognitionMs: number;
  translationMs: number;
  synthesisMs: number;
  totalMs: number;
}

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { type: 'ready'; selfId: string; room: RoomView; participants: ParticipantView[] }
  | { type: 'room-update'; room: RoomView; participants: ParticipantView[] }
  | { type: 'peer-media-state'; micMuted: boolean; cameraOff: boolean }
  | {
      type: 'signal';
      connectionId?: string;
      description?: { type: 'offer' | 'answer'; sdp: string };
      candidate?: RTCIceCandidateLike;
    }
  | { type: 'room-ended'; reason: string }
  | {
      type: 'transcript';
      utteranceId: string;
      speakerId: string;
      language: string;
      text: string;
      final: boolean;
    }
  | {
      type: 'translation';
      utteranceId: string;
      speakerId: string;
      sourceText: string;
      language: string;
      text: string;
      latency: Pick<UtteranceLatency, 'recognitionMs' | 'translationMs'>;
    }
  /** Synthesized speech for the *other* participant. Sent to the speaker, who injects it into the outgoing translation track. */
  | {
      type: 'translated-audio';
      utteranceId: string;
      sequence: number;
      mimeType: string;
      audioBase64: string;
      latency: UtteranceLatency;
    }
  | { type: 'peer-playback'; utteranceId: string; state: 'started' | 'ended' | 'skipped' }
  | { type: 'translation-status'; participantId: string; state: TranslationState; message?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'peer-ready' }
  | { type: 'pong' };

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** PCM format the browser streams to the server. */
export const AUDIO_SAMPLE_RATE = 16_000;
/** Largest binary audio frame accepted (1 s of 16-bit mono). */
export const MAX_AUDIO_FRAME_BYTES = AUDIO_SAMPLE_RATE * 2;
