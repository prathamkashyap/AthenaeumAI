import { test, expect } from '@playwright/test';

const API_BASE = process.env.VITE_API_ROOT || 'http://127.0.0.1:3001/api/v1';

const uniqueEmail = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
const testPassword = 'testpassword123';

// ─── API-level tests (no browser needed) ───────────────────────

test.describe('Health Endpoints', () => {
  test('GET /health returns service status', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body.version).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.database.label).toBe('connected');
  });

  test('GET /health/ready returns ready', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health/ready`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });
});

test.describe('Auth API', () => {
  test('POST /auth/signup creates a new user', async ({ request }) => {
    const testUser = {
      name: 'E2E Test User',
      email: uniqueEmail('e2e_signup'),
      password: testPassword,
      program: 'CS',
      semester: '6',
    };
    const res = await request.post(`${API_BASE}/auth/signup`, { data: testUser });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(testUser.email);
  });

  test('POST /auth/signup rejects duplicate email', async ({ request }) => {
    const testUser = {
      name: 'E2E Duplicate User',
      email: uniqueEmail('e2e_duplicate'),
      password: testPassword,
      program: 'CS',
      semester: '6',
    };
    // First signup
    await request.post(`${API_BASE}/auth/signup`, { data: testUser });
    // Duplicate
    const res = await request.post(`${API_BASE}/auth/signup`, { data: testUser });
    expect(res.status()).toBe(409);
  });

  test('POST /auth/login succeeds with valid credentials', async ({ request }) => {
    const email = uniqueEmail('login_ok');
    await request.post(`${API_BASE}/auth/signup`, {
      data: { name: 'Login OK User', email, password: testPassword, program: 'CS', semester: '6' },
    });
    const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password: testPassword } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
  });

  test('POST /auth/login rejects wrong password', async ({ request }) => {
    const res = await request.post(`${API_BASE}/auth/login`, {
      data: { email: 'nonexist@test.com', password: 'wrongpassword' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Protected Routes without Auth', () => {
  test('GET /quiz/history returns 401 without token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/quiz/history`);
    expect(res.status()).toBe(401);
  });

  test('GET /library returns 401 without token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/library`);
    expect(res.status()).toBe(401);
  });

  test('GET /analytics/dashboard returns 401 without token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/analytics/dashboard`);
    expect(res.status()).toBe(401);
  });
});

// ─── Authenticated API tests ───────────────────────────────────

test.describe('Authenticated Flows', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    const email = uniqueEmail('auth_flow');
    const res = await request.post(`${API_BASE}/auth/signup`, {
      data: { name: 'Auth Flow User', email, password: testPassword, program: 'CS', semester: '6' },
    });
    const body = await res.json();
    token = body.token;
  });

  test('GET /quiz/history returns empty array for new user', async ({ request }) => {
    const res = await request.get(`${API_BASE}/quiz/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.quizzes).toBeDefined();
    expect(Array.isArray(body.quizzes)).toBe(true);
  });

  test('GET /library returns empty for new user', async ({ request }) => {
    const res = await request.get(`${API_BASE}/library`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.materials).toBeDefined();
  });
});

// ─── Browser UI flows & Mocking ────────────────────────────────

test.describe('UI Workflows & Mocking', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/tutor/ask', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Socratic Tutor: Consider how physical resources are allocated under deadlock conditions.'
        })
      });
    });
  });

  test('Auth page loads and displays forms correctly', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('text=Welcome back')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('Signup creates a session and loads the dashboard', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('tab', { name: 'Signup' }).click();
    await page.fill('#name', 'E2E Learner');
    await page.fill('#email', uniqueEmail('ui_signup'));
    await page.fill('#password', testPassword);
    await page.fill('#program', 'CS');
    await page.fill('#semester', '6');
    await page.click('button:has-text("Create Workspace")');

    // Should navigate away from auth
    await page.waitForURL((url) => !url.pathname.includes('/auth'), { timeout: 10000 });

    await expect(page.locator('text=Welcome back,').first()).toBeVisible();
    await expect(page.locator('text=E2E').first()).toBeVisible();
  });

  test('Socratic Tutor chat flow with authenticated user', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('tab', { name: 'Signup' }).click();
    await page.fill('#name', 'Tutor Flow');
    await page.fill('#email', uniqueEmail('ui_tutor'));
    await page.fill('#password', testPassword);
    await page.click('button:has-text("Create Workspace")');
    await page.waitForURL((url) => !url.pathname.includes('/auth'));

    await page.goto('/tutor');

    await page.fill('textarea[placeholder*="Ask"]', 'What are deadlocks?');
    await page.click('button:has-text("Ask Tutor")');

    await expect(page.locator('text=Socratic Tutor: Consider how physical resources')).toBeVisible();
  });
});
