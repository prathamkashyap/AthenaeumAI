import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Shared helpers for the HTTP-level E2E suites.
 *
 * These exist so the specs read as behaviour rather than as HTTP plumbing. Every
 * call goes through the real API against the real database; nothing here mocks a
 * queue, a worker or an authentication path.
 */

export type Json = Record<string, unknown>;

/**
 * Absolute API root.
 *
 * Requests go straight to the backend rather than through the Vite dev server:
 * there is no dev proxy, so a relative path would hit the frontend host and 404.
 */
export const API_BASE = process.env.VITE_API_ROOT || 'http://127.0.0.1:3001/api/v1';

export const api = (p: string) => `${API_BASE}${p}`;

/**
 * Probes what the Mongo deployment can actually do.
 *
 * A connected standalone `mongod` is not enough: multi-document transactions
 * require a replica set or a mongos, and the readiness probe cannot tell the
 * difference. `setName` is present exactly when the deployment is a replica set
 * or a mongos, so it is the signal the suite uses to decide whether the
 * transactional quiz-generation path can run at all.
 */
export const probeMongoDeployment = async () => {
  const { createRequire } = await import('module');
  const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
  const { MongoClient } = backendRequire('mongodb');
  const uri =
    process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/athenaeumAI_e2e';

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 });
    const setName = (hello as { setName?: string }).setName ?? null;
    return { reachable: true, setName, transactions: Boolean(setName) };
  } catch (error) {
    return { reachable: false, setName: null, transactions: false, error: (error as Error).message };
  } finally {
    await client.close().catch(() => undefined);
  }
};

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@e2e.test`;

export const signup = async (request: APIRequestContext, prefix: string) => {
  const email = uniqueEmail(prefix);
  const password = 'E2eStrongPassword123!';

  const response = await request.post(api('/auth/signup'), {
    data: { name: `E2E ${prefix}`, email, password },
  });

  expect(response.status(), `signup for ${email} should succeed`).toBe(201);

  const body = await response.json();
  return { email, password, token: body.token as string, userId: body.user.id as string };
};

export const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Polls a job until it reaches a terminal state, or fails with the last state
 * actually observed.
 *
 * Bounded by a deadline rather than a fixed sleep, and the diagnostic names the
 * stage that stalled so a failure distinguishes an API, auth, persistence,
 * queue, worker or status-endpoint problem from one another.
 */
export const pollJobUntilTerminal = async (
  request: APIRequestContext,
  token: string,
  jobId: string,
  { timeoutMs = 30_000, intervalMs = 250 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  const seen: string[] = [];
  let last: Json | null = null;
  let lastError = '';

  while (Date.now() < deadline) {
    const response = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(token) });
    if (response.ok()) {
      last = (await response.json()) as Json;
      const status = String(last.status);
      if (!seen.includes(status)) seen.push(status);
      if (status === 'completed' || status === 'failed' || status === 'not_scheduled') {
        return { job: last, observed: seen };
      }
    } else {
      lastError = `${response.status()} ${await response.text().catch(() => '')}`;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Job ${jobId} did not reach a terminal state within ${timeoutMs}ms.\n` +
    `  observed states: ${seen.join(' -> ') || '(none)'}\n` +
    `  last status body: ${JSON.stringify(last)}\n` +
    `  last status error: ${lastError || '(none)'}`,
  );
};

/** Polls a job until it leaves its initial state, bounded by a deadline. */
export const pollJobUntilNotPending = async (
  request: APIRequestContext,
  token: string,
  jobId: string,
  { timeoutMs = 30_000, intervalMs = 250 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  const seen: string[] = [];

  while (Date.now() < deadline) {
    const response = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(token) });
    if (response.ok()) {
      const body = (await response.json()) as Json;
      const status = String(body.status);
      if (!seen.includes(status)) seen.push(status);
      if (status !== 'pending') return { job: body, observed: seen };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Job ${jobId} stayed pending; observed: ${seen.join(' -> ')}`);
};
