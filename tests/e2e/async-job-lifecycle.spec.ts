import { APIRequestContext, expect, test } from '@playwright/test';
import {
  api,
  authHeaders,
  pollJobUntilNotPending,
  pollJobUntilTerminal,
  probeMongoDeployment,
  signup,
} from './helpers/api';

/** The question document `seedQuiz` writes into the `quizzes` collection. */
type SeededQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  topic: string;
  cognitiveLevel: string;
};

/** What `seedQuiz` hands back, and what the attempt helpers accept. */
type SeededQuiz = { id: string; questions: SeededQuestion[] };

/**
 * E2E — the asynchronous job contract, over real HTTP and a real database.
 *
 * The API under test is the real Express application with the real controllers,
 * services and MongoDB persistence. Nothing here mocks the queue, the worker or
 * authentication, and no browser is required: these specs use Playwright's
 * APIRequestContext, so the whole suite runs without Chromium.
 *
 * ── A capability this suite measures rather than assumes ──────────────────────
 *
 * `POST /api/v1/quiz/generate` persists the material and the quiz inside a
 * MongoDB transaction, so it requires a replica set. On a standalone `mongod` that
 * endpoint cannot work at all, and the specs that depend on it are skipped with
 * that reason rather than failing obscurely or passing vacuously. The attempt and
 * job-status path does not use a transaction, so it is exercised in full against a
 * quiz seeded directly into the test database.
 *
 * The real BullMQ lifecycle is gated on E2E_REAL_QUEUE, because a worker needs a
 * live Redis. That gate is also a skip, never a silent pass.
 */

const realQueue = process.env.E2E_REAL_QUEUE === 'true';
const describeRealQueue = realQueue ? test.describe : test.describe.skip;

/** Whether this deployment can run the transactional quiz-generation path. */
let transactionsAvailable = false;

test.beforeAll(async () => {
  // Probed from the deployment itself: a reachable standalone cannot complete a
  // transaction, and the API's readiness probe cannot distinguish the two.
  const deployment = await probeMongoDeployment();
  transactionsAvailable = deployment.transactions;
});

/**
 * Creates a quiz for the authenticated user directly in the test database.
 *
 * This exists only because the quiz-generation endpoint needs a replica set and
 * cannot be used on a standalone deployment. It seeds the *prerequisite* record
 * only: the behaviour under test is attempt submission, job tracking and status
 * reporting, all of which go through the real HTTP API.
 */
