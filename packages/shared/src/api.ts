import { z } from 'zod';
import { LANGUAGE_CODES } from './languages.js';

export const CALL_TYPES = ['voice', 'video'] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const ROOM_STATUSES = ['waiting', 'connecting', 'active', 'ended'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const END_REASONS = ['ended', 'cancelled', 'expired', 'abandoned'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const EXPIRY_OPTIONS_MINUTES = [15, 60, 240, 1440] as const;

const languageCode = z.enum(LANGUAGE_CODES);
const displayName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(40, 'Use 40 characters or fewer')
  .regex(/^[^<>]*$/, 'Names cannot contain < or >');

export const createRoomSchema = z.object({
  callType: z.enum(CALL_TYPES),
  hostLanguage: languageCode,
  hostOutputLanguage: languageCode,
  guestLanguage: languageCode,
  guestOutputLanguage: languageCode,
  hostName: displayName.optional(),
  title: z
    .string()
    .trim()
    .max(80)
    .regex(/^[^<>]*$/)
    .optional(),
  expiresInMinutes: z
    .number()
    .int()
    .refine((v) => (EXPIRY_OPTIONS_MINUTES as readonly number[]).includes(v), 'Unsupported expiry')
    .default(60),
});
export type CreateRoomRequest = z.input<typeof createRoomSchema>;

export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation');
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid room');

export const previewInviteSchema = z.object({ inviteToken: inviteTokenSchema });

export const joinRoomSchema = z.object({
  inviteToken: inviteTokenSchema,
  displayName,
  spokenLanguage: languageCode,
  outputLanguage: languageCode,
});
export type JoinRoomRequest = z.input<typeof joinRoomSchema>;

export type ParticipantRole = 'host' | 'guest';

export interface ParticipantView {
  id: string;
  role: ParticipantRole;
  displayName: string;
  spokenLanguage: string;
  outputLanguage: string;
  connected: boolean;
}

export interface RoomView {
  id: string;
  callType: CallType;
  title: string | null;
  status: RoomStatus;
  endReason: EndReason | null;
  inviteRevoked: boolean;
  expiresAt: string;
  createdAt: string;
  expectedGuestLanguage: string;
  expectedGuestOutputLanguage: string;
}

export interface CreateRoomResponse {
  room: RoomView;
  participantToken: string;
  inviteToken: string;
}

export interface InvitePreviewResponse {
  room: Pick<
    RoomView,
    | 'id'
    | 'callType'
    | 'title'
    | 'expiresAt'
    | 'expectedGuestLanguage'
    | 'expectedGuestOutputLanguage'
  >;
  host: Pick<ParticipantView, 'displayName' | 'spokenLanguage' | 'outputLanguage'>;
}

export interface JoinRoomResponse {
  room: RoomView;
  participantToken: string;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface SessionResponse {
  room: RoomView;
  self: ParticipantView;
  participants: ParticipantView[];
  iceServers: IceServerConfig[];
  translation: TranslationAvailability;
}

export interface TranslationAvailability {
  available: boolean;
  provider: string;
  reason?: string;
}

export interface LanguagesResponse {
  languages: { code: string; name: string; nativeName: string; available: boolean }[];
  translation: TranslationAvailability;
}

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'not_found',
  'invite_invalid',
  'invite_expired',
  'invite_revoked',
  'room_full',
  'room_ended',
  'forbidden',
  'rate_limited',
  'language_unsupported',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; requestId?: string };
}
