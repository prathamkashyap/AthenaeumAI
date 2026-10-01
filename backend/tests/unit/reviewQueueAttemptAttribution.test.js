/**
 * Unit Tests — failed-question review-queue attribution across attempts
 *
 * `tests/unit/reviewQueueService.test.js` asserts on the *filters* the service
 * issues. This file asserts on the *documents those filters produce*, using a
 * store that matches filters the way MongoDB does — by subset equality, with
 * absent and null treated as the same value — so that "did these two upserts
 * collide?" is answered by real document state rather than by inspecting a mock.
 *
 * The defect under test: `upsertOpenQueueItem` omitted `source.attempt` from the
 * open-item filter, even though the producer always attributes a failed question
 * to an attempt and the open-item unique index (`models/ReviewQueue.js:70-84`)
 * treats the attempt as part of the item's identity. Two attempts at the same
 * quiz and topic therefore produced the same filter, so the second attempt
 * matched and overwrote the first attempt's row, replacing its attribution and
 * its mistake metadata.
 *
 * Only the Mongoose model boundaries are mocked. Every queue rule exercised here
 * is production code from `backend/services/reviewQueueService.js`.
 */

import { jest } from "@jest/globals";

// ─── A stateful store with Mongo-like filter matching ──────────────────────────

const reviewQueueFindOneAndUpdate = jest.fn();
const reviewQueueFind = jest.fn();
const reviewQueueCountDocuments = jest.fn();
const flashcardSetFind = jest.fn();
const userProgressFindOne = jest.fn();

/** Absent and null are the same value to a Mongo match, as they are to an index. */
const sameValue = (left, right) =>
  (left === undefined || left === null) && (right === undefined || right === null)
    ? true
    : String(left) === String(right);

const matches = (item, filter) =>
  Object.entries(filter).every(([key, value]) => {
    const actual = key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), item);
    return sameValue(actual, value);
  });

const store = { queueItems: [] };

reviewQueueFindOneAndUpdate.mockImplementation(async (filter, update, options = {}) => {
  const found = store.queueItems.find((item) => matches(item, filter));
  if (found) {
    Object.assign(found, update.$set);
    return found;
  }
  if (!options.upsert) return null;
  // `status` is a schema default, not part of the service's $set, so the store
  // has to apply it the way Mongoose would or nothing would read as "open".
  const created = {
    _id: `rq-${store.queueItems.length + 1}`,
    status: "open",
    ...update.$set,
    ...(update.$setOnInsert ?? {}),
  };
  store.queueItems.push(created);
  return created;
});

const chainOf = (items) => {
  const query = {
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => Promise.resolve(items),
    then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
  };
  return query;
};

reviewQueueFind.mockImplementation((filter) => chainOf(store.queueItems.filter((i) => matches(i, filter))));
reviewQueueCountDocuments.mockImplementation(async (filter) => store.queueItems.filter((i) => matches(i, filter)).length);
flashcardSetFind.mockImplementation(() => chainOf([]));
userProgressFindOne.mockImplementation(() => chainOf(null));

jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({
  default: {
    find: reviewQueueFind,
    findOneAndUpdate: reviewQueueFindOneAndUpdate,
    countDocuments: reviewQueueCountDocuments,
  },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({ default: { find: flashcardSetFind } }));
jest.unstable_mockModule("../../models/UserProgress.js", () => ({ default: { findOne: userProgressFindOne } }));
jest.unstable_mockModule("../../models/LearningEvent.js", () => ({ default: { create: jest.fn() } }));

const { enqueueFailedQuestionItems, rebuildReviewQueueForUser } = await import(
  "../../services/reviewQueueService.js"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER = "user-attrib-1";
const QUIZ = { _id: "quiz-1", subject: "Operating Systems" };
const NOW = new Date("2026-06-01T12:00:00.000Z");
const MS_DAY = 24 * 60 * 60 * 1000;

/** One failed question, with metadata that identifies which mistake it was. */
const mistake = (overrides = {}) => ({
  questionIndex: 2,
  topic: "Deadlock",
  misconception: `Holding a lock while requesting another`,
  clarification: "Deadlock needs all four conditions at once",
  distractorReason: "Chose a single condition",
  relatedFlashcards: ["fc-1"],
  ...overrides,
});

/** Enqueues one failed question as if a given attempt had produced it. */
const enqueue = (attemptId, analyses = [mistake()]) =>
  enqueueFailedQuestionItems({
    userId: USER,
    quiz: QUIZ,
    attempt: { _id: attemptId },
    mistakeAnalyses: analyses,
  });

const openItems = (itemType) =>
  store.queueItems.filter((i) => i.status === "open" && (!itemType || i.itemType === itemType));

const attemptOf = (item) => String(item.source?.attempt);
const byAttempt = (attemptId) => openItems("failed_question").filter((i) => attemptOf(i) === attemptId);

beforeEach(() => {
  store.queueItems.length = 0;
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

// ─── A. Same attempt is idempotent ────────────────────────────────────────────

describe("the same attempt converges on one open item", () => {
  test("a repeated delivery does not create a second item", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-1");
    await enqueue("attempt-1");

    expect(openItems("failed_question")).toHaveLength(1);
  });

  test("the stored attempt attribution is not disturbed by redelivery", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-1");

    expect(attemptOf(openItems("failed_question")[0])).toBe("attempt-1");
  });

  test("distinct mistakes within one attempt stay one item each", async () => {
    await enqueue("attempt-1", [mistake({ topic: "Deadlock" }), mistake({ topic: "Paging", questionIndex: 5 })]);

    expect(openItems("failed_question").map((i) => i.topic).sort()).toEqual(["Deadlock", "Paging"]);
  });
});

// ─── B. Different attempts remain distinct ────────────────────────────────────

describe("a later attempt cannot overwrite an earlier one", () => {
  test("two attempts at the same quiz and topic produce two open items", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");

    expect(openItems("failed_question")).toHaveLength(2);
  });

  test("each item keeps its own attempt attribution", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");

    expect(byAttempt("attempt-1")).toHaveLength(1);
    expect(byAttempt("attempt-2")).toHaveLength(1);
  });

  test("both items remain attributable to the same quiz", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");

    expect(openItems("failed_question").map((i) => String(i.source.quiz))).toEqual(["quiz-1", "quiz-1"]);
  });
});

// ─── C. Metadata isolation ────────────────────────────────────────────────────

describe("metadata does not migrate between attempts", () => {
  test("a later attempt does not rewrite an earlier attempt's misconception", async () => {
    await enqueue("attempt-1", [mistake({ misconception: "attempt one misconception" })]);
    await enqueue("attempt-2", [mistake({ misconception: "attempt two misconception" })]);

    expect(byAttempt("attempt-1")[0].metadata.misconception).toBe("attempt one misconception");
    expect(byAttempt("attempt-2")[0].metadata.misconception).toBe("attempt two misconception");
  });

  test("question indices do not collide across attempts", async () => {
    await enqueue("attempt-1", [mistake({ questionIndex: 1 })]);
    await enqueue("attempt-2", [mistake({ questionIndex: 4 })]);

    expect(byAttempt("attempt-1")[0].metadata.questionIndex).toBe(1);
    expect(byAttempt("attempt-2")[0].metadata.questionIndex).toBe(4);
  });

  test("the clarification and distractor reason stay with their own attempt", async () => {
    await enqueue("attempt-1", [mistake({ clarification: "one", distractorReason: "one-reason" })]);
    await enqueue("attempt-2", [mistake({ clarification: "two", distractorReason: "two-reason" })]);

    expect(byAttempt("attempt-1")[0].metadata).toMatchObject({ clarification: "one", distractorReason: "one-reason" });
    expect(byAttempt("attempt-2")[0].metadata).toMatchObject({ clarification: "two", distractorReason: "two-reason" });
  });
});

// ─── D. Replay of an earlier attempt after a later one exists ─────────────────

