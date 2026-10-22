import type { FastifyInstance, FastifyRequest } from 'fastify';
import { roomIdSchema } from '@parley/shared';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { iceServersFor } from '../ice.js';
import type { TranslationService } from '../translation/service.js';
import type { RoomService } from './service.js';

function roomIdParam(req: FastifyRequest): string {
  const parsed = roomIdSchema.safeParse((req.params as { id?: string }).id);
  // Malformed ids get the same answer as unknown ones.
  if (!parsed.success) throw new AppError('not_found', 'Room not found.');
  return parsed.data;
}

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export function registerRoomRoutes(
  app: FastifyInstance,
  deps: { config: Config; rooms: RoomService; translation: TranslationService },
): void {
  const { config, rooms, translation } = deps;
  const createLimit = {
    rateLimit: { max: config.RATE_LIMIT_CREATE_PER_MIN, timeWindow: '1 minute' },
  };
  const joinLimit = { rateLimit: { max: config.RATE_LIMIT_JOIN_PER_MIN, timeWindow: '1 minute' } };

  app.post('/api/rooms', { config: createLimit }, async (req, reply) => {
    const result = await rooms.create(req.body as never);
    req.log.info({ roomId: result.room.id, callType: result.room.callType }, 'room created');
    return reply.code(201).send(result);
  });

  app.post('/api/rooms/:id/preview', { config: joinLimit }, async (req) => {
    const body = (req.body ?? {}) as { inviteToken?: unknown };
    if (typeof body.inviteToken !== 'string')
      throw new AppError('invite_invalid', 'This invitation link is not valid.');
    return rooms.preview(roomIdParam(req), body.inviteToken);
  });

  app.post('/api/rooms/:id/join', { config: joinLimit }, async (req, reply) => {
    const id = roomIdParam(req);
    const result = await rooms.join(id, req.body as never);
    req.log.info({ roomId: id }, 'guest joined');
    return reply.code(201).send(result);
  });

  app.get('/api/rooms/:id/session', { config: joinLimit }, async (req) => {
    const auth = await rooms.authenticate(roomIdParam(req), bearer(req));
    const { room, participants } = await rooms.snapshot(auth.room.id);
    return {
      room: rooms.toRoomView(room),
      self: rooms.toParticipantView(auth.participant),
      participants: participants.map((p) => rooms.toParticipantView(p)),
      iceServers: iceServersFor(config, auth.participant.id),
      translation: translation.availability(),
    };
  });

  app.post('/api/rooms/:id/end', async (req) => {
    const auth = await rooms.authenticate(roomIdParam(req), bearer(req));
    const room = await rooms.end(auth);
    req.log.info({ roomId: room.id, reason: room.end_reason }, 'room ended');
    return { room: rooms.toRoomView(room) };
  });

  app.post('/api/rooms/:id/invite/revoke', async (req) => {
    const auth = await rooms.authenticate(roomIdParam(req), bearer(req));
    const room = await rooms.revokeInvite(auth);
    return { room: rooms.toRoomView(room) };
  });
}
