import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeProviders } from '../src/translation/fake.js';
import { createRoom, createTestApp, joinRoom, voiceRoom } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

describe('room API', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('creates a waiting room with secret tokens that are stored only as hashes', async () => {
    const res = await app.server.inject({ method: 'POST', url: '/api/rooms', payload: voiceRoom });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.room).toMatchObject({
      callType: 'voice',
      status: 'waiting',
      expectedGuestLanguage: 'id-ID',
    });
    expect(body.room.id).toMatch(/^[\w-]{22}$/);
    expect(body.inviteToken).toMatch(/^[\w-]{43}$/);
    expect(body.participantToken).toMatch(/^[\w-]{43}$/);
    const { rows } = await app.db.query('SELECT invite_token_hash FROM rooms WHERE id = $1', [
      body.room.id,
    ]);
    expect(rows[0].invite_token_hash).not.toBe(body.inviteToken);
    expect(rows[0].invite_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid bodies with a readable error', async () => {
    const cases = [
      { ...voiceRoom, callType: 'fax' },
      { ...voiceRoom, hostLanguage: 'xx-XX' },
      { ...voiceRoom, hostName: '<script>' },
      { ...voiceRoom, expiresInMinutes: 7 },
      {},
    ];
    for (const payload of cases) {
      const res = await app.server.inject({ method: 'POST', url: '/api/rooms', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('bad_request');
    }
    const garbage = await app.server.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(garbage.statusCode).toBe(400);
  });

  it('previews an invitation without exposing anything for wrong tokens or unknown rooms', async () => {
    const { room, inviteToken } = await createRoom(app);
    const ok = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/preview`,
      payload: { inviteToken },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().host).toEqual({
      displayName: 'Asha',
      spokenLanguage: 'hi-IN',
      outputLanguage: 'hi-IN',
    });

    const wrongToken = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/preview`,
      payload: { inviteToken: 'A'.repeat(43) },
    });
    const unknownRoom = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${'B'.repeat(22)}/preview`,
      payload: { inviteToken },
    });
    const malformed = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/x/preview`,
      payload: { inviteToken },
    });
    expect(wrongToken.statusCode).toBe(404);
    expect(unknownRoom.statusCode).toBe(404);
    // Identical responses, so room ids cannot be probed.
    expect(wrongToken.json()).toEqual(unknownRoom.json());
    expect(malformed.statusCode).toBe(404);
  });

  it('lets exactly one guest join and moves the room to connecting', async () => {
    const { room, inviteToken } = await createRoom(app);
    const first = await joinRoom(app, room.id, inviteToken);
    expect(first.statusCode).toBe(201);
    expect(first.json().room.status).toBe('connecting');
    const second = await joinRoom(app, room.id, inviteToken, 'Eve');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('room_full');
    const preview = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/preview`,
      payload: { inviteToken },
    });
    expect(preview.json().error.code).toBe('room_full');
  });

  it('enforces capacity under concurrent joins', async () => {
    const { room, inviteToken } = await createRoom(app);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => joinRoom(app, room.id, inviteToken, `Guest ${i}`)),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(11);
    const { rows } = await app.db.query(
      'SELECT count(*)::int AS n FROM room_participants WHERE room_id = $1',
      [room.id],
    );
    expect(rows[0].n).toBe(2);
  });

  it('rejects expired invitations', async () => {
    const { room, inviteToken } = await createRoom(app);
    await app.db.query(`UPDATE rooms SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      room.id,
    ]);
    const res = await joinRoom(app, room.id, inviteToken);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('invite_expired');
  });

  it('lets only the host revoke the invitation', async () => {
    const { room, inviteToken, participantToken } = await createRoom(app);
    const noAuth = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/invite/revoke`,
    });
    expect(noAuth.statusCode).toBe(401);
    const revoked = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/invite/revoke`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().room.inviteRevoked).toBe(true);
    const join = await joinRoom(app, room.id, inviteToken);
    expect(join.statusCode).toBe(410);
    expect(join.json().error.code).toBe('invite_revoked');

    const other = await createRoom(app);
    const guest = (await joinRoom(app, other.room.id, other.inviteToken)).json();
    const byGuest = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${other.room.id}/invite/revoke`,
      headers: { authorization: `Bearer ${guest.participantToken}` },
    });
    expect(byGuest.statusCode).toBe(403);
  });

  it('authorizes sessions only with the matching participant token', async () => {
    const a = await createRoom(app);
    const b = await createRoom(app);
    const session = (token?: string, id = a.room.id) =>
      app.server.inject({
        method: 'GET',
        url: `/api/rooms/${id}/session`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    expect((await session()).statusCode).toBe(401);
    expect((await session('garbage')).statusCode).toBe(401);
    expect((await session(b.participantToken)).statusCode).toBe(401);
    expect((await session(a.inviteToken)).statusCode).toBe(401);
    const ok = await session(a.participantToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      self: { role: 'host', displayName: 'Asha' },
      translation: { available: true, provider: 'fake' },
    });
    expect(ok.json().iceServers).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('ends rooms with the right reason and blocks joining afterwards', async () => {
    const cancelled = await createRoom(app);
    const res = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${cancelled.room.id}/end`,
      headers: { authorization: `Bearer ${cancelled.participantToken}` },
    });
    expect(res.json().room).toMatchObject({ status: 'ended', endReason: 'cancelled' });
    const late = await joinRoom(app, cancelled.room.id, cancelled.inviteToken);
    expect(late.statusCode).toBe(410);
    expect(late.json().error.code).toBe('room_ended');

    const call = await createRoom(app);
    const guest = (await joinRoom(app, call.room.id, call.inviteToken)).json();
    const ended = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${call.room.id}/end`,
      headers: { authorization: `Bearer ${guest.participantToken}` },
    });
    expect(ended.json().room).toMatchObject({ status: 'ended', endReason: 'ended' });
    // Ending twice is harmless.
    const again = await app.server.inject({
      method: 'POST',
      url: `/api/rooms/${call.room.id}/end`,
      headers: { authorization: `Bearer ${guest.participantToken}` },
    });
    expect(again.statusCode).toBe(200);
  });

  it('expires unjoined rooms, and purges ended rooms after retention', async () => {
    const { room } = await createRoom(app);
    await app.db.query(`UPDATE rooms SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      room.id,
    ]);
    await app.sweep();
    const { rows } = await app.db.query('SELECT status, end_reason FROM rooms WHERE id = $1', [
      room.id,
    ]);
    expect(rows[0]).toEqual({ status: 'ended', end_reason: 'expired' });
    await app.db.query(`UPDATE rooms SET ended_at = now() - interval '30 days' WHERE id = $1`, [
      room.id,
    ]);
    await app.sweep();
    const after = await app.db.query('SELECT 1 FROM room_participants WHERE room_id = $1', [
      room.id,
    ]);
    expect(after.rowCount).toBe(0);
  });

  it('sets security headers and reports health', async () => {
    const res = await app.server.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      database: 'ok',
      translation: { available: true, provider: 'fake' },
    });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toContain('microphone=(self)');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('room API limits and failures', () => {
  it('rate-limits room creation', async () => {
    const app = await createTestApp({ config: { RATE_LIMIT_CREATE_PER_MIN: '3' } });
    try {
      const codes = [];
      for (let i = 0; i < 4; i++)
        codes.push(
          (await app.server.inject({ method: 'POST', url: '/api/rooms', payload: voiceRoom }))
            .statusCode,
        );
      expect(codes).toEqual([201, 201, 201, 429]);
    } finally {
      await app.close();
    }
  });

  it('refuses languages the provider cannot serve', async () => {
    const base = createFakeProviders();
    const app = await createTestApp({
      providers: {
        ...base,
        capabilities: async () => ({
          ...(await base.capabilities()),
          translationLanguages: new Set(['hi', 'en']),
        }),
      },
    });
    try {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: voiceRoom,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toEqual({
        code: 'language_unsupported',
        message: 'Translation is not available for: id-ID',
      });
      const langs = (await app.server.inject({ method: 'GET', url: '/api/languages' })).json();
      expect(langs.languages.find((l: { code: string }) => l.code === 'id-ID').available).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('returns safe errors when the database is down', async () => {
    const { buildApp } = await import('../src/app.js');
    const { createPool } = await import('../src/db/pool.js');
    const { testConfig } = await import('./helpers.js');
    const db = createPool('postgres://postgres@localhost:1/none');
    const broken = await buildApp({ config: testConfig(), db, logger: false });
    try {
      const health = await broken.server.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(503);
      const res = await broken.server.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: voiceRoom,
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe('internal');
      expect(res.body).not.toMatch(/ECONNREFUSED|postgres/);
    } finally {
      await broken.server.close();
      await db.end();
    }
  });
});