const seedQuiz = async (userId: string, count = 3): Promise<SeededQuiz> => {
  // The driver is a backend dependency, so it is resolved from the backend install
  // rather than adding a root dependency for test convenience.
  const { createRequire } = await import('module');
  const backendRequire = createRequire(
    new URL('../../backend/package.json', import.meta.url),
  );
  const { MongoClient, ObjectId } = backendRequire('mongodb');

  const uri =
    process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/athenaeumAI_e2e';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(new URL(uri).pathname.replace(/^\//, '') || 'athenaeumAI_e2e');

  const questions = Array.from({ length: count }, (_, index) => ({
    question: `Which scheduling policy behaves badly under a long burst of CPU work? (${index + 1})`,
    options: ['Round Robin', 'Priority Scheduling', 'First Come First Served', 'Shortest Job First'],
    answer: 2,
    explanation:
      'First come first served is non-preemptive, so a long burst delays every short process behind it.',
    topic: 'Scheduling',
    cognitiveLevel: 'Apply',
  }));

  const { insertedId } = await db.collection('quizzes').insertOne({
    user: new ObjectId(userId),
    title: 'E2E Seeded Quiz',
    difficulty: 'Medium',
    questionCount: count,
    questions,
    attempts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await client.close();
  return { id: insertedId.toString(), questions };
};

/**
 * Reads a persisted document straight from the test database.
 *
 * Used by the real-queue test to check that the completed job points at a real
 * record rather than at an id the application merely claimed to have used.
 */
const readPersisted = async (collection: string, id: string) => {
  const { createRequire } = await import('module');
  const backendRequire = createRequire(
    new URL('../../backend/package.json', import.meta.url),
  );
  const { MongoClient, ObjectId } = backendRequire('mongodb');

  const uri =
    process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/athenaeumAI_e2e';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(new URL(uri).pathname.replace(/^\//, '') || 'athenaeumAI_e2e');

  const document = await db
    .collection(collection)
    .findOne({ _id: new ObjectId(id) });

  await client.close();
  return document;
};

/** Submits an attempt over real HTTP and returns the tracked job id. */
const submitAttempt = async (
  request: APIRequestContext,
  token: string,
  quiz: SeededQuiz,
  { withBody = false } = {},
) => {
  const response = await request.post(api(`/quiz/${quiz.id}/attempt`), {
    headers: authHeaders(token),
    data: {
      score: 1,
      total: quiz.questions.length,
      answers: quiz.questions.map((q, index) =>
        index % 2 === 0 ? q.answer : (q.answer + 1) % 4,
      ),
      durationSeconds: 30,
    },
  });

  const text = await response.text().catch(() => '');
  expect(response.status(), `attempt submission should succeed; body was ${text}`).toBe(200);

  const body = JSON.parse(text);
  const jobId = body.backgroundProcessing?.jobId;
  expect(jobId, 'attempt submission should return a tracked job id').toBeTruthy();

  return withBody ? { jobId, body } : { jobId };
};

test('the backend under test is reachable and reports a healthy Mongo', async ({ request }) => {
  const response = await request.get(api('/health/ready'));

  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe('ready');
});

test('the deployment capability this suite depends on is recorded', async ({ request }) => {
  const deployment = await probeMongoDeployment();
  const health = await (await request.get(api('/health'))).json();

  // Stated explicitly rather than inferred: on a standalone deployment the
  // quiz-generation endpoint cannot work at all, and that is a deployment
  // property worth surfacing rather than hiding behind a skipped test.
  expect(deployment.reachable).toBe(true);
  expect(typeof deployment.transactions).toBe('boolean');
  expect(['connected', 'disconnected']).toContain(health.services.mongoDB);
  expect(['ok', 'degraded']).toContain(health.status);
});

test('readiness reports transaction capability truthfully, without Redis', async ({ request }) => {
  const deployment = await probeMongoDeployment();
  const health = await (await request.get(api('/health'))).json();
  const ready = await request.get(api('/health/ready'));

  // Connected and transaction-capable are separate claims. Task 15 separated
  // them, so the deployment can no longer read as fully healthy while quiz
  // generation and attempt sync are impossible to execute.
  expect(health.database.transactions).toBe(
    deployment.transactions ? 'supported' : 'unsupported',
  );

  if (!deployment.transactions) {
    expect(health.status).toBe('degraded');
  }

  // Readiness means "can serve traffic", which a connected database satisfies.
  // The capability is disclosed so "ready" is never read as "can run every
  // transaction-backed operation", and Redis is not required for either answer.
  expect(ready.status()).toBe(200);
  const readyBody = await ready.json();
  expect(readyBody.status).toBe('ready');
  expect(readyBody.database.transactions).toBe(health.database.transactions);
});

test.describe('A. Quiz generation returns a trackable job', () => {
  test('a generated quiz carries a job id and durable identifiers', async ({ request }) => {
    test.skip(
      !transactionsAvailable,
      'quiz generation persists inside a transaction and needs a MongoDB replica set; this deployment is standalone',
    );

    const owner = await signup(request, 'jobs-owner');
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const pdf = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../backend/tests/fixtures/demo-material.pdf',
      ),
    );

    const response = await request.post(api('/quiz/generate'), {
      headers: authHeaders(owner.token),
      multipart: {
        file: { name: 'demo-material.pdf', mimeType: 'application/pdf', buffer: pdf },
        difficulty: 'Medium',
        count: '3',
      },
    });

    expect(response.status(), await response.text().catch(() => '')).toBe(200);
    const body = await response.json();

    // The business record is the primary result and must be complete and real.
    expect(body.quizId).toBeTruthy();
    expect(body.materialId).toBeTruthy();
    expect(body.quiz.length).toBeGreaterThan(0);
    expect(body.questionCount).toBe(body.quiz.length);

    // The background work is reported as tracked, with an id the client can poll.
    expect(body.backgroundProcessing.task).toBe('INDEX_MATERIAL');
    expect(body.backgroundProcessing.jobId).toBeTruthy();

    const job = await (
      await request.get(api(`/jobs/${body.backgroundProcessing.jobId}`), { headers: authHeaders(owner.token) })
    ).json();

    expect(job.type).toBe('INDEX_MATERIAL');
    // The job points at records that were really persisted, not placeholders.
    expect(job.resource.materialId).toBe(body.materialId);
    expect(job.resource.quizId).toBe(body.quizId);
    expect(job.status).not.toBe('completed');
  });
});

