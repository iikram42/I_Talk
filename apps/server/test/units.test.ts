import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { iceServersFor } from '../src/ice.js';
import { canTransition, nextStatus } from '../src/rooms/lifecycle.js';
import { hashToken, newRoomId, newSecret } from '../src/rooms/tokens.js';
import { LoopGuard, similarity } from '../src/translation/loopGuard.js';
import { testConfig } from './helpers.js';
import { createHmac } from 'node:crypto';

describe('room lifecycle', () => {
  it('only moves forward', () => {
    expect(canTransition('waiting', 'connecting')).toBe(true);
    expect(canTransition('active', 'waiting')).toBe(false);
    expect(canTransition('ended', 'active')).toBe(false);
    expect(nextStatus('waiting', false, 1)).toBe('waiting');
    expect(nextStatus('waiting', true, 1)).toBe('connecting');
    expect(nextStatus('waiting', true, 2)).toBe('active');
    expect(nextStatus('active', true, 0)).toBe('active');
    expect(nextStatus('ended', true, 2)).toBe('ended');
  });
});

describe('tokens', () => {
  it('are long, url-safe and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, newRoomId));
    expect(ids.size).toBe(1000);
    expect(newSecret()).toMatch(/^[\w-]{43}$/);
    expect(hashToken('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('loop guard', () => {
  it('matches near-identical text across scripts and ignores unrelated speech', () => {
    let now = 0;
    const guard = new LoopGuard(30_000, 0.72, () => now);
    guard.remember('a', 'Selamat pagi, apa kabar hari ini?');
    expect(guard.isEcho('a', 'selamat pagi apa kabar hari ini')).toBe(true);
    expect(guard.isEcho('a', 'apa kabar hari ini')).toBe(true);
    expect(guard.isEcho('a', 'saya mau pesan kopi')).toBe(false);
    expect(guard.isEcho('b', 'selamat pagi apa kabar hari ini')).toBe(false);
    guard.remember('a', 'こんにちは、元気ですか');
    expect(guard.isEcho('a', 'こんにちは元気ですか')).toBe(true);
    now = 31_000;
    expect(guard.isEcho('a', 'selamat pagi apa kabar hari ini')).toBe(false);
  });

  it('computes a symmetric similarity', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abcd', 'wxyz')).toBe(0);
    expect(similarity('night', 'nacht')).toBeCloseTo(similarity('nacht', 'night'));
  });
});

describe('ice servers', () => {
  it('issues time-limited coturn credentials only when TURN is configured', () => {
    expect(iceServersFor(testConfig({ STUN_URLS: '' }), 'p')).toEqual([]);
    const config = testConfig({
      TURN_URLS: 'turn:turn.example.com:3478,turns:turn.example.com:5349',
      TURN_SECRET: 's3cret',
      TURN_CREDENTIAL_TTL_SECONDS: '600',
    });
    const [stun, turn] = iceServersFor(config, 'participant-1', 1_000_000);
    expect(stun).toEqual({ urls: ['stun:stun.l.google.com:19302'] });
    expect(turn!.username).toBe('1600:participant-1');
    expect(turn!.credential).toBe(
      createHmac('sha1', 's3cret').update('1600:participant-1').digest('base64'),
    );
  });
});

describe('config', () => {
  it('validates required and dependent settings', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y', TURN_URLS: 'turn:a' })).toThrow(
      /TURN_SECRET/,
    );
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x/y', AI_PROVIDER: 'fake', NODE_ENV: 'production' }),
    ).toThrow(/only allowed/);
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x/y', GOOGLE_CREDENTIALS_JSON: '{bad' }),
    ).toThrow(/valid JSON/);
    const ok = loadConfig({
      DATABASE_URL: 'postgres://x/y',
      PUBLIC_ORIGINS: 'https://a.com, https://b.com',
    });
    expect(ok.PUBLIC_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(ok.PORT).toBe(8080);
  });
});
