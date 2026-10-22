import { defineConfig, devices } from '@playwright/test';

const PORT = 8090;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/parley_e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    // Runs the production build with deterministic test providers (see apps/server/src/translation/fake.ts).
    command: 'node apps/server/dist/server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_URL: E2E_DATABASE_URL,
      PUBLIC_ORIGINS: `http://localhost:${PORT}`,
      SERVE_WEB: 'true',
      WEB_DIST_DIR: 'apps/web/dist',
      AI_PROVIDER: 'fake',
      STUN_URLS: '',
      RATE_LIMIT_CREATE_PER_MIN: '1000',
      RATE_LIMIT_JOIN_PER_MIN: '1000',
      LOG_LEVEL: 'warn',
    },
  },
});