test.describe('B. Status endpoint ownership', () => {
  test('another learner cannot read a job by id', async ({ request }) => {
    const owner = await signup(request, 'jobs-tenant-owner');
    const other = await signup(request, 'jobs-tenant-other');
    const quiz = await seedQuiz(owner.userId);
    const { jobId } = await submitAttempt(request, owner.token, quiz);

    const foreign = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(other.token) });

    // Not found, so the endpoint cannot be used to probe for others' jobs.
    expect(foreign.status()).toBe(404);

    // The owner is still able to read it: isolation hid it, it did not break it.
    const own = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(owner.token) });
    expect(own.status()).toBe(200);
  });

  test('an unauthenticated read is rejected', async ({ request }) => {
    const owner = await signup(request, 'jobs-unauth');
    const quiz = await seedQuiz(owner.userId);
    const { jobId } = await submitAttempt(request, owner.token, quiz);

    const response = await request.get(api(`/jobs/${jobId}`));

    expect(response.status()).toBe(401);
  });

  test('an unknown job id is a not found', async ({ request }) => {
    const owner = await signup(request, 'jobs-unknown');

    const response = await request.get(api('/jobs/000000000000000000000000'), {
      headers: authHeaders(owner.token),
    });

    expect(response.status()).toBe(404);
  });
});

test.describe('C. Public contract safety', () => {
  test('the status response exposes no queue or infrastructure internals', async ({ request }) => {
    const owner = await signup(request, 'jobs-safety');
    const quiz = await seedQuiz(owner.userId);
    const { jobId } = await submitAttempt(request, owner.token, quiz);

    const response = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(owner.token) });
    const text = await response.text();

    expect(response.status()).toBe(200);
    expect(text).not.toMatch(
      /queueJobId|bullmq|athenaeum-background-jobs|redis|\/\/.*:\d+|ECONNREFUSED|stack|at Object/i,
    );
    // The projection is exactly the documented shape and nothing else.
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'completedAt',
      'createdAt',
      'error',
      'jobId',
      'resource',
      'startedAt',
      'status',
      'type',
    ]);
  });

  test('the attempt response leaks no queue internals', async ({ request }) => {
    const owner = await signup(request, 'jobs-safe-attempt');
    const quiz = await seedQuiz(owner.userId);

    const response = await request.post(api(`/quiz/${quiz.id}/attempt`), {
      headers: authHeaders(owner.token),
      data: {
        score: 1,
        total: quiz.questions.length,
        answers: quiz.questions.map((q) => q.answer),
        durationSeconds: 15,
      },
    });
    const text = await response.text();

    expect(response.status()).toBe(200);
    expect(text).not.toMatch(/redis|ECONNREFUSED|queueJobId|at Object/i);
  });
});

