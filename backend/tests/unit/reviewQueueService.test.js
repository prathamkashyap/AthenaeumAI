/**
 * Unit Tests — reviewQueueService
 *
 * These tests import and execute the shipped production implementation from
 * `backend/services/reviewQueueService.js`. Only the Mongoose model boundaries
 * are mocked. The topic filter, the twelve-item cap, the item type rules, both
 * priority formulas, the flashcard overdue arithmetic, the listing sort and
 * pagination, the completion update and its learning event, and the snooze
 * update are all production code executed here.
 *
 * Every expected value below is a concrete literal read off the shipped
 * implementation. No queue formula is reimplemented in this file. The helpers
 * here only build documents and wire up model stubs.
 *
 * `upsertOpenQueueItem` is module-private, so it is exercised through its two
 * public call sites, `enqueueFailedQuestionItems` and `rebuildReviewQueueForUser`,
 * and its `findOneAndUpdate` interaction is asserted directly.
 */

import { jest } from "@jest/globals";

// ─── Mongoose boundary mocks ──────────────────────────────────────────────────

const reviewQueueFind = jest.fn();
const reviewQueueFindOneAndUpdate = jest.fn();
const reviewQueueCountDocuments = jest.fn();
const flashcardSetFind = jest.fn();
const userProgressFindOne = jest.fn();
const learningEventCreate = jest.fn();

/** A chainable, awaitable query stub that records the chain methods used. */
const queryOf = (data) => {
  const chain = { sort: null, skip: null, limit: null, select: null, populate: null };
  const query = {
    chain,
    sort: (...args) => { chain.sort = args; return query; },
    skip: (...args) => { chain.skip = args; return query; },
    limit: (...args) => { chain.limit = args; return query; },
    select: (...args) => { chain.select = args; return query; },
    populate: (...args) => { chain.populate = args; return query; },
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return query;
};

jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({
  default: {
    find: reviewQueueFind,
    findOneAndUpdate: reviewQueueFindOneAndUpdate,
    countDocuments: reviewQueueCountDocuments,
  },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({
  default: { find: flashcardSetFind },
}));
jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: userProgressFindOne },
}));
jest.unstable_mockModule("../../models/LearningEvent.js", () => ({
  default: { create: learningEventCreate },
}));

const {
  enqueueFailedQuestionItems,
  rebuildReviewQueueForUser,
  listReviewQueue,
  completeReviewQueueItem,
  snoozeReviewQueueItem,
} = await import("../../services/reviewQueueService.js");

// ─── Deterministic clock ──────────────────────────────────────────────────────

const NOW = new Date("2026-04-10T12:00:00.000Z");
const MS_DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const USER_ID = "user-rq-1";

const beforeNow = (ms) => new Date(NOW.getTime() - ms);
const afterNow = (ms) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  reviewQueueFind.mockReturnValue(queryOf([]));
  reviewQueueCountDocuments.mockResolvedValue(0);
  // Models reality rather than always resolving truthy: the identifying lookup
  // runs without `upsert` and normally finds nothing, and only the creating call
  // produces a document. A double that always returned a row would make the
  // service stop at the lookup and never reach the upsert at all.
  reviewQueueFindOneAndUpdate.mockImplementation(async (filter, update, options = {}) =>
    options?.upsert ? { _id: "rq-1", ...update.$set } : null
  );
  flashcardSetFind.mockReturnValue(queryOf([]));
  userProgressFindOne.mockReturnValue(queryOf(null));
  learningEventCreate.mockResolvedValue({ _id: "event-1" });
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────
// Document construction and mock wiring only. No queue rules live here.

const topic = (name, overrides = {}) => ({
  topic: name,
  subject: "Operating Systems",
  attempted: 1,
  mastery: 50,
  confidence: 50,
  weaknessScore: 0,
  reviewCount: 0,
  lastWrongAt: null,
  lastPracticedAt: beforeNow(MS_DAY),
  recommendedDifficulty: "Easy",
  ...overrides,
});

const card = (id, topicName, review = {}) => ({
  _id: id,
  front: `front of ${id}`,
  topic: topicName,
  review: { interval: 0, intervalDays: 0, repetitions: 0, nextReviewAt: null, dueAt: null, ...review },
});

const set = (id, title, cards) => ({ _id: id, title, cards });

const progressWith = (topics) => ({ _id: "progress-1", user: USER_ID, totals: {}, topics });

const withProgress = (topics) => userProgressFindOne.mockReturnValue(queryOf(progressWith(topics)));
const withFlashcards = (sets) => flashcardSetFind.mockReturnValue(queryOf(sets));
const withQueue = (items, total = items.length) => {
  reviewQueueFind.mockReturnValue(queryOf(items));
  reviewQueueCountDocuments.mockResolvedValue(total);
};

