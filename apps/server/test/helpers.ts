import { type App, buildApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { type Db, createPool } from '../src/db/pool.js';
import type { SpeechProviders } from '../src/translation/providers.js';

export const TEST_ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/parley_test',
    PUBLIC_ORIGINS: TEST_ORIGIN,
    AI_PROVIDER: 'fake',
    LOG_LEVEL: 'fatal',
    RATE_LIMIT_CREATE_PER_MIN: '10000',
    RATE_LIMIT_JOIN_PER_MIN: '10000',
    ...overrides,
  });
}

let migrated: Promise<unknown> | null = null;

export async function createTestApp(
  options: { config?: Record<string, string>; providers?: SpeechProviders } = {},
): Promise<App & { db: Db; close: () => Promise<void> }> {
  const config = testConfig(options.config);
  const db = createPool(config.DATABASE_URL);
  migrated ??= migrate(db);
  await migrated;
  const app = await buildApp({
    config,
    db,
    logger: false,
    ...(options.providers ? { providers: options.providers } : {}),
  });
  await app.translation.init();
  return {
    ...app,
    db,
    close: async () => {
      await app.server.close();
      await db.end();
    },
  };
}

export const voiceRoom = {
  callType: 'voice',
  hostLanguage: 'hi-IN',
  hostOutputLanguage: 'hi-IN',
  guestLanguage: 'id-ID',
  guestOutputLanguage: 'id-ID',
  hostName: 'Asha',
} as const;

export async function createRoom(app: App, body: object = voiceRoom) {
  const res = await app.server.inject({ method: 'POST', url: '/api/rooms', payload: body });
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
  return res.json<{
    room: { id: string; status: string };
    participantToken: string;
    inviteToken: string;
  }>();
}

export async function joinRoom(app: App, roomId: string, inviteToken: string, name = 'Budi') {
  return app.server.inject({
    method: 'POST',
    url: `/api/rooms/${roomId}/join`,
    payload: { inviteToken, displayName: name, spokenLanguage: 'id-ID', outputLanguage: 'id-ID' },
  });
}