test.describe('D. Attempt submission returns a tracked SYNC_ATTEMPT job', () => {
  test('submitting an attempt persists the attempt and tracks its sync job', async ({ request }) => {
    const owner = await signup(request, 'attempt-job');
    const quiz = await seedQuiz(owner.userId);

    const { body } = await submitAttempt(request, owner.token, quiz, { withBody: true });

    // The attempt itself is the primary result and must be durable.
    expect(body.message).toBe('Attempt saved');
    expect(body.attemptId).toBeTruthy();
    expect(body.attemptCount).toBe(1);

    // Its background work is tracked, exactly as material indexing is.
    expect(body.backgroundProcessing.task).toBe('SYNC_ATTEMPT');
    expect(body.backgroundProcessing.jobId).toBeTruthy();

    const job = await (
      await request.get(api(`/jobs/${body.backgroundProcessing.jobId}`), {
        headers: authHeaders(owner.token),
      })
    ).json();

    expect(job.type).toBe('SYNC_ATTEMPT');
    // The job points at the attempt that was really persisted.
    expect(job.resource.attemptId).toBe(body.attemptId);
    expect(job.resource.quizId).toBe(quiz.id);
  });

  test('the job does not claim completion before any worker has run', async ({ request }) => {
    const owner = await signup(request, 'jobs-not-complete');
    const quiz = await seedQuiz(owner.userId);
    const { jobId } = await submitAttempt(request, owner.token, quiz);

    const job = await (
      await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(owner.token) })
    ).json();

    // The API must not report background work as finished merely because the
    // business write succeeded. Without a worker the job stays non-terminal.
    expect(job.status).not.toBe('completed');
  });

  test('the job leaves its initial state rather than hanging on pending forever', async ({ request }) => {
    const owner = await signup(request, 'jobs-queued');
    const quiz = await seedQuiz(owner.userId);
    const { jobId } = await submitAttempt(request, owner.token, quiz);

    const { job, observed } = await pollJobUntilNotPending(request, owner.token, jobId);

    expect(observed.length).toBeGreaterThan(0);
    // Either accepted by the queue, or truthfully refused. Both are valid; what is
    // not valid is a job that never leaves `pending`.
    expect(['queued', 'running', 'completed', 'not_scheduled']).toContain(job.status);
  });

  test('two attempts produce two distinct tracked jobs', async ({ request }) => {
    const owner = await signup(request, 'attempt-two-jobs');
    const quiz = await seedQuiz(owner.userId);

    const first = await submitAttempt(request, owner.token, quiz, { withBody: true });
    const second = await submitAttempt(request, owner.token, quiz, { withBody: true });

    // The job boundary is per submission, so a second attempt is tracked
    // separately rather than being suppressed as a duplicate.
    expect(first.body.attemptId).not.toBe(second.body.attemptId);
    expect(first.jobId).not.toBe(second.jobId);
  });
});

describeRealQueue('E. Real BullMQ lifecycle', () => {
  test('a job runs on a real worker and reaches completed', async ({ request }) => {
    const owner = await signup(request, 'real-queue');
    const quiz = await seedQuiz(owner.userId);
    const { jobId, body } = await submitAttempt(request, owner.token, quiz, { withBody: true });

    const initial = await request.get(api(`/jobs/${jobId}`), { headers: authHeaders(owner.token) });
    // Accepted by a live queue, so the job must legitimately be non-failed first.
    expect(['queued', 'running', 'completed']).toContain((await initial.json()).status);

    // The poll budget has to sit inside the test timeout, or the polling
    // helper's diagnostic — which names the states it actually observed and is
    // the only thing that distinguishes "no worker ran" from "the worker is
    // stuck on an earlier job" — is never printed, because Playwright kills the
    // test first and reports a bare timeout instead.
    const { job, observed } = await pollJobUntilTerminal(request, owner.token, jobId, { timeoutMs: 20_000 });

    expect(observed.length).toBeGreaterThan(0);
    // The worker declares no readiness URL, so this suite cannot assert that a
    // worker process came up. It does not need to: nothing but a real worker can
    // move a job to `completed`, and if no worker runs this test fails on the
    // polling deadline, whose error names the states actually observed.
    expect(job.status).toBe('completed');
    expect(job.completedAt).toBeTruthy();
    expect(job.error).toBeNull();
    // The worker recorded that it really ran, rather than the job ageing out.
    expect(job.startedAt).toBeTruthy();

    // The completed job must describe the work that actually happened, not an id
    // the application echoed back. The attempt the client submitted is the
    // attempt the job names, and the quiz it was answered against is the quiz
    // that was seeded.
    expect(job.resource.attemptId).toBe(body.attemptId);
    expect(job.resource.quizId).toBe(quiz.id);
    expect(job.resource.materialId).toBeNull();

    // And the record the job points at is really there, owned by this learner.
    const attempt = await readPersisted('quizattempts', job.resource.attemptId);
    expect(attempt, 'the completed job points at a real persisted attempt').not.toBeNull();
    expect(attempt!.user.toString()).toBe(owner.userId);
    expect(attempt!.quiz.toString()).toBe(quiz.id);

    // The strongest evidence that a real worker did real work: the durable
    // SYNC_ATTEMPT claim from Task 7B was committed by the real transaction,
    // inside a real replica set. Nothing short of a running worker can set this.
    expect(attempt!.sync?.status).toBe('processed');
    expect(attempt!.sync?.appliedAt).toBeTruthy();
  });
});