/**
 * Only the calls that can create a row. The service first looks up the identified
 * row without upserting, so that a miss can be offered a chance to adopt a row
 * written before `questionIndex` existed rather than duplicating it.
 */
const creatingCalls = () =>
  reviewQueueFindOneAndUpdate.mock.calls.filter((call) => call[2]?.upsert);

/**
 * The upsert calls the production service issued, in order. Excluding the
 * identifying lookups keeps one entry per logical item, as there was when a
 * single call did both jobs.
 */
const upserts = () => creatingCalls();

/** The document `$set` payload of the nth upsert. */
const upsertedItem = (index) => creatingCalls()[index][1].$set;

/** The match filters of the upserts issued, in order. */
const upsertFilters = () => creatingCalls().map((call) => call[0]);

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Topic queue items produced by rebuildReviewQueueForUser ──────────────────

describe("rebuildReviewQueueForUser — topic selection", () => {
  // Production filter (`reviewQueueService.js:59`):
  //   attempted > 0 && (weaknessScore > 35 || confidence < 55)
  const FILTER_TOPICS = () => [
    topic("Deadlock", { subject: "Operating Systems", attempted: 2, mastery: 48, confidence: 40, weaknessScore: 62 }),
    topic("Paging", { subject: "Computer Systems", attempted: 1, mastery: 35, confidence: 30, weaknessScore: 74 }),
    topic("Scheduling", { attempted: 3, mastery: 71, confidence: 60, weaknessScore: 24 }),
    topic("Process Control Block", { attempted: 4, mastery: 82, confidence: 90, weaknessScore: 12, recommendedDifficulty: "Hard" }),
    topic("Memory", { subject: "Computer Systems", attempted: 1, mastery: 90, confidence: 50, weaknessScore: 0, recommendedDifficulty: "Hard" }),
    topic("Virtual Memory", { subject: "Computer Systems", attempted: 1, mastery: 20, confidence: 88, weaknessScore: 10 }),
    topic("Untouched", { attempted: 0, mastery: 10, confidence: 5, weaknessScore: 95 }),
  ];

  test("keeps a topic whose weakness exceeds 35", async () => {
    withProgress([topic("Weak", { weaknessScore: 36, confidence: 80 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).topic).toBe("Weak");
  });

  test("excludes a topic whose weakness is exactly 35", async () => {
    withProgress([topic("Boundary", { weaknessScore: 35, confidence: 80 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("keeps a topic whose confidence is below 55 even with no weakness recorded", async () => {
    withProgress([topic("LowConfidence", { weaknessScore: 0, confidence: 54 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).topic).toBe("LowConfidence");
  });

  test("excludes a topic whose confidence is exactly 55", async () => {
    withProgress([topic("Boundary", { weaknessScore: 0, confidence: 55 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("ignores mastery entirely when deciding whether a topic is weak", async () => {
    // mastery 10 with no weakness and high confidence is still excluded
    withProgress([topic("LowMasteryOnly", { mastery: 10, weaknessScore: 0, confidence: 90 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("excludes a topic that has never been attempted however weak it looks", async () => {
    withProgress([topic("Untouched", { attempted: 0, weaknessScore: 95, confidence: 5 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("keeps only the qualifying topics from a mixed list", async () => {
    withProgress(FILTER_TOPICS());
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts().map((call) => call[1].$set.topic)).toEqual(["Deadlock", "Paging", "Memory"]);
  });

  test("caps the topic items at twelve, taking them in progress order", async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      topic(`Topic ${i}`, { weaknessScore: 90 - i, confidence: 50 }));
    withProgress(many);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(12);
    expect(upserts().map((call) => call[1].$set.topic)).toEqual(
      Array.from({ length: 12 }, (_, i) => `Topic ${i}`),
    );
  });

  test("reads the learner's topics with a user-scoped progress query", async () => {
    withProgress([]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(userProgressFindOne).toHaveBeenCalledWith({ user: USER_ID });
  });
});

// ─── Topic item shape and priority ────────────────────────────────────────────

describe("rebuildReviewQueueForUser — topic item construction", () => {
  test("classifies a low-confidence topic as low_confidence_topic", async () => {
    withProgress([topic("Deadlock", { confidence: 30, weaknessScore: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).itemType).toBe("low_confidence_topic");
  });

  test("classifies a confident but weak topic as weak_topic", async () => {
    withProgress([topic("Paging", { confidence: 90, weaknessScore: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).itemType).toBe("weak_topic");
  });

  test("titles a low-confidence topic with the rebuild wording", async () => {
    withProgress([topic("Deadlock", { confidence: 30, weaknessScore: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).title).toBe("Rebuild confidence: Deadlock");
  });

  test("titles a weak topic with the review wording", async () => {
    withProgress([topic("Paging", { confidence: 90, weaknessScore: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).title).toBe("Review weak topic: Paging");
  });

  test("describes the topic with its mastery, confidence and weakness", async () => {
    withProgress([topic("Deadlock", { mastery: 48, confidence: 40, weaknessScore: 62 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).description).toBe("Mastery 48%, confidence 40%, weakness 62%.");
  });

  test("carries mastery, confidence, weakness and difficulty in metadata", async () => {
    withProgress([topic("Deadlock", { mastery: 48, confidence: 40, weaknessScore: 62, recommendedDifficulty: "Easy" })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).metadata).toEqual({
      mastery: 48, confidence: 40, weaknessScore: 62, recommendedDifficulty: "Easy",
    });
  });

  test("takes priority from weakness when weakness is the larger side", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 62, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).priority).toBe(62);
  });

  test("takes priority from the confidence gap when that is the larger side", async () => {
    withProgress([topic("Memory", { weaknessScore: 10, confidence: 30 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).priority).toBe(70);
  });

  test("falls back to zero weakness and an empty subject when the topic omits them", async () => {
    withProgress([topic("Sparse", { subject: "", weaknessScore: undefined, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).subject).toBe("");
    expect(upsertedItem(0).description).toBe("Mastery 50%, confidence 40%, weakness 0%.");
    expect(upsertedItem(0).priority).toBe(60);
  });

  test("schedules topic items due immediately", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).dueAt).toEqual(NOW);
  });

  test("attaches topic items to the requesting learner with no source reference", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).user).toBe(USER_ID);
    // The service writes `source` key by key and a topic item carries none, so
    // it contributes no `source` key at all. Nothing here clears a link either:
    // the update deliberately never assigns a `source` field it was not given.
    expect(Object.keys(upsertedItem(0)).filter((k) => k.startsWith("source"))).toEqual([]);
  });

  test("falls back to zeroed values when a topic omits its optional fields", async () => {
    // A topic with no confidence is treated as confidence 0, which is below 55
    // and so qualifies. Absent mastery, weakness and subject are all substituted
    // by the service.
    withProgress([{ topic: undefined, subject: undefined, attempted: 1 }]);
    await rebuildReviewQueueForUser(USER_ID);
    const item = upsertedItem(0);
    expect(item.subject).toBe("");
    expect(item.itemType).toBe("low_confidence_topic");
    expect(item.title).toBe("Rebuild confidence: undefined");
    expect(item.description).toBe("Mastery 0%, confidence 0%, weakness 0%.");
    expect(item.priority).toBe(100);
  });

  test("normalises a missing topic in the upsert filter but not in the stored payload", async () => {
    // Production builds the filter with `item.topic || "General"` (line 12) but
    // $sets the raw item, so the two can disagree. A real write is saved by the
    // ReviewQueue schema default of "General"; the service payload itself does
    // not carry the substitution.
    withProgress([{ topic: undefined, subject: undefined, attempted: 1 }]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter, update] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter.topic).toBe("General");
    expect(update.$set.topic).toBeUndefined();
  });

  test("treats a progress document without a topic list as having no topics", async () => {
    withProgress(undefined);
    userProgressFindOne.mockReturnValue(queryOf({ _id: "progress-1", user: USER_ID, totals: {} }));
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });
});

// ─── Flashcard queue items ────────────────────────────────────────────────────

describe("rebuildReviewQueueForUser — flashcard items", () => {
  test("creates a due_flashcard for a card due at this instant", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: NOW })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).itemType).toBe("due_flashcard");
    expect(upsertedItem(0).priority).toBe(55);
  });

  test("gives a just-due card a priority between the base and one day overdue", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: beforeNow(6 * HOUR) })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).priority).toBe(57);
  });

  test("creates an overdue_review at exactly one day overdue", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: beforeNow(MS_DAY) })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).itemType).toBe("overdue_review");
    expect(upsertedItem(0).priority).toBe(63);
  });

  test("raises the priority two further points per overdue day", async () => {
    withProgress([]);
    withFlashcards([
      set("deck-1", "OS Deck", [
        card("c1", "Deadlock", { nextReviewAt: beforeNow(2 * MS_DAY) }),
        card("c2", "Paging", { nextReviewAt: beforeNow(3 * MS_DAY) }),
      ]),
    ]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts().map((call) => call[1].$set.priority)).toEqual([71, 79]);
  });

  test("rounds the half-day overdue priority", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: beforeNow(2.5 * MS_DAY) })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).priority).toBe(75);
  });

  test("skips a card scheduled in the future", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Future", { nextReviewAt: afterNow(MS_DAY) })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("skips a card with no scheduling date", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Undated", {})])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts()).toHaveLength(0);
  });

  test("falls back to dueAt when nextReviewAt is absent", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: null, dueAt: beforeNow(MS_DAY) })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).itemType).toBe("overdue_review");
  });

  test("falls back to the General topic when the card has none", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", undefined, { nextReviewAt: NOW })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).topic).toBe("General");
    expect(upsertedItem(0).title).toBe("Due flashcard: General");
  });

  test("uses the card front as the description and the deck title in metadata", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: NOW, interval: 4, repetitions: 2 })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).description).toBe("front of c1");
    expect(upsertedItem(0).metadata).toEqual({ setTitle: "OS Deck", interval: 4, repetitions: 2 });
  });

  test("reads the card interval from intervalDays when interval is absent", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: NOW, interval: 0, intervalDays: 9, repetitions: 1 })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).metadata.interval).toBe(9);
  });

  test("keeps the card's own due date rather than now", async () => {
    const due = beforeNow(MS_DAY);
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: due })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upsertedItem(0).dueAt).toEqual(due);
  });

  test("scopes the due-deck query to the learner and both scheduling fields", async () => {
    withProgress([]);
    await rebuildReviewQueueForUser(USER_ID);
    const filter = flashcardSetFind.mock.calls[0][0];
    expect(filter.user).toBe(USER_ID);
    expect(filter.$or).toHaveLength(2);
    expect(Object.keys(filter.$or[0])).toEqual(["cards.review.nextReviewAt"]);
    expect(Object.keys(filter.$or[1])).toEqual(["cards.review.dueAt"]);
    filter.$or.forEach((clause) => {
      expect(Object.values(clause)[0].$lte).toEqual(NOW);
    });
  });

  test("emits topic items before flashcard items", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Paging", { nextReviewAt: NOW })])]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(upserts().map((call) => call[1].$set.itemType)).toEqual([
      "low_confidence_topic", "due_flashcard",
    ]);
  });
});