describe("replaying an earlier attempt after a later one exists", () => {
  test("the replayed attempt stays singular", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");
    await enqueue("attempt-1");
    await enqueue("attempt-1");

    expect(byAttempt("attempt-1")).toHaveLength(1);
  });

  test("the later attempt stays singular and keeps its own attribution", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");
    await enqueue("attempt-1");

    expect(byAttempt("attempt-2")).toHaveLength(1);
    expect(byAttempt("attempt-2")[0].source.attempt).toBe("attempt-2");
  });

  test("replay does not disturb the earlier attempt's metadata", async () => {
    await enqueue("attempt-1", [mistake({ misconception: "attempt one misconception" })]);
    await enqueue("attempt-2", [mistake({ misconception: "attempt two misconception" })]);
    await enqueue("attempt-1", [mistake({ misconception: "attempt one misconception" })]);

    expect(byAttempt("attempt-1")[0].metadata.misconception).toBe("attempt one misconception");
    expect(byAttempt("attempt-2")[0].metadata.misconception).toBe("attempt two misconception");
  });

  test("total open failed-question items match the number of distinct attempts", async () => {
    await enqueue("attempt-1");
    await enqueue("attempt-2");
    await enqueue("attempt-1");

    expect(openItems("failed_question")).toHaveLength(2);
  });
});

// ─── E. Non-attempt item types are unaffected ─────────────────────────────────

describe("queue items that are not attempt-scoped keep their identity", () => {
  const weakProgress = () =>
    userProgressFindOne.mockImplementation(() =>
      chainOf({
        _id: "progress-1",
        user: USER,
        totals: {},
        topics: [
          // weaknessScore above 35 with confidence at or above 55 is what selects
          // the `weak_topic` item type; low confidence would select
          // `low_confidence_topic` instead.
          { topic: "Deadlock", subject: "Operating Systems", attempted: 1, mastery: 40, confidence: 70, weaknessScore: 60, reviewCount: 0, lastWrongAt: null, lastPracticedAt: new Date(NOW.getTime() - MS_DAY), recommendedDifficulty: "Easy" },
        ],
      }),
    );

  test("a weak-topic item is deduplicated across repeated rebuilds", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);
    await rebuildReviewQueueForUser(USER);
    await rebuildReviewQueueForUser(USER);

    expect(openItems("weak_topic")).toHaveLength(1);
  });

  test("a rebuild does not create a failed-question item", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);

    expect(openItems("failed_question")).toHaveLength(0);
  });

  test("non-attempt items carry no attempt key in their upsert filter", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);

    for (const call of reviewQueueFindOneAndUpdate.mock.calls) {
      expect(Object.keys(call[0])).not.toContain("source.attempt");
    }
  });

  test("a topic item and a failed question on the same topic coexist", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);
    await enqueue("attempt-1");

    expect(openItems("weak_topic")).toHaveLength(1);
    expect(openItems("failed_question")).toHaveLength(1);
  });

  test("a failed question does not disturb a topic item's identity", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);
    await enqueue("attempt-1");
    await rebuildReviewQueueForUser(USER);

    expect(openItems("weak_topic")).toHaveLength(1);
    expect(openItems("failed_question")).toHaveLength(1);
  });
});

// ─── A missing attempt is rejected rather than silently merged ────────────────

describe("a failed question with no attempt is refused", () => {
  test("the error names the missing attribution", async () => {
    await expect(enqueue(undefined)).rejects.toThrow(/requires source\.attempt/);
  });

  test("nothing is written", async () => {
    await expect(enqueue(undefined)).rejects.toThrow();
    expect(store.queueItems).toHaveLength(0);
  });

  test("an attempt id of undefined is not coerced into a usable attribution", async () => {
    await expect(
      enqueueFailedQuestionItems({
        userId: USER,
        quiz: QUIZ,
        attempt: { _id: undefined },
        mistakeAnalyses: [mistake()],
      })
    ).rejects.toThrow(/requires source\.attempt/);
  });
});