/**
 * Flashcard generation — request-boundary contract
 * ================================================
 *
 * Regression test for a defect that shipped in 03b5772.
 *
 * Task 21 added `sourceType: "mistakes"` to `flashcardService` and wired the
 * result page to post it, but `generateFlashcardSetSchema` still enumerated only
 * weak-topics, quiz and material. `validateRequest` rejected the request before
 * the controller, so the learner-facing "Review My Mistakes" action could never
 * work.
 *
 * It escaped because every test sat downstream of the boundary that broke: the
 * service test called `createFlashcardSet` directly with mocked models, and the
 * frontend test mocked `apiFetch`. Nothing ever put a `mistakes` request through
 * validation. Mutating the service logic proved that logic correct while the
 * feature stayed dead.
 *
 * These tests therefore drive the real router with the real schema and the real
 * `validateRequest`, and assert on whether the **controller is reached** — which
 * is precisely the thing that was wrong. Only the controller, auth and the AI
 * quota are replaced; the quota because it is orthogonal to the validation
 * contract and would otherwise make the suite order-dependent.
 */

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const ATTEMPT_ID = "507f1f77bcf86cd799439011";
const QUIZ_ID = "507f191e810c19729de860ea";
const MATERIAL_ID = "507f1f77bcf86cd799439012";

const generateFlashcardSet = jest.fn(async (req, res) => {
  res.status(201).json({ set: { _id: "set-1", sourceType: req.body.sourceType } });
});

jest.unstable_mockModule("../../controllers/flashcardController.js", () => ({
  generateFlashcardSet,
  listDueFlashcards: jest.fn(),
  listFlashcardSets: jest.fn(),
  reviewFlashcard: jest.fn(),
  deleteFlashcardSet: jest.fn(),
}));

jest.unstable_mockModule("../../middleware/authMiddleware.js", () => ({
  requireAuth: (req, res, next) => {
    req.user = { _id: ATTEMPT_ID };
    next();
  },
}));

jest.unstable_mockModule("../../middleware/aiQuotaMiddleware.js", () => ({
  userAiQuota: () => (req, res, next) => next(),
}));

const { default: flashcardRoutes } = await import("../../routes/flashcardRoutes.js");

const app = express();
app.use(express.json());
app.use("/api/v1/flashcards", flashcardRoutes);
// Mirrors the production error handler's use of the error's own status, so a
// validation failure surfaces as the 400 it is rather than a 500.
app.use((err, req, res, next) => {
  res.status(err.statusCode || err.status || 500).json({ error: err.message });
});

const generate = (body) => request(app).post("/api/v1/flashcards/generate").send(body);

beforeEach(() => {
  generateFlashcardSet.mockClear();
});

describe("the mistakes source type reaches the controller", () => {
  test("is accepted when it names an attempt", async () => {
    const response = await generate({ sourceType: "mistakes", sourceId: ATTEMPT_ID });

    // The regression itself. Before the fix this was 400 and the controller was
    // never invoked, which is what made the shipped feature non-functional.
    expect(response.status).toBe(201);
    expect(generateFlashcardSet).toHaveBeenCalledTimes(1);
  });

  test("passes the attempt id through to the controller", async () => {
    await generate({ sourceType: "mistakes", sourceId: ATTEMPT_ID });

    const [[req]] = generateFlashcardSet.mock.calls;
    expect(req.body.sourceType).toBe("mistakes");
    expect(req.body.sourceId).toBe(ATTEMPT_ID);
  });

  test("requires a source id, because a missing one would match an arbitrary attempt", async () => {
    const response = await generate({ sourceType: "mistakes" });

    // The service looks the attempt up by id. Mongoose strips an undefined `_id`
    // from a filter, so accepting a missing sourceId here would let the request
    // through and silently build a deck from whichever attempt came back first.
    expect(response.status).toBe(400);
    expect(generateFlashcardSet).not.toHaveBeenCalled();
  });

  test("rejects a malformed attempt id", async () => {
    const response = await generate({ sourceType: "mistakes", sourceId: "not-an-id" });

    expect(response.status).toBe(400);
    expect(generateFlashcardSet).not.toHaveBeenCalled();
  });
});

describe("existing source types are unaffected", () => {
  test("weak-topics still works with no source id", async () => {
    const response = await generate({ sourceType: "weak-topics", count: 12 });

    // weak-topics derives from the learner's own progress, so it never had a
    // source id and must not gain a requirement.
    expect(response.status).toBe(201);
    expect(generateFlashcardSet).toHaveBeenCalledTimes(1);
  });

  test("quiz still works with a source id", async () => {
    const response = await generate({ sourceType: "quiz", sourceId: QUIZ_ID });

    expect(response.status).toBe(201);
  });

  test("material still works with a source id", async () => {
    const response = await generate({ sourceType: "material", sourceId: MATERIAL_ID });

    expect(response.status).toBe(201);
  });

  test("quiz is still rejected without a source id", async () => {
    const response = await generate({ sourceType: "quiz" });

    expect(response.status).toBe(400);
  });

  test("material is still rejected without a source id", async () => {
    const response = await generate({ sourceType: "material" });

    expect(response.status).toBe(400);
  });

  test("an unknown source type is still rejected", async () => {
    const response = await generate({ sourceType: "not-a-source", sourceId: QUIZ_ID });

    expect(response.status).toBe(400);
    expect(generateFlashcardSet).not.toHaveBeenCalled();
  });

  test("a request with no sourceType is still rejected", async () => {
    // Pre-existing behaviour, recorded here because it is surprising: the
    // controller defaults `sourceType` to "weak-topics", but the schema has no
    // default for it, so validation rejects the request first and the
    // controller's default is unreachable over HTTP. Not changed by this fix,
    // since altering it would alter existing validation behaviour.
    const response = await generate({ count: 8 });

    expect(response.status).toBe(400);
    expect(generateFlashcardSet).not.toHaveBeenCalled();
  });
});

describe("count bounds are unchanged", () => {
  test("still rejects a count above the maximum", async () => {
    const response = await generate({ sourceType: "weak-topics", count: 51 });

    expect(response.status).toBe(400);
  });

  test("accepts a count at the maximum", async () => {
    const response = await generate({ sourceType: "weak-topics", count: 50 });

    expect(response.status).toBe(201);
  });

  test("a count of zero is still coerced to the default rather than rejected", async () => {
    // Pre-existing behaviour, pinned so a future change to it is deliberate.
    // The count is run through `z.preprocess(val => val ? parseInt(val) : 12)`,
    // and 0 is falsy, so it becomes 12 before `.min(1)` ever sees it. The
    // declared minimum therefore cannot be triggered by zero.
    const response = await generate({ sourceType: "weak-topics", count: 0 });

    expect(response.status).toBe(201);
    const [[req]] = generateFlashcardSet.mock.calls;
    expect(req.body.count).toBe(12);
  });
});
