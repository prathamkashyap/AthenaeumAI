/**
 * Contract Tests — the live quiz-generation controller
 *
 * The point of this suite is the wiring, not the pipeline. Task 9 exists because
 * the learner-facing endpoint used to call the AI service directly, skipping the
 * quality rules that only the seeder's path applied. These tests drive the real
 * `generateQuizController` end to end and assert on what is actually persisted,
 * so reverting the controller to raw `generateQuizFromAI` output fails them.
 *
 * Only infrastructure is replaced — the models, the PDF reader, the queue, the
 * transaction helper and the model itself through the Task 8 provider seam. The
 * controller, `quizService.generateQuiz`, `aiQuizService` and the quality filter
 * all run as they do in production.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createFailingAIProvider,
} from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";
import { QueueEnqueueError } from "../../utils/errors.js";
import { calculateQualityScore } from "../../utils/qualityFilter.js";

// ─── Infrastructure doubles ───────────────────────────────────────────────────

const quizCreate = jest.fn();
const studyMaterialCreate = jest.fn();
const jobQueueEnqueue = jest.fn();
const extractTextFromPDF = jest.fn();
const unlinkSync = jest.fn();
const isDBConnected = jest.fn(() => true);

const savedMaterials = [];
const savedQuizzes = [];

const runInTransaction = jest.fn(async (callback) => callback({ id: "session-1" }));

jest.unstable_mockModule("../../models/Quiz.js", () => ({
  default: { create: quizCreate },
}));
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: { create: studyMaterialCreate },
}));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({ default: {} }));
jest.unstable_mockModule("../../utils/pdfParser.js", () => ({ extractTextFromPDF }));
// The controller now schedules through the tracked helper, which owns the
// record-then-enqueue ordering. It is mocked at this boundary so the assertions
// can observe both the outcome and the arguments the real helper receives.
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
jest.unstable_mockModule("../../utils/dbTransactions.js", () => ({ runInTransaction }));
jest.unstable_mockModule("../../config/database.js", () => ({ isDBConnected }));
jest.unstable_mockModule("../../services/embeddingService.js", () => ({
  indexStudyMaterialChunks: jest.fn(async () => []),
}));
jest.unstable_mockModule("../../services/defaultQuizSeeder.js", () => ({
  getDefaultSubjects: jest.fn(() => []),
}));
jest.unstable_mockModule("fs", () => ({ default: { unlinkSync }, unlinkSync }));

const { generateQuizController } = await import("../../controllers/quizController.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MATERIAL = (
  "Deadlock is a state in which two processes are each waiting for an event that " +
  "can only occur after the other process proceeds. Deadlock requires mutual " +
  "exclusion, hold and wait, no preemption, and a circular wait. "
).repeat(8);

/** A question the quality filter accepts. */
const acceptedQuestion = () => ({
  question: "Which deadlock condition requires that no resource be preempted from a running process?",
  options: [
    "No preemption, because resources are released only voluntarily",
    "Mutual exclusion, because resources cannot be shared",
    "Hold and wait, because a process may hold while requesting",
    "Circular wait, because a cycle forms between processes",
  ],
  answer: 0,
  explanation: "No preemption means the system cannot take a resource back to break a cycle.",
  topic: "Deadlock",
  cognitiveLevel: "Analyze",
});

/**
 * A question the AI service's own structural validation accepts but the quality
 * filter rejects: four identical options score 4.0, below the 5.0 threshold.
 */
const rejectedByQualityFilter = () => ({
  question: "Which of the following statements about deadlock prevention is correct?",
  options: ["Identical option", "Identical option", "Identical option", "Identical option"],
  answer: 0,
  explanation: "Prevention requires that one of the four deadlock conditions be denied.",
  topic: "Deadlock",
  cognitiveLevel: "Apply",
});

const buildRequest = (overrides = {}) => ({
  user: { _id: "user-1" },
  requestId: "req-1",
  file: {
    path: "/tmp/upload.pdf",
    originalname: "operating-systems-notes.pdf",
    mimetype: "application/pdf",
    size: 2048,
  },
  body: { difficulty: "Medium", count: "3" },
  ...overrides,
});

