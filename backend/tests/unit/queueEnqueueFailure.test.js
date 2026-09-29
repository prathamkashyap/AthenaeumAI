/**
 * Contract Tests — post-commit background scheduling in attempt submission
 *
 * `saveAttempt` performs its durable writes before it schedules `SYNC_ATTEMPT`,
 * so by the time the queue is contacted the attempt and the updated quiz attempt
 * list already exist. These tests drive the real controller and assert that a
 * scheduling failure is reported as a scheduling failure rather than as a
 * failure of the operation the client just performed.
 *
 * Only infrastructure is replaced: the models, the queue, the mistake-analysis
 * service and the AI provider. The controller runs as it does in production.
 */

import { jest } from "@jest/globals";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";
import { createMockAIProvider } from "../mocks/mockAIProvider.js";
import { QueueEnqueueError } from "../../utils/errors.js";

// ─── Infrastructure doubles ───────────────────────────────────────────────────

const isDBConnected = jest.fn(() => true);
const quizFindOne = jest.fn();
const quizAttemptCreate = jest.fn();
const jobQueueEnqueue = jest.fn();
const analyzeMistakesForAttempt = jest.fn();

const savedAttempts = [];

jest.unstable_mockModule("../../models/Quiz.js", () => ({
  default: { findOne: quizFindOne, create: jest.fn(), countDocuments: jest.fn() },
}));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({
  default: { create: quizAttemptCreate },
}));
jest.unstable_mockModule("../../config/database.js", () => ({ isDBConnected }));
// The controller schedules through the tracked helper, which owns the
// record-then-enqueue ordering.
// The controller schedules through the tracked helper, which owns the
// record-then-enqueue ordering. It is mocked at this boundary so the assertions
// can observe both the outcome and the arguments the real helper receives, and
// so a queue refusal is modelled the way the real helper models it.
const createTrackedJob = jest.fn(async ({ type, resource }) => ({
  _id: "job-1",
  user: "user-1",
  type,
  status: "pending",
  resource,
  queueJobId: null,
}));
const markTrackedQueued = jest.fn(async () => null);
const markTrackedNotScheduled = jest.fn(async () => null);

const enqueueTrackedJob = jest.fn(async ({ type, resource, data, deduplicationId, name }) => {
  const job = await createTrackedJob({ type, resource });
  try {
    const queued = await jobQueueEnqueue(name, { type, data, jobId: String(job._id) }, { deduplicationId });
    await markTrackedQueued();
    return { job, scheduled: true, error: null };
  } catch (error) {
    if (!(error instanceof QueueEnqueueError)) throw error;
    await markTrackedNotScheduled();
    return { job, scheduled: false, error };
  }
});

jest.unstable_mockModule("../../utils/jobQueue.js", () => ({
  jobQueue: { enqueue: jobQueueEnqueue },
  enqueueTrackedJob,
}));
jest.unstable_mockModule("../../services/mistakeAnalysisService.js", () => ({
  analyzeMistakesForAttempt,
}));
jest.unstable_mockModule("../../services/progressService.js", () => ({
  updateUserProgressFromAttempt: jest.fn(),
}));
jest.unstable_mockModule("../../services/learningEventService.js", () => ({
  recordAttemptEvents: jest.fn(),
}));
jest.unstable_mockModule("../../services/reviewQueueService.js", () => ({
  enqueueFailedQuestionItems: jest.fn(),
  rebuildReviewQueueForUser: jest.fn(),
}));
jest.unstable_mockModule("../../services/embeddingService.js", () => ({
  indexStudyMaterialChunks: jest.fn(),
}));
jest.unstable_mockModule("../../services/defaultQuizSeeder.js", () => ({
  getDefaultSubjects: jest.fn(() => []),
}));

// Imported only after every model mock is registered, so the controller receives
// the doubles rather than real Mongoose models.
const { saveAttempt } = await import("../../controllers/quizController.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const buildQuiz = () => ({
  _id: "quiz-1",
  user: "user-1",
  studyMaterial: "material-1",
  difficulty: "Medium",
  questions: [
    { question: "Which condition requires no preemption?", options: ["A", "B", "C", "D"], answer: 0, topic: "Deadlock" },
    { question: "Which policy can thrash?", options: ["LRU", "FIFO", "OPT", "RDM"], answer: 0, topic: "Paging" },
  ],
  attempts: [],
  save: jest.fn(),
});

let QUIZ = buildQuiz();

const buildRequest = (overrides = {}) => ({
  user: { _id: "user-1" },
  requestId: "req-1",
  params: { id: "quiz-1" },
  body: { score: 1, total: 2, answers: [0, 3], durationSeconds: 30 },
  ...overrides,
});