// ─── upsertOpenQueueItem, exercised through its public call sites ─────────────

describe("upsert interaction", () => {
  test("upserts with an open status in the filter", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe("open");
  });

  test("upserts with the learner, item type and topic in the filter", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ user: USER_ID, itemType: "low_confidence_topic", topic: "Deadlock", status: "open" });
  });

  test("omits source keys for a topic item", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(Object.keys(filter).sort()).toEqual(["itemType", "status", "topic", "user"]);
  });

  test("adds the flashcard set and card ids to the filter for a flashcard item", async () => {
    withProgress([]);
    withFlashcards([set("deck-1", "OS Deck", [card("c1", "Deadlock", { nextReviewAt: NOW })])]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter["source.flashcardSet"]).toBe("deck-1");
    expect(filter["source.flashcardId"]).toBe("c1");
  });

  // The filter is the application half of the open-item unique index, and it is
  // asserted by its exact key set on purpose: a narrower filter means the
  // database's uniqueness is decided by a key the service does not match on, which
  // is precisely how two mistakes on one topic collapsed into a single row.
  test("identifies a failed question by quiz, attempt and question, matching the unique index", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [{ questionIndex: 2, topic: "Deadlock" }],
    });
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter["source.quiz"]).toBe("quiz-1");
    expect(filter["source.attempt"]).toBe("attempt-1");
    expect(filter.questionIndex).toBe(2);
    expect(Object.keys(filter).sort()).toEqual([
      "itemType",
      "questionIndex",
      "source.attempt",
      "source.quiz",
      "status",
      "topic",
      "user",
    ]);
  });

  // A question index of 0 is a real question, not an absent one, so the guard must
  // not be a truthiness check.
  test("keeps a question index of zero in the identity", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [{ questionIndex: 0, topic: "Deadlock" }],
    });
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(Object.keys(filter)).toContain("questionIndex");
    expect(filter.questionIndex).toBe(0);
  });

  test("writes the question index as a first-class field, not only into metadata", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [{ questionIndex: 2, topic: "Deadlock" }],
    });
    expect(upsertedItem(0).questionIndex).toBe(2);
    // Deliberately duplicated so the review UI keeps rendering its `Q{n}` badge
    // without a frontend change.
    expect(upsertedItem(0).metadata.questionIndex).toBe(2);
  });

  // The four item types that are not scoped to a question must not grow a key that
  // carries no information; adding it unconditionally would enlarge every index
  // entry while contributing no selectivity.
  test("gives topic items an identity with no question key at all", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    const [filter] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(Object.keys(filter)).not.toContain("questionIndex");
  });

  // The adoption lookup is a second, differently-shaped match. Its scoping is the
  // only thing standing between "adopt my own stale row" and "adopt somebody's",
  // so it is asserted by its exact key set.
  describe("the legacy adoption lookup", () => {
    /** The identifying and adoption lookups: every call made without `upsert`. */
    const lookups = () => reviewQueueFindOneAndUpdate.mock.calls.filter((call) => !call[2]?.upsert);

    /**
     * Only the adoption lookup, identified by the one thing unique to it: a filter
     * that may select a row with no question identity. The identifying lookup runs
     * for every item, so counting all lookups would not show whether adoption was
     * attempted.
     */
    const adoptionLookups = () =>
      reviewQueueFindOneAndUpdate.mock.calls.filter(
        (call) => !call[2]?.upsert && call[0]["metadata.questionIndex"] !== undefined
      );

    const enqueueOnce = (questionIndex = 4) =>
      enqueueFailedQuestionItems({
        userId: USER_ID,
        quiz: { _id: "quiz-1", subject: "Operating Systems" },
        attempt: { _id: "attempt-1" },
        mistakeAnalyses: [{ questionIndex, topic: "General" }],
      });

    test("is attempted only after the identified lookup misses", async () => {
      await enqueueOnce();

      const [identified, adoption] = lookups();
      expect(identified[0]["source.attempt"]).toBe("attempt-1");
      expect(identified[0].questionIndex).toBe(4);
      // The adoption lookup is the second match, and it is the only one that may
      // select a row lacking question identity.
      expect(adoption[0].questionIndex).toBeNull();
    });

    test("is scoped to the same user, quiz, attempt, topic and item type", async () => {
      await enqueueOnce();

      const adoption = lookups()[1][0];
      expect(adoption.user).toBe(USER_ID);
      expect(adoption.itemType).toBe("failed_question");
      expect(adoption.status).toBe("open");
      expect(adoption.topic).toBe("General");
      expect(adoption["source.quiz"]).toBe("quiz-1");
      expect(adoption["source.attempt"]).toBe("attempt-1");
    });

    test("selects only rows whose stored metadata names the same question", async () => {
      await enqueueOnce(3);

      expect(lookups()[1][0]["metadata.questionIndex"]).toBe(3);
    });

    test("cannot select a row that already has question identity", async () => {
      await enqueueOnce();

      // `questionIndex: null` is what excludes an identified row: MongoDB
      // equality-matches absent and null identically, and an identified row holds
      // a number there.
      expect(lookups()[1][0].questionIndex).toBeNull();
    });

    test("never upserts, so it cannot create a row", async () => {
      await enqueueOnce();

      expect(lookups()[1][2].upsert).toBeUndefined();
    });

    test("is not attempted for items with no question identity", async () => {
      withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
      await rebuildReviewQueueForUser(USER_ID);

      // A topic item is identified and then created, with no adoption attempt, so
      // its identity and deduplication are untouched.
      expect(adoptionLookups()).toHaveLength(0);
      expect(creatingCalls().length).toBeGreaterThan(0);
    });

    test("is not attempted for the flashcard item types either", async () => {
      withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
      flashcardSetFind.mockReturnValue(
        queryOf([
          set("set-1", "Deck", [card("c1", "Deadlock", { nextReviewAt: beforeNow(MS_DAY) })]),
        ]),
      );
      await rebuildReviewQueueForUser(USER_ID);

      expect(adoptionLookups()).toHaveLength(0);
    });

    test("writes the same payload as an ordinary upsert, so adoption is not a lesser update", async () => {
      await enqueueOnce();

      // Compared on $set alone: the creating call additionally carries
      // $setOnInsert, which adoption must not, since it never creates.
      expect(lookups()[1][1].$set).toEqual(creatingCalls()[0][1].$set);
    });

    test("stamps nothing on adoption, because it cannot create", async () => {
      await enqueueOnce();

      expect(lookups()[1][1].$setOnInsert).toBeUndefined();
    });
  });

  test("gives two attempts on the same quiz distinct identities", async () => {
    const enqueue = (attemptId) =>
      enqueueFailedQuestionItems({
        userId: USER_ID,
        quiz: { _id: "quiz-1", subject: "Operating Systems" },
        attempt: { _id: attemptId },
        mistakeAnalyses: [{ questionIndex: 2, topic: "Deadlock" }],
      });

    await enqueue("attempt-1");
    await enqueue("attempt-2");

    const [firstFilter, secondFilter] = upsertFilters();
    expect(firstFilter["source.attempt"]).toBe("attempt-1");
    expect(secondFilter["source.attempt"]).toBe("attempt-2");
    // Same quiz, same topic, same type -- the attempt is the only difference.
    expect({ ...firstFilter, "source.attempt": null }).toEqual({
      ...secondFilter,
      "source.attempt": null,
    });
  });

  test("gives a repeated delivery of the same attempt the same identity", async () => {
    const enqueue = () =>
      enqueueFailedQuestionItems({
        userId: USER_ID,
        quiz: { _id: "quiz-1", subject: "Operating Systems" },
        attempt: { _id: "attempt-1" },
        mistakeAnalyses: [{ questionIndex: 2, topic: "Deadlock" }],
      });

    await enqueue();
    await enqueue();

    const [firstFilter, secondFilter] = upsertFilters();
    expect(secondFilter).toEqual(firstFilter);
  });

  test("rejects a failed question that arrives with no attempt to attribute it to", async () => {
    await expect(
      enqueueFailedQuestionItems({
        userId: USER_ID,
        quiz: { _id: "quiz-1", subject: "Operating Systems" },
        attempt: {},
        mistakeAnalyses: [{ questionIndex: 2, topic: "Deadlock" }],
      })
    ).rejects.toThrow(/requires source\.attempt/);
    expect(reviewQueueFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test("requests an upsert that returns the updated document", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    expect(creatingCalls().length).toBeGreaterThan(0);
    expect(creatingCalls()[0][2]).toEqual({ upsert: true, new: true });
  });

  test("stamps createdAt only when the item is inserted", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    // The identifying lookup must not stamp anything; only the creating call does.
    const lookups = reviewQueueFindOneAndUpdate.mock.calls.filter((call) => !call[2]?.upsert);
    expect(lookups.length).toBeGreaterThan(0);
    lookups.forEach(([, update]) => expect(update.$setOnInsert).toBeUndefined());

    const [, update] = creatingCalls()[0];
    expect(update.$setOnInsert).toEqual({ createdAt: NOW });
  });

  test("reuses the same filter for the same logical item, so a rebuild converges", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    await rebuildReviewQueueForUser(USER_ID);
    const [first, second] = reviewQueueFindOneAndUpdate.mock.calls;
    expect(first[0]).toEqual(second[0]);
    expect(first[1].$set).toEqual(second[1].$set);
  });

  test("does not remove open items that are no longer justified", async () => {
    withProgress([topic("Deadlock", { weaknessScore: 40, confidence: 40 })]);
    await rebuildReviewQueueForUser(USER_ID);
    // Production only ever $sets or $setOnInserts; nothing is deleted or closed.
    // A lookup carries $set alone, a creating call carries both.
    const operations = reviewQueueFindOneAndUpdate.mock.calls.map(
      (call) => Object.keys(call[1]).sort().join(","),
    );
    operations.forEach((keys) => {
      expect([ "$set", "$set,$setOnInsert" ]).toContain(keys);
    });
    // Nothing is ever unset, which is how a post-creation link survives replay.
    for (const [, update] of reviewQueueFindOneAndUpdate.mock.calls) {
      expect(update.$unset).toBeUndefined();
      expect(update.$pull).toBeUndefined();
    }
    expect(reviewQueueFind.mock.results.length).toBeGreaterThan(0);
  });
});

