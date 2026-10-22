import { timingSafeEqual } from 'node:crypto';
import {
  type CreateRoomResponse,
  type EndReason,
  type InvitePreviewResponse,
  type JoinRoomResponse,
  type ParticipantView,
  type RoomView,
  createRoomSchema,
  joinRoomSchema,
  type CreateRoomRequest,
  type JoinRoomRequest,
} from '@parley/shared';
import { AppError } from '../errors.js';
import { type Db, withTransaction } from '../db/pool.js';
import * as repo from './repository.js';
import type { ParticipantRow, RoomRow } from './repository.js';
import { canTransition, nextStatus } from './lifecycle.js';
import { hashToken, newRoomId, newSecret } from './tokens.js';

export interface Presence {
  isConnected(participantId: string): boolean;
  connectedCount(roomId: string): number;
}

export interface RoomServiceOptions {
  db: Db;
  presence: Presence;
  isLanguageAvailable: (code: string) => boolean;
  /** Called after any change that connected clients should hear about. */
  onRoomChanged: (roomId: string) => void;
}

export interface AuthenticatedParticipant {
  room: RoomRow;
  participant: ParticipantRow;
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class RoomService {
  constructor(private readonly opts: RoomServiceOptions) {}

  toRoomView(room: RoomRow): RoomView {
    return {
      id: room.id,
      callType: room.call_type,
      title: room.title,
      status: room.status,
      endReason: room.end_reason,
      inviteRevoked: room.invite_revoked_at !== null,
      expiresAt: room.expires_at.toISOString(),
      createdAt: room.created_at.toISOString(),
      expectedGuestLanguage: room.expected_guest_language,
      expectedGuestOutputLanguage: room.expected_guest_output_language,
    };
  }

  toParticipantView(p: ParticipantRow): ParticipantView {
    return {
      id: p.id,
      role: p.role,
      displayName: p.display_name,
      spokenLanguage: p.spoken_language,
      outputLanguage: p.output_language,
      connected: this.opts.presence.isConnected(p.id),
    };
  }

  private assertLanguages(codes: string[]): void {
    const missing = codes.filter((c) => !this.opts.isLanguageAvailable(c));
    if (missing.length > 0) {
      throw new AppError(
        'language_unsupported',
        `Translation is not available for: ${[...new Set(missing)].join(', ')}`,
      );
    }
  }

  async create(input: CreateRoomRequest): Promise<CreateRoomResponse> {
    const data = createRoomSchema.parse(input);
    this.assertLanguages([
      data.hostLanguage,
      data.hostOutputLanguage,
      data.guestLanguage,
      data.guestOutputLanguage,
    ]);
    const inviteToken = newSecret();
    const participantToken = newSecret();
    const room = await withTransaction(this.opts.db, async (tx) => {
      const created = await repo.insertRoom(tx, {
        id: newRoomId(),
        call_type: data.callType,
        title: data.title || null,
        invite_token_hash: hashToken(inviteToken),
        expected_guest_language: data.guestLanguage,
        expected_guest_output_language: data.guestOutputLanguage,
        expires_at: new Date(Date.now() + data.expiresInMinutes * 60_000),
      });
      await repo.insertParticipant(tx, {
        room_id: created.id,
        role: 'host',
        display_name: data.hostName || 'Host',
        spoken_language: data.hostLanguage,
        output_language: data.hostOutputLanguage,
        token_hash: hashToken(participantToken),
      });
      return created;
    });
    return { room: this.toRoomView(room), participantToken, inviteToken };
  }

  /** Throws the appropriate error if the invitation cannot be used right now. */
  private checkInvite(room: RoomRow | undefined, inviteToken: string): asserts room is RoomRow {
    // Unknown room and wrong token produce the same error so room ids cannot be enumerated.
    if (!room || !sameHash(room.invite_token_hash, hashToken(inviteToken))) {
      throw new AppError('invite_invalid', 'This invitation link is not valid.');
    }
    if (room.status === 'ended') {
      throw new AppError(
        room.end_reason === 'expired' ? 'invite_expired' : 'room_ended',
        room.end_reason === 'expired'
          ? 'This invitation has expired.'
          : 'This call has already ended.',
      );
    }
    if (room.invite_revoked_at)
      throw new AppError('invite_revoked', 'The host revoked this invitation.');
    if (room.expires_at.getTime() <= Date.now())
      throw new AppError('invite_expired', 'This invitation has expired.');
  }

  async preview(roomId: string, inviteToken: string): Promise<InvitePreviewResponse> {
    const room = await repo.findRoom(this.opts.db, roomId);
    this.checkInvite(room, inviteToken);
    const participants = await repo.listParticipants(this.opts.db, roomId);
    if (participants.some((p) => p.role === 'guest'))
      throw new AppError('room_full', 'Someone has already joined this call.');
    const host = participants.find((p) => p.role === 'host');
    if (!host) throw new AppError('invite_invalid', 'This invitation link is not valid.');
    return {
      room: {
        id: room.id,
        callType: room.call_type,
        title: room.title,
        expiresAt: room.expires_at.toISOString(),
        expectedGuestLanguage: room.expected_guest_language,
        expectedGuestOutputLanguage: room.expected_guest_output_language,
      },
      host: {
        displayName: host.display_name,
        spokenLanguage: host.spoken_language,
        outputLanguage: host.output_language,
      },
    };
  }

  async join(roomId: string, input: JoinRoomRequest): Promise<JoinRoomResponse> {
    const data = joinRoomSchema.parse(input);
    this.assertLanguages([data.spokenLanguage, data.outputLanguage]);
    const participantToken = newSecret();
    const room = await withTransaction(this.opts.db, async (tx) => {
      // Row lock serializes concurrent joins for the same room.
      const locked = await repo.findRoom(tx, roomId, true);
      this.checkInvite(locked, data.inviteToken);
      const participants = await repo.listParticipants(tx, roomId);
      if (participants.length >= 2)
        throw new AppError('room_full', 'Someone has already joined this call.');
      await repo.insertParticipant(tx, {
        room_id: roomId,
        role: 'guest',
        display_name: data.displayName,
        spoken_language: data.spokenLanguage,
        output_language: data.outputLanguage,
        token_hash: hashToken(participantToken),
      });
      const status = nextStatus(locked.status, true, this.opts.presence.connectedCount(roomId));
      return (await repo.setRoomStatus(tx, roomId, status)) ?? locked;
    });
    this.opts.onRoomChanged(roomId);
    return { room: this.toRoomView(room), participantToken };
  }

  /** Resolves a participant session token. Throws `unauthorized` for anything that does not match. */
  async authenticate(roomId: string, token: string | undefined): Promise<AuthenticatedParticipant> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{22}$/.test(roomId)) {
      throw new AppError('unauthorized', 'You are not a participant in this call.');
    }
    const participant = await repo.findParticipantByToken(this.opts.db, roomId, hashToken(token));
    const room = participant && (await repo.findRoom(this.opts.db, roomId));
    if (!participant || !room)
      throw new AppError('unauthorized', 'You are not a participant in this call.');
    return { room, participant };
  }

  async snapshot(roomId: string): Promise<{ room: RoomRow; participants: ParticipantRow[] }> {
    const room = await repo.findRoom(this.opts.db, roomId);
    if (!room) throw new AppError('not_found', 'Room not found.');
    return { room, participants: await repo.listParticipants(this.opts.db, roomId) };
  }

  /** Re-evaluates status after presence changes (someone connected or disconnected). */
  async refreshStatus(roomId: string): Promise<RoomRow | undefined> {
    const updated = await withTransaction(this.opts.db, async (tx) => {
      const room = await repo.findRoom(tx, roomId, true);
      if (!room || room.status === 'ended') return room;
      const participants = await repo.listParticipants(tx, roomId);
      const status = nextStatus(
        room.status,
        participants.some((p) => p.role === 'guest'),
        this.opts.presence.connectedCount(roomId),
      );
      return status === room.status ? room : await repo.setRoomStatus(tx, roomId, status);
    });
    this.opts.onRoomChanged(roomId);
    return updated;
  }

  async end(auth: AuthenticatedParticipant): Promise<RoomRow> {
    const { room, participant } = auth;
    if (room.status === 'ended') return room;
    if (!canTransition(room.status, 'ended'))
      throw new AppError('bad_request', 'The call cannot be ended now.');
    // A host leaving before anyone joined is a cancellation; otherwise either side can hang up.
    const reason: EndReason =
      room.status === 'waiting' && participant.role === 'host' ? 'cancelled' : 'ended';
    const ended = (await repo.setRoomStatus(this.opts.db, room.id, 'ended', reason)) ?? room;
    this.opts.onRoomChanged(room.id);
    return ended;
  }

  async revokeInvite(auth: AuthenticatedParticipant): Promise<RoomRow> {
    if (auth.participant.role !== 'host')
      throw new AppError('forbidden', 'Only the host can revoke the invitation.');
    if (auth.room.status === 'ended')
      throw new AppError('room_ended', 'This call has already ended.');
    await repo.revokeInvite(this.opts.db, auth.room.id);
    this.opts.onRoomChanged(auth.room.id);
    const room = await repo.findRoom(this.opts.db, auth.room.id);
    return room ?? auth.room;
  }

  async touch(participantId: string): Promise<void> {
    await repo.touchParticipant(this.opts.db, participantId);
  }
}
