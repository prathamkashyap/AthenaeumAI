import { defineConfig, devices } from '@playwright/test';

const appPort = process.env.E2E_APP_PORT || '8080';
const apiPort = process.env.PORT || process.env.E2E_API_PORT || '3001';
const apiRoot = process.env.VITE_API_ROOT || `http://127.0.0.1:${apiPort}/api/v1`;
// Default to the Mongo instance this machine actually runs. Previously this
// pointed at 27018, which is not listening, so the API never became ready and the
// whole suite failed with an opaque webServer timeout. Override with MONGODB_URI
// or MONGODB_URI_TEST to point somewhere else.
const mongoUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/athenaeumAI_e2e';
const jwtSecret = process.env.JWT_SECRET || 'playwright-local-test-secret';
const groqApiKey = process.env.GROQ_API_KEY || 'playwright-local-test-key';

// The real BullMQ lifecycle needs a live Redis, so it is opt-in. Left off, the
// backend runs with its queue disabled (NODE_ENV=test without
// ENABLE_JOB_QUEUE), which is the honest way to exercise everything up to the
// queue boundary without a Redis. The gated specs skip loudly rather than
// passing without having proved anything.
const realQueue = process.env.E2E_REAL_QUEUE === 'true';
const queueEnv = realQueue ? 'ENABLE_JOB_QUEUE=true' : '';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `NODE_ENV=test PORT=${apiPort} MONGODB_URI=${mongoUri} JWT_SECRET=${jwtSecret} GROQ_API_KEY=${groqApiKey} VITE_API_ROOT=${apiRoot} ${queueEnv} node backend/server.js`,
      url: `${apiRoot}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    // The worker is a separate entry point; server.js does not start it. It is
    // only started for the real-queue run, so no duplicate workers are ever
    // launched by a normal test run.
    ...(realQueue
      ? [{
          command: `NODE_ENV=test MONGODB_URI=${mongoUri} JWT_SECRET=${jwtSecret} GROQ_API_KEY=${groqApiKey} ENABLE_JOB_QUEUE=true node backend/worker.js`,
          url: `${apiRoot}/health/ready`,
          reuseExistingServer: false,
          timeout: 30000,
        }]
      : []),
    {
      command: `VITE_API_ROOT=${apiRoot} npm run dev -- --host 127.0.0.1 --port ${appPort}`,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
