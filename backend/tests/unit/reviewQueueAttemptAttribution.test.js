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

/** Applies `$set` the way MongoDB does, creating intermediate objects. */
const applySet = (doc, set) => {
  for (const [path, value] of Object.entries(set)) {
    const parts = path.split(".");
    let cursor = doc;
    for (const part of parts.slice(0, -1)) {
      if (cursor[part] == null) cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
  }
  return doc;
};

reviewQueueFindOneAndUpdate.mockImplementation(async (filter, update, options = {}) => {
  const found = store.queueItems.find((item) => matches(item, filter));
  if (found) {
    // Dotted paths included: the service writes `source.*` key by key.
    applySet(found, update.$set);
    return found;
  }
  if (!options.upsert) return null;
  // `status` is a schema default, not part of the service's $set, so the store
  // has to apply it the way Mongoose would or nothing would read as "open".
  const created = applySet(
    { _id: `rq-${store.queueItems.length + 1}`, status: "open" },
    { ...update.$set, ...(update.$setOnInsert ?? {}) }
  );
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

const reviewQueueUpdateMany = jest.fn(async (filter, update) => {
  const matched = store.queueItems.filter((i) => matches(i, filter));
  matched.forEach((i) => applySet(i, update.$set));
  return { modifiedCount: matched.length };
});

reviewQueueFind.mockImplementation((filter) => chainOf(store.queueItems.filter((i) => matches(i, filter))));
reviewQueueCountDocuments.mockImplementation(async (filter) => store.queueItems.filter((i) => matches(i, filter)).length);
flashcardSetFind.mockImplementation(() => chainOf([]));
userProgressFindOne.mockImplementation(() => chainOf(null));

jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({
  default: {
    find: reviewQueueFind,
    findOneAndUpdate: reviewQueueFindOneAndUpdate,
    updateMany: reviewQueueUpdateMany,
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

// ─── F. A linked item survives replay ──────────────────────────────────────────

/**
 * The link step `createFlashcardSet` performs (backend/services/flashcardService.js:236-242),
 * reproduced verbatim so this file can drive it against the store. The linker is
 * covered on its own terms in `flashcardMistakes.test.js`; what is under test
 * here is what a later replay does to a link it has already made.
 */
const linkFlashcards = (attemptId, flashcardSetId) =>
  reviewQueueUpdateMany(
    {
      user: USER,
      itemType: "failed_question",
      status: "open",
      "source.attempt": attemptId,
      "source.flashcardSet": null,
    },
    { $set: { "source.flashcardSet": flashcardSetId } }
  );

describe("a flashcard link added after creation survives replay", () => {
  const linked = () => openItems("failed_question").find((i) => i.source?.flashcardSet);

  test("creation persists the quiz and the attempt", async () => {
    await enqueue("attempt-1");

    const [item] = openItems("failed_question");
    expect(String(item.source.quiz)).toBe("quiz-1");
    expect(attemptOf(item)).toBe("attempt-1");
    expect(item.source.flashcardSet ?? null).toBeNull();
  });

  test("the link step attaches the flashcard set", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");

    expect(String(openItems("failed_question")[0].source.flashcardSet)).toBe("set-1");
  });

  test("one replay keeps the link", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");

    await enqueue("attempt-1");

    const items = openItems("failed_question");
    expect(items).toHaveLength(1);
    expect(attemptOf(items[0])).toBe("attempt-1");
    expect(String(items[0].source.flashcardSet)).toBe("set-1");
  });

  test("repeated replays neither erase the link nor duplicate the item", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");

    await enqueue("attempt-1");
    await enqueue("attempt-1");
    await enqueue("attempt-1");

    const items = openItems("failed_question");
    expect(items).toHaveLength(1);
    expect(String(items[0].source.flashcardSet)).toBe("set-1");
  });

  test("a replay still refreshes the producer's own content", async () => {
    await enqueue("attempt-1", [mistake({ clarification: "first explanation" })]);
    await linkFlashcards("attempt-1", "set-1");

    await enqueue("attempt-1", [mistake({ clarification: "corrected explanation" })]);

    // The fix must not degenerate into "stop updating the item".
    expect(openItems("failed_question")[0].metadata.clarification).toBe("corrected explanation");
    expect(String(openItems("failed_question")[0].source.flashcardSet)).toBe("set-1");
  });

  test("a replay does not clear the quiz attribution either", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");
    await enqueue("attempt-1");

    expect(String(openItems("failed_question")[0].source.quiz)).toBe("quiz-1");
  });

  test("a later attempt neither re-points nor unlinks the earlier one", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");

    await enqueue("attempt-2");

    expect(openItems("failed_question")).toHaveLength(2);
    expect(byAttempt("attempt-1")).toHaveLength(1);
    expect(byAttempt("attempt-2")).toHaveLength(1);
    expect(String(linked().source.flashcardSet)).toBe("set-1");
    expect(attemptOf(linked())).toBe("attempt-1");
  });

  test("the later attempt's item carries no link of its own", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");
    await enqueue("attempt-2");

    const second = byAttempt("attempt-2")[0];
    expect(second.source.flashcardSet ?? null).toBeNull();
  });

  test("replaying both attempts keeps both links and both identities", async () => {
    await enqueue("attempt-1");
    await linkFlashcards("attempt-1", "set-1");
    await enqueue("attempt-2");
    await linkFlashcards("attempt-2", "set-2");

    await enqueue("attempt-1");
    await enqueue("attempt-2");
    await enqueue("attempt-1");

    expect(openItems("failed_question")).toHaveLength(2);
    expect(String(byAttempt("attempt-1")[0].source.flashcardSet)).toBe("set-1");
    expect(String(byAttempt("attempt-2")[0].source.flashcardSet)).toBe("set-2");
  });
});