// ─── enqueueFailedQuestionItems ───────────────────────────────────────────────

describe("enqueueFailedQuestionItems", () => {
  const analysis = (overrides = {}) => ({
    questionIndex: 2,
    topic: "Deadlock",
    misconception: "Confuses hold-and-wait with circular wait.",
    clarification: "A cycle of waits is required.",
    distractorReason: "The option names a real condition but not the cyclic one.",
    revisionSuggestion: "Redraw the four conditions and check for a cycle.",
    relatedFlashcards: ["State the four deadlock conditions."],
    ...overrides,
  });

  test("creates one queue item per mistake analysis", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis(), analysis({ topic: "Paging", questionIndex: 3 })],
    });
    expect(upserts()).toHaveLength(2);
    expect(upserts().map((call) => call[1].$set.topic)).toEqual(["Deadlock", "Paging"]);
  });

  test("marks the item as a failed question owned by the learner", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).itemType).toBe("failed_question");
    expect(upsertedItem(0).user).toBe(USER_ID);
  });

  test("uses a fixed priority and an immediate due date", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).priority).toBe(80);
    expect(upsertedItem(0).dueAt).toEqual(NOW);
  });

  test("links the item to the quiz and the attempt", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    // Written as explicit `source.*` paths rather than one `source`
    // subdocument, so that a replay which supplies neither cannot erase a
    // flashcard link that was added after creation.
    expect(upsertedItem(0)["source.quiz"]).toBe("quiz-1");
    expect(upsertedItem(0)["source.attempt"]).toBe("attempt-1");
    expect(Object.keys(upsertedItem(0))).not.toContain("source");
  });

  test("carries the analysis detail into metadata", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).metadata).toEqual({
      questionIndex: 2,
      misconception: "Confuses hold-and-wait with circular wait.",
      clarification: "A cycle of waits is required.",
      distractorReason: "The option names a real condition but not the cyclic one.",
      relatedFlashcards: ["State the four deadlock conditions."],
    });
  });

  test("titles the item after the misconception topic", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1", subject: "Operating Systems" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).title).toBe("Fix misconception: Deadlock");
  });

  test("prefers the revision suggestion as the description", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).description).toBe("Redraw the four conditions and check for a cycle.");
  });

  test("falls back to the clarification when no revision suggestion exists", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [{ questionIndex: 1, topic: "Paging", clarification: "Start from the fault." }],
    });
    expect(upsertedItem(0).description).toBe("Start from the fault.");
  });

  test("falls back to the General topic when the analysis has none", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [{ questionIndex: 1, clarification: "Anything." }],
    });
    expect(upsertedItem(0).topic).toBe("General");
    expect(upsertedItem(0).title).toBe("Fix misconception: General");
  });

  test("falls back to an empty subject when the quiz has none", async () => {
    await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [analysis()],
    });
    expect(upsertedItem(0).subject).toBe("");
  });

  test("does nothing when there are no analyses", async () => {
    const result = await enqueueFailedQuestionItems({
      userId: USER_ID,
      quiz: { _id: "quiz-1" },
      attempt: { _id: "attempt-1" },
      mistakeAnalyses: [],
    });
    expect(result).toEqual([]);
    expect(upserts()).toHaveLength(0);
  });
});

