import type { WebSocket } from 'ws';
import {
  MAX_AUDIO_FRAME_BYTES,
  type ClientMessage,
  type ServerMessage,
  clientMessageSchema,
} from '@parley/shared';
import { AppError } from '../errors.js';
import type { ParticipantRow } from '../rooms/repository.js';
import type { Presence, RoomService } from '../rooms/service.js';
import { LoopGuard } from '../translation/loopGuard.js';
import { type Logger, SpeakerPipeline } from '../translation/pipeline.js';
import type { TranslationService } from '../translation/service.js';

interface Connection {
  socket: WebSocket;
  participant: ParticipantRow;
  roomId: string;
  messageBudget: { windowStart: number; count: number; audioBytes: number };
}

interface RoomState {
  connections: Map<string, Connection>;
  pipelines: Map<string, SpeakerPipeline>;
  guard: LoopGuard;
  /** Speakers who paused their own translation. */
  translationPaused: Set<string>;
}

const MAX_MESSAGES_PER_SECOND = 60;
const HEARTBEAT_MS = 30_000;
/** Allows bursts after a network hiccup while rejecting sustained faster-than-real-time audio. */
const MAX_AUDIO_BYTES_PER_SECOND = MAX_AUDIO_FRAME_BYTES * 3;
export const CLOSE_CODES = {
  unauthorized: 4401,
  replaced: 4409,
  ended: 4410,
  policy: 4408,
} as const;

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

/** Tracks live room connections, relays signaling, and runs translation for connected pairs. */
export class RealtimeHub implements Presence {
  private readonly rooms = new Map<string, RoomState>();
  private roomService!: RoomService;

  constructor(
    private readonly translation: TranslationService,
    private readonly log: Logger,
  ) {}

  attach(roomService: RoomService): void {
    this.roomService = roomService;
  }

  isConnected(participantId: string): boolean {
    for (const room of this.rooms.values()) if (room.connections.has(participantId)) return true;
    return false;
  }

  connectedCount(roomId: string): number {
    return this.rooms.get(roomId)?.connections.size ?? 0;
  }

  roomsWithPresence(): string[] {
    return [...this.rooms.keys()];
  }

  /** Handles a new socket: authenticates with the first message, then serves the session. */
  handle(socket: WebSocket): void {
    let conn: Connection | null = null;
    const authTimer = setTimeout(
      () => socket.close(CLOSE_CODES.unauthorized, 'Authentication timeout'),
      5_000,
    );
    // Detect half-open connections (e.g. a laptop that went to sleep) so presence stays accurate.
    let alive = true;
    socket.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('message', (data, isBinary) => {
      if (!conn) {
        if (isBinary) return socket.close(CLOSE_CODES.unauthorized, 'Authenticate first');
        void this.authenticate(socket, data.toString()).then((c) => {
          clearTimeout(authTimer);
          if (c) conn = c;
        });
        return;
      }
      if (!this.withinBudget(conn, isBinary ? (data as Buffer).length : 0)) return;
      if (isBinary) this.onAudio(conn, data as Buffer);
      else this.onMessage(conn, data.toString());
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (conn) void this.disconnect(conn);
    });
    socket.on('error', (err) => this.log.warn({ err: err.message }, 'websocket error'));
  }

  private async authenticate(socket: WebSocket, raw: string): Promise<Connection | null> {
    try {
      const msg = clientMessageSchema.parse(JSON.parse(raw));
      if (msg.type !== 'auth') throw new AppError('unauthorized', 'Authenticate first');
      const { room, participant } = await this.roomService.authenticate(msg.roomId, msg.token);
      if (room.status === 'ended') {
        send(socket, { type: 'room-ended', reason: room.end_reason ?? 'ended' });
        socket.close(CLOSE_CODES.ended, 'Room ended');
        return null;
      }
      if (socket.readyState !== socket.OPEN) return null;

      const state = this.roomState(room.id);
      const previous = state.connections.get(participant.id);
      const conn: Connection = {
        socket,
        participant,
        roomId: room.id,
        messageBudget: { windowStart: Date.now(), count: 0, audioBytes: 0 },
      };
      state.connections.set(participant.id, conn);
      if (previous) previous.socket.close(CLOSE_CODES.replaced, 'Opened in another tab');

      const updated = (await this.roomService.refreshStatus(room.id)) ?? room;
      const { participants } = await this.roomService.snapshot(room.id);
      send(socket, {
        type: 'ready',
        selfId: participant.id,
        room: this.roomService.toRoomView(updated),
        participants: participants.map((p) => this.roomService.toParticipantView(p)),
      });
      await this.roomService.touch(participant.id);
      this.syncPipelines(room.id, participants);
      return conn;
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Could not join the call.';
      send(socket, {
        type: 'error',
        code: err instanceof AppError ? err.code : 'unauthorized',
        message,
      });
      socket.close(CLOSE_CODES.unauthorized, 'Unauthorized');
      return null;
    }
  }

  private withinBudget(conn: Connection, audioBytes: number): boolean {
    const budget = conn.messageBudget;
    const now = Date.now();
    if (now - budget.windowStart >= 1_000) {
      budget.windowStart = now;
      budget.count = 0;
      budget.audioBytes = 0;
    }
    budget.count += 1;
    budget.audioBytes += audioBytes;
    if (budget.count > MAX_MESSAGES_PER_SECOND || budget.audioBytes > MAX_AUDIO_BYTES_PER_SECOND) {
      if (budget.count > MAX_MESSAGES_PER_SECOND * 5)
        conn.socket.close(CLOSE_CODES.policy, 'Too many messages');
      return false;
    }
    return true;
  }