const buildResponse = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    flushHeaders() {},
    json(payload) { this.body = payload; return this; },
  };
  return res;
};

const drive = async (requestOverrides = {}) => {
  const req = buildRequest(requestOverrides);
  const res = buildResponse();
  const next = jest.fn();
  await generateQuizController(req, res, next);
  return { req, res, next };
};

/** The questions actually handed to the database. */
const persistedQuestions = () => quizCreate.mock.calls[0][0][0].questions;

beforeEach(() => {
  jest.clearAllMocks();
  savedMaterials.length = 0;
  savedQuizzes.length = 0;

  extractTextFromPDF.mockResolvedValue(MATERIAL);
  studyMaterialCreate.mockImplementation(async ([doc]) => {
    const material = { _id: "material-1", ...doc, linkedQuizzes: [], save: jest.fn() };
    savedMaterials.push(material);
    return [material];
  });
  quizCreate.mockImplementation(async ([doc]) => {
    const quiz = { _id: "quiz-1", ...doc };
    savedQuizzes.push(quiz);
    return [quiz];
  });
  jobQueueEnqueue.mockResolvedValue(undefined);
});

afterEach(() => {
  resetAIProvider();
});

// ─── The wiring itself ────────────────────────────────────────────────────────

describe("the live generation path", () => {
  test("persists only the questions the quality pipeline accepted", async () => {
    setAIProvider(createMockAIProvider([
      acceptedQuestion(),
      rejectedByQualityFilter(),
      acceptedQuestion(), // exact duplicate
    ]));

    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    const persisted = persistedQuestions();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].question).toContain("no resource be preempted");
  });

  test("the quality fixture really is rejected, so the assertion above is meaningful", async () => {
    // If the filter ever stopped rejecting this shape, the test above would pass
    // for the wrong reason.
    expect(calculateQualityScore(acceptedQuestion())).toBeGreaterThanOrEqual(5);
    expect(calculateQualityScore(rejectedByQualityFilter())).toBeLessThan(5);
  });

  test("a question the AI service would have accepted raw is still filtered out", async () => {
    // The AI service only validates structure, so without the quality stage this
    // question would reach the database. That is precisely the defect Task 9
    // removes. With the stage in place it is filtered, leaving nothing for the
    // pipeline to return.
    const raw = rejectedByQualityFilter();
    expect(Array.isArray(raw.options)).toBe(true);
    expect(raw.options).toHaveLength(4);
    expect(typeof raw.answer).toBe("number");
    expect(calculateQualityScore(raw)).toBeLessThan(5);

    setAIProvider(createMockAIProvider([raw]));

    const { res, next } = await drive();

    // Filtering everything out leaves the pipeline with no questions, which is a
    // failed request. What this test pins is that the low-quality question never
    // reaches the database -- previously that was only asserted indirectly,
    // because a fallback quiz was persisted alongside it.
    expect(res.body).toBeNull();
    expect(next).toHaveBeenCalled();
    // Nothing is written at all, so the low-quality question cannot have reached
    // the database. Previously a fallback quiz was persisted in its place.
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("returns the documented response shape", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    const { res } = await drive();

    expect(res.body).toEqual({
      quizId: "quiz-1",
      materialId: "material-1",
      title: "Operating Systems Notes",
      difficulty: "Medium",
      questionCount: 1,
      quiz: expect.arrayContaining([expect.objectContaining({ answer: 0 })]),
      backgroundProcessing: {
        status: "queued",
        task: "INDEX_MATERIAL",
        jobId: "job-1",
      },
    });
  });

  test("records the question count that was actually persisted", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    const { res } = await drive();

    expect(quizCreate.mock.calls[0][0][0].questionCount).toBe(1);
    expect(res.body.questionCount).toBe(1);
  });

  test("scopes the quiz and the material to the requesting user", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    await drive();

    expect(quizCreate.mock.calls[0][0][0].user).toBe("user-1");
    expect(studyMaterialCreate.mock.calls[0][0][0].user).toBe("user-1");
    expect(savedMaterials[0].user).toBe("user-1");
  });

  test("normalizes topics before persisting", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    await drive();

    expect(persistedQuestions()[0].topic).toBe("Deadlock");
  });

  test("persists fewer questions than requested rather than padding", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    const { res } = await drive({ body: { difficulty: "Medium", count: "10" } });

    expect(res.body.questionCount).toBe(1);
    expect(quizCreate.mock.calls[0][0][0].questionCount).toBe(1);
  });

  test("links the quiz back to its material and queues indexing once", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    await drive();

    expect(savedMaterials[0].linkedQuizzes).toEqual(["quiz-1"]);
    expect(jobQueueEnqueue).toHaveBeenCalledTimes(1);
    // The payload carries the application job id alongside the unchanged data.
    expect(jobQueueEnqueue.mock.calls[0][1]).toEqual({
      type: "INDEX_MATERIAL",
      data: { materialId: "material-1" },
      jobId: "job-1",
    });
    expect(jobQueueEnqueue.mock.calls[0][2]).toEqual({ deduplicationId: "index-material:material-1" });
  });

  test("the success payload reports the queued job so it can be tracked", async () => {
    // Since the async job boundary, the happy path names the job rather than
    // staying silent: the client needs the id to ask how indexing is going.
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    const { res } = await drive();

    expect(res.body.backgroundProcessing).toEqual({
      status: "queued",
      task: "INDEX_MATERIAL",
      jobId: "job-1",
    });
  });

  test("a failed INDEX_MATERIAL enqueue does not fail a committed quiz", async () => {
    // The material and quiz are already durable at this point, so a queue failure
    // must not be reported as a failure of the request the client just made.
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new QueueEnqueueError("Background processing could not be scheduled."));

    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    expect(res.body.backgroundProcessing).toEqual({
      status: "not_scheduled",
      task: "INDEX_MATERIAL",
      jobId: "job-1",
    });
    // Everything the client relies on is still there.
    expect(res.body.quizId).toBe("quiz-1");
    expect(res.body.quiz).toHaveLength(1);
  });

  test("a committed quiz survives a failed enqueue, with no compensating deletion", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new QueueEnqueueError("Background processing could not be scheduled."));

    await drive();

    // Persisted, not rolled back, and not deleted afterwards.
    expect(quizCreate).toHaveBeenCalledTimes(1);
    expect(savedQuizzes).toHaveLength(1);
    expect(savedQuizzes[0].questions).toHaveLength(1);
    expect(studyMaterialCreate).toHaveBeenCalledTimes(1);
    expect(quizCreate).not.toHaveBeenCalledTimes(0);
    // The transaction is not re-run to compensate.
    expect(runInTransaction).toHaveBeenCalledTimes(1);
  });

  test("the material link is saved even when indexing could not be scheduled", async () => {
    // Previously the link update sat after the enqueue, so a queue failure skipped
    // it and left the material without its quiz.
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new QueueEnqueueError("Background processing could not be scheduled."));

    await drive();

    expect(savedMaterials[0].linkedQuizzes).toEqual(["quiz-1"]);
    expect(savedMaterials[0].save).toHaveBeenCalled();
  });

  test("the uploaded file is kept when indexing could not be scheduled", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new QueueEnqueueError("Background processing could not be scheduled."));

    await drive();

    // The material references this path, so deleting it would orphan the record.
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  test("a non-queue failure during scheduling is still a real failure", async () => {
    // Only a QueueEnqueueError means "committed but unscheduled". Anything else is
    // a genuine fault and must not be disguised as a partial success.
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new TypeError("bug in the enqueue call site"));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "bug in the enqueue call site" }));
    expect(res.body).toBeNull();
  });

  test("a failure before the durable write is still a genuine failure", async () => {
    // The critical counter-case: this must not become a success response just
    // because queue handling is now lenient.
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    studyMaterialCreate.mockRejectedValue(new Error("mongo write failed"));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "mongo write failed" }));
    expect(res.body).toBeNull();
    expect(quizCreate).not.toHaveBeenCalled();
    // No scheduling was even attempted, so nothing is reported as unscheduled.
    expect(jobQueueEnqueue).not.toHaveBeenCalled();
  });

  test("a scheduling failure never leaks queue internals to the client", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));
    jobQueueEnqueue.mockRejectedValue(new QueueEnqueueError("Background processing could not be scheduled."));

    const { res } = await drive();

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/redis|socket|ECONNREFUSED|password|api[_-]?key|\/app\/|at Object/i);
    expect(Object.keys(res.body.backgroundProcessing).sort()).toEqual(["jobId", "status", "task"]);
  });

  test("runs the material and quiz writes in one transaction", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    await drive();

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(runInTransaction.mock.calls[0][0].length).toBe(1);
  });
});