// ─── listReviewQueue ──────────────────────────────────────────────────────────

describe("listReviewQueue", () => {
  const openItem = (id, priority, dueAt) => ({ _id: id, priority, dueAt, status: "open" });

  test("queries only the learner's open items", async () => {
    await listReviewQueue(USER_ID);
    expect(reviewQueueFind).toHaveBeenCalledWith({ user: USER_ID, status: "open" });
    expect(reviewQueueCountDocuments).toHaveBeenCalledWith({ user: USER_ID, status: "open" });
  });

  test("sorts by descending priority then ascending due date", async () => {
    await listReviewQueue(USER_ID);
    const query = reviewQueueFind.mock.results[0].value;
    expect(query.chain.sort).toEqual([{ priority: -1, dueAt: 1 }]);
  });

  test("returns the items the query produced", async () => {
    const items = [openItem("a", 90, NOW), openItem("b", 40, NOW)];
    withQueue(items);
    const result = await listReviewQueue(USER_ID);
    expect(result.items).toEqual(items);
  });

  test("defaults to the first page of twenty", async () => {
    await listReviewQueue(USER_ID);
    const query = reviewQueueFind.mock.results[0].value;
    expect(query.chain.skip).toEqual([0]);
    expect(query.chain.limit).toEqual([20]);
  });

  test("skips a whole page when a later page is requested", async () => {
    await listReviewQueue(USER_ID, { page: 3, limit: 20 });
    const query = reviewQueueFind.mock.results[0].value;
    expect(query.chain.skip).toEqual([40]);
  });

  test("clamps a page below one back to the first page", async () => {
    await listReviewQueue(USER_ID, { page: -5, limit: 20 });
    expect(reviewQueueFind.mock.results[0].value.chain.skip).toEqual([0]);
  });

  test("treats an unparseable page as the first page", async () => {
    await listReviewQueue(USER_ID, { page: "not-a-number", limit: 20 });
    expect(reviewQueueFind.mock.results[0].value.chain.skip).toEqual([0]);
  });

  test("clamps the page size to a hundred", async () => {
    const result = await listReviewQueue(USER_ID, { page: 1, limit: 999 });
    expect(reviewQueueFind.mock.results[0].value.chain.limit).toEqual([100]);
    expect(result.pagination.limit).toBe(100);
  });

  test("falls back to twenty when the page size is zero", async () => {
    const result = await listReviewQueue(USER_ID, { page: 1, limit: 0 });
    expect(result.pagination.limit).toBe(20);
  });

  test("reports the total and the number of pages", async () => {
    withQueue([openItem("a", 90, NOW)], 45);
    const result = await listReviewQueue(USER_ID, { page: 2, limit: 20 });
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 45, pages: 3 });
  });

  test("reports one page when there is nothing queued", async () => {
    withQueue([], 0);
    const result = await listReviewQueue(USER_ID);
    expect(result.items).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
  });

  test("returns an empty page beyond the last one", async () => {
    withQueue([], 45);
    const result = await listReviewQueue(USER_ID, { page: 9, limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.pagination.page).toBe(9);
    expect(result.pagination.pages).toBe(3);
  });

  test("is what the rebuild returns once it has finished upserting", async () => {
    withProgress([]);
    withFlashcards([]);
    const result = await rebuildReviewQueueForUser(USER_ID);
    expect(result).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  });
});

