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

// The real-queue run gets a Redis of its own on a dedicated port.
//
// The application worker in Docker Compose consumes the same BullMQ queue, and it
// is connected to a different MongoDB database. It can therefore take a job this
// suite enqueued, fail to find the record the job names, and leave the BackgroundJob
// at `queued` indefinitely — which is exactly how the real-queue spec failed
// intermittently, with the Compose worker's own logs naming the E2E job ids. No
// assertion in the suite could have attributed that, and nothing inside the E2E
// environment can prevent it while both workers share one Redis.
//
// The port is passed to the API and the worker through the same REDIS_PORT the
// backend already reads in jobQueue.js and worker.js, so this adds no second
// configuration contract. Left unset, the real-queue run keeps sharing 6379 with
// the Compose stack, so a run must opt in to being isolated.
const e2eRedisPort = process.env.E2E_REDIS_PORT || '6380';
const e2eRedisEnv = realQueue ? `REDIS_PORT=${e2eRedisPort}` : '';

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
    // The dedicated Redis comes first: the API and the worker both connect to it,
    // so it has to be accepting connections before either of them is asked to
    // report ready. Omitted entirely unless the real queue is in use, so a normal
    // run still needs no Docker and no extra Redis.
    ...(realQueue
      ? [{
          command: 'bash tests/e2e/redis-isolated-instance.sh',
          // Probed on the port, not a URL. Redis speaks no HTTP, and there is no
          // honest readiness endpoint to point at; Playwright only needs to know
          // the port is accepting connections before it starts the processes below.
          port: Number(e2eRedisPort),
          // Never reuse: a Redis already on this port is either a leftover from an
          // aborted run (which the script clears) or something else entirely, and
          // sharing it silently would reintroduce the collision this isolates.
          reuseExistingServer: false,
          gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10000 },
          timeout: 60000,
        }]
      : []),
    {
      command: `NODE_ENV=test PORT=${apiPort} MONGODB_URI=${mongoUri} JWT_SECRET=${jwtSecret} GROQ_API_KEY=${groqApiKey} VITE_API_ROOT=${apiRoot} ${queueEnv} ${e2eRedisEnv} node backend/server.js`,
      url: `${apiRoot}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    // The worker is a separate entry point; server.js does not start it. It is
    // only started for the real-queue run, so no duplicate workers are ever
    // launched by a normal test run.
    //
    // No `url` is declared on purpose. The worker has no HTTP listener, so there
    // is no endpoint that can report its readiness. Pointing `url` at the API's
    // /health/ready would collide with the API started just above: Playwright
    // probes that URL before launching, finds it already answering, and with
    // `reuseExistingServer: false` aborts the whole run with "is already used".
    // That is not hypothetical — it made the real-queue path unrunnable, and it
    // is why this run had never been executed. Playwright therefore only spawns
    // the worker here, and the lifecycle test's own polling is the readiness
    // gate: nothing but a real worker can move a job to `completed`.
    ...(realQueue
      ? [{
          command: `NODE_ENV=test MONGODB_URI=${mongoUri} JWT_SECRET=${jwtSecret} GROQ_API_KEY=${groqApiKey} ENABLE_JOB_QUEUE=true ${e2eRedisEnv} node backend/worker.js`,
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