// ─── Question identity: one row per wrong question, not per topic ─────────────

/**
 * A learner can miss two questions that share a topic. Before `questionIndex`
 * became part of the item identity, both upserts built the same filter, so the
 * second overwrote the first and one of the two AI-produced diagnoses was silently
 * discarded -- while the review UI still labelled the surviving card `Q{n}`.
 *
 * This is the default path rather than an edge case: the generation prompt asks
 * for a topic but `isValidQuestion` does not require one, so a missing topic
 * normalises to "General" for every question in the quiz.
 */
describe("two wrong questions on one topic stay two items", () => {
  test("one attempt with two same-topic mistakes produces two open items", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1, misconception: "first" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "second" }),
    ]);

    expect(openItems("failed_question")).toHaveLength(2);
  });

  test("each keeps its own question index", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ]);

    expect(openItems("failed_question").map((i) => i.questionIndex).sort()).toEqual([1, 4]);
  });

  test("each keeps its own diagnosis", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1, misconception: "first misconception" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "second misconception" }),
    ]);

    expect(byAttempt("attempt-1").map((i) => i.metadata.misconception).sort()).toEqual([
      "first misconception",
      "second misconception",
    ]);
  });

  test("question zero is kept as its own question", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 0 }),
      mistake({ topic: "General", questionIndex: 3 }),
    ]);

    expect(openItems("failed_question")).toHaveLength(2);
    expect(openItems("failed_question").map((i) => i.questionIndex).sort()).toEqual([0, 3]);
  });

  test("three same-topic mistakes in one attempt stay three items", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 0 }),
      mistake({ topic: "General", questionIndex: 2 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ]);

    expect(openItems("failed_question")).toHaveLength(3);
  });

  test("mistakes on different topics are unaffected", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "Deadlock", questionIndex: 1 }),
      mistake({ topic: "Paging", questionIndex: 4 }),
    ]);

    expect(openItems("failed_question")).toHaveLength(2);
  });
});

describe("question identity stays idempotent and attempt-scoped", () => {
  test("replaying the same mistake does not duplicate it", async () => {
    const same = [mistake({ topic: "General", questionIndex: 1 })];

    await enqueue("attempt-1", same);
    await enqueue("attempt-1", same);
    await enqueue("attempt-1", same);

    expect(openItems("failed_question")).toHaveLength(1);
  });

  test("two attempts asking the same question number stay two items", async () => {
    await enqueue("attempt-1", [mistake({ topic: "General", questionIndex: 1 })]);
    await enqueue("attempt-2", [mistake({ topic: "General", questionIndex: 1 })]);

    expect(openItems("failed_question")).toHaveLength(2);
    expect(byAttempt("attempt-1")).toHaveLength(1);
    expect(byAttempt("attempt-2")).toHaveLength(1);
  });

  test("an attempt's own question is not stolen by a later attempt", async () => {
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1, misconception: "attempt one" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "attempt one too" }),
    ]);
    await enqueue("attempt-2", [
      mistake({ topic: "General", questionIndex: 1, misconception: "attempt two" }),
    ]);

    expect(byAttempt("attempt-1").map((i) => i.metadata.misconception).sort()).toEqual([
      "attempt one",
      "attempt one too",
    ]);
    expect(byAttempt("attempt-2")[0].metadata.misconception).toBe("attempt two");
  });
});