// ─── completeReviewQueueItem ──────────────────────────────────────────────────

describe("completeReviewQueueItem", () => {
  const openItem = () => ({
    _id: "rq-1",
    user: USER_ID,
    subject: "Operating Systems",
    topic: "Deadlock",
    itemType: "low_confidence_topic",
    priority: 62,
    status: "open",
    metadata: { confidence: 40, recommendedDifficulty: "Easy" },
  });

  test("updates the learner's own open item", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(openItem());
    await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" });
    expect(reviewQueueFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "rq-1", user: USER_ID, status: "open" },
      { status: "completed", completedAt: NOW },
      { new: true },
    );
  });

  test("returns the updated item", async () => {
    const item = { ...openItem(), status: "completed" };
    reviewQueueFindOneAndUpdate.mockResolvedValue(item);
    const result = await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" });
    expect(result).toBe(item);
  });

  test("records a revision_completed learning event for the learner", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(openItem());
    await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" });
    expect(learningEventCreate).toHaveBeenCalledTimes(1);
    expect(learningEventCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      user: USER_ID,
      eventType: "revision_completed",
      result: "completed",
      confidence: 40,
      difficulty: "Easy",
    }));
  });

  test("links the learning event back to the queue item", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(openItem());
    await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" });
    expect(learningEventCreate.mock.calls[0][0].metadata).toEqual({
      reviewQueueId: "rq-1", itemType: "low_confidence_topic", priority: 62,
    });
  });

  test("defaults the event confidence and difficulty when the item has no metadata", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue({ _id: "rq-2", itemType: "due_flashcard", priority: 55 });
    await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-2" });
    expect(learningEventCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      confidence: 0, difficulty: "",
    }));
  });

  test("throws a 404 when the item is missing or already completed", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(null);
    await expect(
      completeReviewQueueItem({ userId: USER_ID, itemId: "rq-missing" }),
    ).rejects.toThrow("Review queue item not found");
  });

  test("does not record a learning event when nothing was completed", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(null);
    await completeReviewQueueItem({ userId: USER_ID, itemId: "rq-missing" }).catch(() => {});
    expect(learningEventCreate).not.toHaveBeenCalled();
  });
});

