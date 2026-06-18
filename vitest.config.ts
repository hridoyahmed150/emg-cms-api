import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Override DATABASE_URL to the dedicated test DB (does NOT touch dev data).
    // Set before modules load; dotenv won't override an already-set var.
    env: {
      DATABASE_URL: 'postgresql://emg:dev_password@localhost:5433/emg_cms_test',
      LOG_LEVEL: 'silent',
      R2_BUCKET: 'test-bucket',
      R2_PUBLIC_BASE: 'https://cdn.test',
    },
    fileParallelism: false, // test files share one DB
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