// ─── Degradation and failure ──────────────────────────────────────────────────

describe("the live generation path under failure", () => {
  test("fails the request when the model provider fails outright", async () => {
    setAIProvider(createFailingAIProvider(new Error("model unavailable")));

    const { res, next } = await drive();

    // A provider that cannot answer is a failed request. It used to return
    // synthetic True/False questions built from the source sentences and persist
    // them as a normal quiz, which is indistinguishable from a real one.
    expect(res.body).toBeNull();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Failed to generate questions. Please try again.",
    }));
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("fails the request when the model returns prose instead of JSON", async () => {
    setAIProvider(createMockAIProvider("I am unable to help with that request."));

    const { res, next } = await drive();

    expect(res.body).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("fails the request when the model returns a body with no content", async () => {
    setAIProvider(createMockAIProvider({ content: undefined }));

    const { res, next } = await drive();

    // No content is indistinguishable from unusable content once parsed. Both are
    // a provider failure, and neither may be answered with invented questions.
    expect(res.body).toBeNull();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Failed to generate questions. Please try again.",
    }));
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("fails the request when the extracted text cannot support any question", async () => {
    setAIProvider(createMockAIProvider({ content: undefined }));
    extractTextFromPDF.mockResolvedValue("x".repeat(600));

    const { res, next } = await drive();

    // Unusable text used to be handed to the fallback generator, which failed
    // with its own message. It is now a provider failure like any other.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Failed to generate questions. Please try again.",
    }));
    expect(quizCreate).not.toHaveBeenCalled();
    expect(res.body).toBeNull();
  });

  test("rejects a request with no uploaded file before generating anything", async () => {
    const { next } = await drive({ file: undefined });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("No file uploaded") }));
    expect(extractTextFromPDF).not.toHaveBeenCalled();
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("rejects a document with too little text to work from", async () => {
    extractTextFromPDF.mockResolvedValue("too short");

    const { next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Could not extract enough text"),
    }));
    expect(quizCreate).not.toHaveBeenCalled();
  });

  test("cleans up the uploaded file when the request fails", async () => {
    extractTextFromPDF.mockResolvedValue("too short");

    await drive();

    expect(unlinkSync).toHaveBeenCalledWith("/tmp/upload.pdf");
  });

  test("keeps the uploaded file when the request succeeds", async () => {
    setAIProvider(createMockAIProvider([acceptedQuestion()]));

    await drive();

    expect(unlinkSync).not.toHaveBeenCalled();
  });

  test("clamps a wildly oversized requested count to the documented maximum", async () => {
    const provider = createMockAIProvider([acceptedQuestion()]);
    setAIProvider(provider);

    await drive({ body: { difficulty: "Medium", count: "500" } });

    // 500 is clamped to 20, spread over the material's two chunks (10 each), and
    // the AI service then spreads that over its three picks of a single chunk, so
    // the prompt asks for 4. The point is that it is bounded, not 250.
    const prompt = provider.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("Generate 4 HIGH-QUALITY MCQs");
    expect(prompt).not.toContain("Generate 250");
  });

  test("clamps a non-positive requested count up to the minimum", async () => {
    const provider = createMockAIProvider([acceptedQuestion()]);
    setAIProvider(provider);

    await drive({ body: { difficulty: "Medium", count: "0" } });

    const prompt = provider.complete.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("Generate 1 HIGH-QUALITY MCQs");
  });
});