// ─── snoozeReviewQueueItem ────────────────────────────────────────────────────

describe("snoozeReviewQueueItem", () => {
  test("pushes the due date forward and drops the priority", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue({ _id: "rq-1" });
    await snoozeReviewQueueItem({ userId: USER_ID, itemId: "rq-1", hours: 48 });
    const [filter, update, options] = reviewQueueFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: "rq-1", user: USER_ID, status: "open" });
    expect(update).toEqual({ dueAt: new Date(NOW.getTime() + 48 * HOUR), priority: 40 });
    expect(options).toEqual({ new: true });
  });

  test("defaults to a twenty-four hour snooze", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue({ _id: "rq-1" });
    await snoozeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" });
    expect(reviewQueueFindOneAndUpdate.mock.calls[0][1].dueAt).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  test("supports a one hour snooze", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue({ _id: "rq-1" });
    await snoozeReviewQueueItem({ userId: USER_ID, itemId: "rq-1", hours: 1 });
    expect(reviewQueueFindOneAndUpdate.mock.calls[0][1].dueAt).toEqual(new Date(NOW.getTime() + HOUR));
  });

  test("returns the updated item", async () => {
    const item = { _id: "rq-1", priority: 40, dueAt: new Date(NOW.getTime() + 24 * HOUR) };
    reviewQueueFindOneAndUpdate.mockResolvedValue(item);
    expect(await snoozeReviewQueueItem({ userId: USER_ID, itemId: "rq-1" })).toBe(item);
  });

  test("throws a 404 when the item is missing or already handled", async () => {
    reviewQueueFindOneAndUpdate.mockResolvedValue(null);
    await expect(
      snoozeReviewQueueItem({ userId: USER_ID, itemId: "rq-missing" }),
    ).rejects.toThrow("Review queue item not found");
  });
});