  private onAudio(conn: Connection, data: Buffer) {
    if (data.length > MAX_AUDIO_FRAME_BYTES) return;
    this.rooms.get(conn.roomId)?.pipelines.get(conn.participant.id)?.pushAudio(data);
  }

  private onMessage(conn: Connection, raw: string) {
    let msg: ClientMessage;
    try {
      msg = clientMessageSchema.parse(JSON.parse(raw));
    } catch {
      send(conn.socket, { type: 'error', code: 'bad_request', message: 'Malformed message' });
      return;
    }
    const state = this.rooms.get(conn.roomId);
    if (!state) return;
    const peer = [...state.connections.values()].find(
      (c) => c.participant.id !== conn.participant.id,
    );

    switch (msg.type) {
      case 'signal':
        if (peer)
          send(peer.socket, {
            type: 'signal',
            connectionId: msg.connectionId,
            description: msg.description,
            candidate: msg.candidate,
          });
        break;
      case 'media-state':
        if (peer)
          send(peer.socket, {
            type: 'peer-media-state',
            micMuted: msg.micMuted,
            cameraOff: msg.cameraOff,
          });
        break;
      case 'playback':
        if (peer)
          send(peer.socket, {
            type: 'peer-playback',
            utteranceId: msg.utteranceId,
            state: msg.state,
          });
        break;
      case 'translation-control':
        if (msg.enabled) state.translationPaused.delete(conn.participant.id);
        else state.translationPaused.add(conn.participant.id);
        state.pipelines.get(conn.participant.id)?.setEnabled(msg.enabled);
        break;
      case 'peer-ready':
        if (peer) send(peer.socket, { type: 'peer-ready' });
        break;
      case 'ping':
        send(conn.socket, { type: 'pong' });
        break;
      case 'auth':
        break;
    }
  }

  private async disconnect(conn: Connection) {
    const state = this.rooms.get(conn.roomId);
    if (!state || state.connections.get(conn.participant.id) !== conn) return; // Already replaced.
    state.connections.delete(conn.participant.id);
    this.stopPipelines(state);
    if (state.connections.size === 0) this.rooms.delete(conn.roomId);
    try {
      await this.roomService.touch(conn.participant.id);
      await this.roomService.refreshStatus(conn.roomId);
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'failed to record disconnect');
    }
  }

  /** Called whenever a room changes; pushes the new state to connected participants. */
  async publishRoom(roomId: string): Promise<void> {
    const state = this.rooms.get(roomId);
    if (!state) return;
    const { room, participants } = await this.roomService.snapshot(roomId);
    if (room.status === 'ended') {
      this.stopPipelines(state);
      for (const c of state.connections.values()) {
        send(c.socket, { type: 'room-ended', reason: room.end_reason ?? 'ended' });
        c.socket.close(CLOSE_CODES.ended, 'Room ended');
      }
      this.rooms.delete(roomId);
      return;
    }
    const view = this.roomService.toRoomView(room);
    const people = participants.map((p) => this.roomService.toParticipantView(p));
    for (const c of state.connections.values())
      send(c.socket, { type: 'room-update', room: view, participants: people });
    this.syncPipelines(roomId, participants);
  }

  /** Runs one pipeline per direction while both participants are connected. */
  private syncPipelines(roomId: string, participants: ParticipantRow[]) {
    const state = this.rooms.get(roomId);
    if (!state) return;
    const providers = this.translation.providers;
    const bothConnected =
      participants.length === 2 && participants.every((p) => state.connections.has(p.id));
    if (!bothConnected || !providers || !this.translation.ready) {
      if (bothConnected && !this.translation.ready) {
        const { reason } = this.translation.availability();
        for (const p of participants) {
          this.broadcast(state, {
            type: 'translation-status',
            participantId: p.id,
            state: 'unavailable',
            ...(reason ? { message: reason } : {}),
          });
        }
      }
      return;
    }
    for (const speaker of participants) {
      if (state.pipelines.has(speaker.id)) continue;
      const listener = participants.find((p) => p.id !== speaker.id)!;
      const pipeline = new SpeakerPipeline({
        speaker: { id: speaker.id, spokenLanguage: speaker.spoken_language },
        listener: { id: listener.id, outputLanguage: listener.output_language },
        providers,
        guard: state.guard,
        sendToSpeaker: (msg) => {
          const c = state.connections.get(speaker.id);
          if (c) send(c.socket, msg);
        },
        broadcast: (msg) => this.broadcast(state, msg),
        log: this.log,
      });
      if (state.translationPaused.has(speaker.id)) pipeline.setEnabled(false);
      state.pipelines.set(speaker.id, pipeline);
    }
  }

  private stopPipelines(state: RoomState) {
    for (const p of state.pipelines.values()) p.stop();
    state.pipelines.clear();
  }

  private broadcast(state: RoomState, msg: ServerMessage) {
    for (const c of state.connections.values()) send(c.socket, msg);
  }

  private roomState(roomId: string): RoomState {
    let state = this.rooms.get(roomId);
    if (!state) {
      state = {
        connections: new Map(),
        pipelines: new Map(),
        guard: new LoopGuard(),
        translationPaused: new Set(),
      };
      this.rooms.set(roomId, state);
    }
    return state;
  }

  /** Closes every socket (used on shutdown). */
  closeAll(): void {
    for (const state of this.rooms.values()) {
      this.stopPipelines(state);
      for (const c of state.connections.values()) c.socket.close(1001, 'Server shutting down');
    }
    this.rooms.clear();
  }
}
