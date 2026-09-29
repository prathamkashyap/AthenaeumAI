/**
 * Contract Tests — the job status endpoint
 *
 * Drives the real `backgroundJobController` and the real `backgroundJobService`
 * lookup, with only the model replaced. The point of this suite is the tenancy
 * rule: a job identifier must never be sufficient to read another learner's job.
 */

import { jest } from "@jest/globals";

const backgroundJobFindOne = jest.fn();

jest.unstable_mockModule("../../models/BackgroundJob.js", () => ({
  default: { findOne: backgroundJobFindOne, findOneAndUpdate: jest.fn(), create: jest.fn() },
  BACKGROUND_JOB_STATUS: ["pending", "queued", "running", "completed", "failed", "not_scheduled"],
  TERMINAL_BACKGROUND_JOB_STATUS: ["completed", "failed", "not_scheduled"],
}));

const { getBackgroundJobStatus } = await import("../../controllers/backgroundJobController.js");

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const storedJob = (overrides = {}) => ({
  _id: "job-1",
  user: USER_ID,
  type: "INDEX_MATERIAL",
  status: "running",
  resource: { materialId: "material-1", quizId: "quiz-1", attemptId: null },
  queueJobId: "bull-77",
  error: { code: null, message: null },
  startedAt: new Date("2026-05-01T09:00:05.000Z"),
  completedAt: null,
  createdAt: new Date("2026-05-01T09:00:00.000Z"),
  ...overrides,
});

const buildResponse = () => ({
  statusCode: null,
  body: null,
  json(payload) { this.body = payload; return this; },
});

const request = (userId = USER_ID, params = { id: "job-1" }) => ({
  user: { _id: userId },
  requestId: "req-1",
  params,
});

const drive = async (req = request()) => {
  const res = buildResponse();
  const next = jest.fn();
  await getBackgroundJobStatus(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  backgroundJobFindOne.mockImplementation(() => ({ lean: async () => storedJob() }));
});

describe("GET /api/v1/jobs/:id", () => {
  test("returns the documented status shape for the owner", async () => {
    const { res, next } = await drive();

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      jobId: "job-1",
      type: "INDEX_MATERIAL",
      status: "running",
      createdAt: expect.any(Date),
      startedAt: expect.any(Date),
      completedAt: null,
      resource: { materialId: "material-1", quizId: "quiz-1", attemptId: null },
      error: null,
    });
  });

  test("never exposes the queue's own job id", async () => {
    const { res } = await drive();

    expect(res.body).not.toHaveProperty("queueJobId");
    expect(JSON.stringify(res.body)).not.toMatch(/bull-77/);
  });

  test("scopes the lookup to the authenticated learner", async () => {
    await drive();

    expect(backgroundJobFindOne).toHaveBeenCalledWith({ _id: "job-1", user: USER_ID });
  });

  test("another learner cannot read the job by id", async () => {
    // The owner filter is part of the lookup, so the record is not found.
    backgroundJobFindOne.mockImplementation(() => ({ lean: async () => null }));

    const { res, next } = await drive(request(OTHER_USER_ID));

    expect(backgroundJobFindOne.mock.calls[0][0].user).toBe(OTHER_USER_ID);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Background job not found" }));
    expect(res.body).toBeNull();
  });

  test("an unknown job id is a not-found", async () => {
    backgroundJobFindOne.mockImplementation(() => ({ lean: async () => null }));

    const { res, next } = await drive();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: "Background job not found",
      statusCode: 404,
    }));
    expect(res.body).toBeNull();
  });

  test("a failed job reports only its safe error", async () => {
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({
        status: "failed",
        completedAt: new Date("2026-05-01T09:00:30.000Z"),
        error: { code: "JOB_FAILED", message: "Background work of type INDEX_MATERIAL did not complete." },
      }),
    }));

    const { res } = await drive();

    expect(res.body.status).toBe("failed");
    expect(res.body.error).toEqual({
      code: "JOB_FAILED",
      message: "Background work of type INDEX_MATERIAL did not complete.",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|redis|\/app\/|ECONNREFUSED/i);
  });

  test("an unscheduled job is visible as such rather than as queued work", async () => {
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({
        status: "not_scheduled",
        completedAt: new Date("2026-05-01T09:00:02.000Z"),
        error: { code: "QUEUE_ENQUEUE_FAILED", message: "Background work could not be scheduled." },
      }),
    }));

    const { res } = await drive();

    expect(res.body.status).toBe("not_scheduled");
    expect(res.body.error.code).toBe("QUEUE_ENQUEUE_FAILED");
    expect(res.body.completedAt).toEqual(expect.any(Date));
  });

  test("a completed job reports its completion time", async () => {
    const completedAt = new Date("2026-05-01T09:01:00.000Z");
    backgroundJobFindOne.mockImplementation(() => ({
      lean: async () => storedJob({ status: "completed", completedAt, error: { code: null, message: null } }),
    }));

    const { res } = await drive();

    expect(res.body).toMatchObject({ status: "completed", completedAt, error: null });
  });
});
