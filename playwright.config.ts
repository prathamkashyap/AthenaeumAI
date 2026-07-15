import { defineConfig, devices } from '@playwright/test';

const appPort = process.env.E2E_APP_PORT || '8080';
const apiPort = process.env.PORT || process.env.E2E_API_PORT || '3001';
const apiRoot = process.env.VITE_API_ROOT || `http://127.0.0.1:${apiPort}/api/v1`;
const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGODB_URI_TEST ||
  'mongodb://127.0.0.1:27018/athenaeumAI_e2e';
const jwtSecret = process.env.JWT_SECRET || 'playwright-local-test-secret';
const groqApiKey = process.env.GROQ_API_KEY || 'playwright-local-test-key';

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
      command: `NODE_ENV=test PORT=${apiPort} MONGODB_URI=${mongoUri} JWT_SECRET=${jwtSecret} GROQ_API_KEY=${groqApiKey} VITE_API_ROOT=${apiRoot} node backend/server.js`,
      url: `${apiRoot}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
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
