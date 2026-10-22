import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@parley/shared';
import { TEST_ORIGIN, createRoom, createTestApp, joinRoom } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

class Client {
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  readonly ws: WebSocket;
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;

  constructor(url: string, origin = TEST_ORIGIN) {
    this.ws = new WebSocket(url, { origin });
    this.opened = new Promise((resolve) => this.ws.once('open', () => resolve()));
    this.closed = new Promise((resolve) =>
      this.ws.once('close', (code) => {
        this.closeCode = code;
        resolve(code);
      }),
    );
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(msg)) return true;
        w.resolve(msg);
        return false;
      });
    });
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  next<T extends ServerMessage['type']>(
    type: T,
    where: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 5000,
  ) {
    const match = (m: ServerMessage) =>
      m.type === type && where(m as Extract<ServerMessage, { type: T }>);
    const existing = this.messages.find(match);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { type: T }>);
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => (clearTimeout(timer), resolve(m as Extract<ServerMessage, { type: T }>)),
      });
    });
  }
}

/** One second of 16 kHz, 16-bit PCM. */
const audioChunk = () => Buffer.alloc(32_000, 1);

describe('realtime hub', () => {
  let app: TestApp;
  let url: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.server.listen({ port: 0, host: '127.0.0.1' });
    url = `ws://127.0.0.1:${(app.server.server.address() as AddressInfo).port}/ws`;
  });
  afterAll(() => app.close());

  async function connected(roomId: string, token: string) {
    const c = new Client(url);
    await c.opened;
    c.send({ type: 'auth', roomId, token });
    await c.next('ready');
    return c;
  }

  it('rejects connections from other origins', async () => {
    const c = new Client(url, 'https://evil.example');
    expect(await c.closed).toBe(4408);
  });

  it('rejects bad tokens and binary data before authentication', async () => {
    const { room } = await createRoom(app);
    const bad = new Client(url);
    await bad.opened;
    bad.send({ type: 'auth', roomId: room.id, token: 'A'.repeat(43) });
    expect(await bad.closed).toBe(4401);
    expect(bad.messages[0]).toMatchObject({ type: 'error', code: 'unauthorized' });

    const binary = new Client(url);
    await binary.opened;
    binary.ws.send(Buffer.alloc(10));
    expect(await binary.closed).toBe(4401);
  });

  it('activates the room, relays signaling and media state, and ends for both', async () => {
    const { room, inviteToken, participantToken } = await createRoom(app);
    const host = await connected(room.id, participantToken);
    const guestToken = (await joinRoom(app, room.id, inviteToken)).json()
      .participantToken as string;
    await host.next('room-update', (m) => m.room.status === 'connecting');
    const guest = await connected(room.id, guestToken);
    await host.next(
      'room-update',
      (m) => m.room.status === 'active' && m.participants.every((p) => p.connected),
    );

    host.send({ type: 'signal', description: { type: 'offer', sdp: 'v=0 test' } });
    expect(await guest.next('signal')).toEqual({
      type: 'signal',
      description: { type: 'offer', sdp: 'v=0 test' },
    });
    guest.send({
      type: 'signal',
      candidate: {
        candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });
    expect((await host.next('signal')).candidate?.candidate).toContain('candidate:1');

    guest.send({ type: 'media-state', micMuted: true, cameraOff: false });
    expect(await host.next('peer-media-state')).toEqual({
      type: 'peer-media-state',
      micMuted: true,
      cameraOff: false,
    });

    host.send({ type: 'nonsense' });
    expect(await host.next('error')).toMatchObject({ code: 'bad_request' });

    await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/end`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(await guest.next('room-ended')).toEqual({ type: 'room-ended', reason: 'ended' });
    expect(await host.closed).toBe(4410);
    expect(await guest.closed).toBe(4410);
  });

  it('replaces an older connection for the same participant', async () => {
    const { room, participantToken } = await createRoom(app);
    const first = await connected(room.id, participantToken);
    await connected(room.id, participantToken);
    expect(await first.closed).toBe(4409);
  });

  it('translates each direction and routes synthesized audio only to the speaker', async () => {
    const { room, inviteToken, participantToken } = await createRoom(app);
    const host = await connected(room.id, participantToken);
    const guestToken = (await joinRoom(app, room.id, inviteToken)).json()
      .participantToken as string;
    const guest = await connected(room.id, guestToken);
    const ids = (await host.next('room-update', (m) => m.room.status === 'active')).participants;
    const hostId = ids.find((p) => p.role === 'host')!.id;
    const guestId = ids.find((p) => p.role === 'guest')!.id;

    // Fake recognizer emits one utterance per 3 s of audio.
    for (let i = 0; i < 3; i++) host.ws.send(audioChunk());
    const translation = await guest.next('translation', (m) => m.speakerId === hostId);
    expect(translation).toMatchObject({
      sourceText: 'test utterance 1 in hi-IN',
      language: 'id-ID',
      text: '[id] test utterance 1 in hi-IN',
    });
    await host.next('translation', (m) => m.speakerId === hostId);
    const audio = await host.next('translated-audio');
    expect(audio).toMatchObject({
      utteranceId: translation.utteranceId,
      mimeType: 'audio/wav',
      sequence: 1,
    });
    expect(audio.latency.totalMs).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < 3; i++) guest.ws.send(audioChunk());
    const reverse = await host.next('translation', (m) => m.speakerId === guestId);
    expect(reverse.text).toBe('[hi] test utterance 2 in id-ID');
    await guest.next('translated-audio');

    // The listener never receives the speaker's synthesized audio over the socket.
    expect(
      guest.messages
        .filter((m) => m.type === 'translated-audio')
        .every((m) => m.type === 'translated-audio' && m.utteranceId === reverse.utteranceId),
    ).toBe(true);
    expect(host.messages.filter((m) => m.type === 'translated-audio')).toHaveLength(1);

    // Playback events are relayed so the listener can show "translated voice playing".
    host.send({ type: 'playback', utteranceId: translation.utteranceId, state: 'started' });
    expect(await guest.next('peer-playback')).toEqual({
      type: 'peer-playback',
      utteranceId: translation.utteranceId,
      state: 'started',
    });

    // Pausing translation stops recognition for that speaker.
    host.send({ type: 'translation-control', enabled: false });
    await guest.next(
      'translation-status',
      (m) => m.participantId === hostId && m.state === 'disabled',
    );
    const before = guest.messages.length;
    for (let i = 0; i < 3; i++) host.ws.send(audioChunk());
    await new Promise((r) => setTimeout(r, 200));
    expect(guest.messages.slice(before).some((m) => m.type === 'transcript')).toBe(false);
    host.ws.close();
    guest.ws.close();
  });
});
