import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // Integration tests share one database.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