describe("an attempt collapsed before the fix heals on replay", () => {
  /** Writes the single row the old, topic-scoped identity would have produced. */
  const collapsedRow = (attemptId, questionIndex, misconception) => {
    store.queueItems.push({
      _id: `rq-collapsed-${attemptId}`,
      status: "open",
      user: USER,
      itemType: "failed_question",
      subject: "Operating Systems",
      topic: "General",
      title: "Fix misconception: General",
      priority: 80,
      dueAt: NOW,
      source: { quiz: "quiz-1", attempt: attemptId },
      questionIndex: null,
      metadata: { questionIndex, misconception },
    });
  };

  test("the previously lost question is recreated alongside the stale row", async () => {
    // Before the fix only the last-written question survived, and the surviving row
    // carries no question identity at all.
    collapsedRow("attempt-1", 4, "question four");
    expect(openItems("failed_question")).toHaveLength(1);

    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1, misconception: "question one" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "question four" }),
    ]);

    // The stale row has `questionIndex: null`, so it matches neither identity and
    // both questions are written as properly identified items beside it. The lost
    // diagnosis is recovered; the stale row itself is left in place rather than
    // deleted, because this service is an upsert and not a reconcile.
    const items = openItems("failed_question");
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.questionIndex === null)).toHaveLength(1);
    expect(items.filter((i) => i.questionIndex === 1)).toHaveLength(1);
    expect(items.filter((i) => i.questionIndex === 4)).toHaveLength(1);
  });

  test("both of the learner's questions are correctly attributed afterwards", async () => {
    collapsedRow("attempt-1", 4, "question four");
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1, misconception: "question one" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "question four" }),
    ]);

    const identified = openItems("failed_question").filter((i) => i.questionIndex !== null);
    expect(identified.map((i) => i.metadata.misconception).sort()).toEqual([
      "question four",
      "question one",
    ]);
  });

  test("further replays converge rather than accumulating", async () => {
    collapsedRow("attempt-1", 4, "question four");
    const analyses = [
      mistake({ topic: "General", questionIndex: 1, misconception: "question one" }),
      mistake({ topic: "General", questionIndex: 4, misconception: "question four" }),
    ];

    await enqueue("attempt-1", analyses);
    const afterFirst = openItems("failed_question").length;

    await enqueue("attempt-1", analyses);
    await enqueue("attempt-1", analyses);

    expect(openItems("failed_question")).toHaveLength(afterFirst);
  });
});

describe("item types with no question keep their identity", () => {
  const weakProgress = () =>
    userProgressFindOne.mockImplementation(() =>
      chainOf({
        _id: "progress-1",
        user: USER,
        totals: {},
        topics: [
          { topic: "Deadlock", subject: "Operating Systems", attempted: 1, mastery: 40, confidence: 70, weaknessScore: 60, reviewCount: 0, lastWrongAt: null, lastPracticedAt: new Date(NOW.getTime() - MS_DAY), recommendedDifficulty: "Easy" },
        ],
      }),
    );

  test("a topic item is deduplicated across repeated rebuilds", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);
    await rebuildReviewQueueForUser(USER);

    expect(openItems("weak_topic")).toHaveLength(1);
  });

  test("no rebuild upsert carries a question key", async () => {
    weakProgress();
    await rebuildReviewQueueForUser(USER);

    for (const call of reviewQueueFindOneAndUpdate.mock.calls) {
      expect(Object.keys(call[0])).not.toContain("questionIndex");
    }
  });

  test("a rebuild does not disturb a failed question's two rows", async () => {
    weakProgress();
    await enqueue("attempt-1", [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ]);

    await rebuildReviewQueueForUser(USER);

    expect(openItems("failed_question")).toHaveLength(2);
    expect(openItems("weak_topic")).toHaveLength(1);
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