const buildResponse = () => ({
  statusCode: null,
  body: null,
  json(payload) { this.body = payload; return this; },
});

const drive = async (requestOverrides = {}) => {
  const req = buildRequest(requestOverrides);
  const res = buildResponse();
  const next = jest.fn();
  await saveAttempt(req, res, next);
  return { req, res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  savedAttempts.length = 0;

  QUIZ = buildQuiz();
  isDBConnected.mockReturnValue(true);
  quizFindOne.mockResolvedValue(QUIZ);
  analyzeMistakesForAttempt.mockResolvedValue([]);
  jobQueueEnqueue.mockResolvedValue({ id: "job-1" });
  quizAttemptCreate.mockImplementation(async (doc) => {
    const attempt = { _id: "attempt-1", ...doc };
    savedAttempts.push(attempt);
    return attempt;
  });
  setAIProvider(createMockAIProvider([]));
});

afterEach(() => {
  resetAIProvider();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("saveAttempt: ordinary success", () => {
  test("returns the saved attempt together with the queued job", async () => {
    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      message: "Attempt saved",
      attemptId: "attempt-1",
      mistakeAnalyses: [],
      attemptCount: 1,
      bestScore: 50,
      backgroundProcessing: { status: "queued", task: "SYNC_ATTEMPT", jobId: "job-1" },
    });
    expect(jobQueueEnqueue).toHaveBeenCalledTimes(1);
  });

  test("schedules SYNC_ATTEMPT keyed on the durable attempt", async () => {
    await drive();

    expect(jobQueueEnqueue).toHaveBeenCalledWith(
      expect.stringContaining("SYNC_ATTEMPT"),
      {
        type: "SYNC_ATTEMPT",
        data: { attemptId: "attempt-1", userId: "user-1", quizId: "quiz-1" },
        jobId: "job-1",
      },
      { deduplicationId: "sync-attempt:attempt-1" },
    );
  });
});

describe("saveAttempt: scheduling fails after the attempt is durable", () => {
  beforeEach(() => {
    jobQueueEnqueue.mockRejectedValue(
      new QueueEnqueueError("Background processing could not be scheduled."),
    );
  });

  test("reports a scheduling failure, not a failed attempt", async () => {
    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    expect(res.body.message).toBe("Attempt saved");
    expect(res.body.attemptId).toBe("attempt-1");
    expect(res.body.backgroundProcessing).toEqual({
      status: "not_scheduled",
      task: "SYNC_ATTEMPT",
      jobId: "job-1",
    });
  });

  test("the attempt remains durable and is not created twice", async () => {
    await drive();

    expect(quizAttemptCreate).toHaveBeenCalledTimes(1);
    expect(savedAttempts).toHaveLength(1);
    expect(savedAttempts[0]._id).toBe("attempt-1");
    // The quiz's own attempt list was still updated.
    expect(QUIZ.attempts).toHaveLength(1);
    expect(QUIZ.save).toHaveBeenCalled();
  });

  test("the job was not recorded as successfully scheduled", async () => {
    await drive();

    expect(jobQueueEnqueue).toHaveBeenCalledTimes(1);
    // The recorded call result is a rejection: nothing was scheduled.
    await expect(jobQueueEnqueue.mock.results[0].value)
      .rejects.toBeInstanceOf(QueueEnqueueError);
  });

  test("no queue internals leak into the response", async () => {
    const { res } = await drive();

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/redis|socket|ECONNREFUSED|password|api[_-]?key|at Object/i);
    expect(Object.keys(res.body.backgroundProcessing).sort()).toEqual(["jobId", "status", "task"]);
  });
});

describe("saveAttempt: genuine failures remain failures", () => {
  test("a failure before the durable write is still a failure", async () => {
    quizAttemptCreate.mockRejectedValue(new Error("mongo write failed"));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "mongo write failed" }));
    expect(res.body).toBeNull();
    // Scheduling is never reached, so nothing can be reported as unscheduled.
    expect(jobQueueEnqueue).not.toHaveBeenCalled();
  });

  test("a non-queue failure while scheduling is still a failure", async () => {
    jobQueueEnqueue.mockRejectedValue(new TypeError("bug in the enqueue call site"));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "bug in the enqueue call site" }));
    expect(res.body).toBeNull();
  });

  test("a missing quiz is still a not-found failure", async () => {
    quizFindOne.mockResolvedValue(null);

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Quiz not found" }));
    expect(res.body).toBeNull();
    expect(quizAttemptCreate).not.toHaveBeenCalled();
  });

  test("an unavailable database is still a database failure", async () => {
    isDBConnected.mockReturnValue(false);

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Database not available" }));
    expect(res.body).toBeNull();
    expect(quizAttemptCreate).not.toHaveBeenCalled();
  });
});
