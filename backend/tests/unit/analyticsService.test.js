/**
 * Unit Tests — analyticsService (dashboard analytics)
 *
 * These tests import and execute the shipped production implementation of
 * `getDashboardAnalytics` from `backend/services/analyticsService.js`.
 *
 * Only the Mongoose model boundaries are mocked. The retention decay, the
 * readiness weighting, the weak-topic filter and ordering, the accuracy-trend
 * bucketing, the review-due count, the recommended-next-action branching and the
 * highlights block are all production code executed here.
 *
 * Every expected value below is a concrete literal read off the shipped
 * implementation. No analytics formula is reimplemented in this file, so a
 * regression in `analyticsService.js` fails these tests. The local helpers here
 * only build fixture documents and configure the model mocks.
 */

import { jest } from "@jest/globals";

// ─── Mongoose boundary mocks ──────────────────────────────────────────────────
// `analyticsService.js` issues six queries in one `Promise.all` across five
// model modules. Each model is replaced with a query stub that records how it
// was called and resolves to a fixture.

const userProgressFindOne = jest.fn();
const quizAttemptFind = jest.fn();
const quizFind = jest.fn();
const studyMaterialCount = jest.fn();
const flashcardCountDocuments = jest.fn();
const flashcardFind = jest.fn();

/** A chainable, awaitable query stub that records the chain methods used. */
const queryOf = (data) => {
  const chain = { populate: null, sort: null, select: null, limit: null };
  const query = {
    chain,
    populate: (...args) => { chain.populate = args; return query; },
    select: (...args) => { chain.select = args; return query; },
    sort: (...args) => { chain.sort = args; return query; },
    limit: (...args) => { chain.limit = args; return query; },
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return query;
};

jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: userProgressFindOne },
}));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({
  default: { find: quizAttemptFind },
}));
jest.unstable_mockModule("../../models/Quiz.js", () => ({
  default: { find: quizFind },
}));
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: { countDocuments: studyMaterialCount },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({
  default: { countDocuments: flashcardCountDocuments, find: flashcardFind },
}));

const { getDashboardAnalytics } = await import("../../services/analyticsService.js");

// ─── Deterministic clock ──────────────────────────────────────────────────────
// The production function derives `now`, the 30-day window and every decay
// calculation from the system clock, so it is frozen for the whole suite.

const NOW = new Date("2026-03-20T15:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const USER_ID = "user-analytics-1";

const daysBeforeNow = (days) => new Date(NOW.getTime() - days * MS_PER_DAY);

/** Local noon `days` before now: same calendar day as the production bucket. */
const localNoonDaysAgo = (days) => {
  const date = new Date(NOW);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────
// These build documents and wire up model stubs. They deliberately contain no
// analytics arithmetic.

/**
 * A topic record with the full field set the `UserProgress` schema defines, so
 * that the service sees realistic documents. Dates are built at call time, under
 * the fake timers installed in `beforeEach`.
 */
const topic = (name, overrides = {}) => ({
  topic: name,
  subject: "Operating Systems",
  attempted: 1,
  mastery: 50,
  confidence: 50,
  weaknessScore: 0,
  reviewCount: 0,
  lastWrongAt: null,
  lastPracticedAt: daysBeforeNow(1),
  recommendedDifficulty: "Easy",
  ...overrides,
});

const TOPICS = () => [
  topic("Process Control Block", {
    subject: "Operating Systems", attempted: 4, mastery: 82, confidence: 90,
    weaknessScore: 12, reviewCount: 3, lastPracticedAt: daysBeforeNow(2), recommendedDifficulty: "Hard",
  }),
  topic("Scheduling", {
    attempted: 3, mastery: 71, confidence: 75, weaknessScore: 24, reviewCount: 2,
    lastWrongAt: daysBeforeNow(6), lastPracticedAt: daysBeforeNow(5), recommendedDifficulty: "Medium",
  }),
  topic("Deadlock", {
    attempted: 2, mastery: 48, confidence: 40, weaknessScore: 62, reviewCount: 1,
    lastWrongAt: daysBeforeNow(1), lastPracticedAt: daysBeforeNow(1),
  }),
  topic("Paging", {
    subject: "Computer Systems", attempted: 1, mastery: 35, confidence: 30, weaknessScore: 74,
    lastWrongAt: daysBeforeNow(9), lastPracticedAt: daysBeforeNow(9),
  }),
];

const TOTALS = { quizzesTaken: 6, questionsAnswered: 40, correctAnswers: 26, averageAccuracy: 60 };

const progressWith = (topics, totals = TOTALS) => ({ _id: "progress-1", user: USER_ID, totals, topics });

const attempt = (createdAt, accuracy, over = {}) => ({
  _id: `attempt-${createdAt.getTime()}-${accuracy}`,
  user: USER_ID, quiz: null, score: accuracy, total: 100,
  accuracy, difficulty: "Medium", durationSeconds: 60,
  createdAt, answers: [], ...over,
});

/** Five attempts on three days, ordered ascending as the production query does. */
const ATTEMPTS = () => [
  attempt(localNoonDaysAgo(28), 80),
  attempt(new Date(localNoonDaysAgo(28).getTime() + 60 * 60 * 1000), 60),
  attempt(localNoonDaysAgo(10), 45),
  attempt(localNoonDaysAgo(0), 100),
  attempt(new Date(localNoonDaysAgo(0).getTime() + 60 * 60 * 1000), 90),
];

const QUIZZES = [
  { _id: "quiz-1", title: "OS Fundamentals", difficulty: "Medium", questionCount: 5, subject: "Operating Systems" },
  { _id: "quiz-2", title: "Memory Basics", difficulty: "Easy", questionCount: 5, subject: "Computer Systems" },
];

const dueSet = (title, reviews) => ({
  _id: `set-${title}`, title,
  cards: reviews.map((review, i) => ({ _id: `card-${title}-${i}`, review })),
});

/**
 * Wires every model stub. Defaults describe a learner with four topics, five
 * attempts across three days, two quizzes, two materials, three decks and no
 * flashcard due for review.
 */
const install = ({
  progress = progressWith(TOPICS()),
  attempts = ATTEMPTS(),
  quizzes = QUIZZES,
  materialCount = 2,
  flashcardSetCount = 3,
  dueSets = [],
} = {}) => {
  userProgressFindOne.mockReturnValue(queryOf(progress));
  quizAttemptFind.mockReturnValue(queryOf(attempts));
  quizFind.mockReturnValue(queryOf(quizzes));
  studyMaterialCount.mockResolvedValue(materialCount);
  flashcardCountDocuments.mockResolvedValue(flashcardSetCount);
  flashcardFind.mockReturnValue(queryOf(dueSets));
};

const analytics = (overrides) => {
  install(overrides);
  return getDashboardAnalytics(USER_ID);
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Totals passthrough ───────────────────────────────────────────────────────

describe("dashboard totals", () => {
  test("reports the stored quiz counters and the two material/deck counts", async () => {
    const result = await analytics();
    expect(result.totals.quizzesTaken).toBe(6);
    expect(result.totals.questionsAnswered).toBe(40);
    expect(result.totals.averageAccuracy).toBe(60);
    expect(result.totals.materialCount).toBe(2);
    expect(result.totals.flashcardSetCount).toBe(3);
  });

  test("returns the mocked recent quizzes and the newest attempts first", async () => {
    const result = await analytics();
    expect(result.recentQuizzes).toEqual(QUIZZES);
    // production takes the last 6 attempts and reverses them
    expect(result.recentAttempts.map((a) => a.accuracy)).toEqual([90, 100, 45, 60, 80]);
  });

  test("keeps only the most recent six attempts in recentAttempts", async () => {
    const many = Array.from({ length: 8 }, (_, i) => attempt(localNoonDaysAgo(i), 50 + i));
    const result = await analytics({ attempts: many });
    expect(result.recentAttempts).toHaveLength(6);
    expect(result.recentAttempts[0].accuracy).toBe(57);
    expect(result.recentAttempts[5].accuracy).toBe(52);
  });
});

// ─── Average mastery and confidence ───────────────────────────────────────────

describe("average mastery and confidence", () => {
  test("averages mastery and confidence across every topic", async () => {
    const result = await analytics();
    // (82 + 71 + 48 + 35) / 4 = 59
    expect(result.totals.averageMastery).toBe(59);
    // (90 + 75 + 40 + 30) / 4 = 58.75 -> 59
    expect(result.totals.averageConfidence).toBe(59);
  });

  test("rounds the averages to whole numbers", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("A", { mastery: 50, confidence: 50, lastPracticedAt: daysBeforeNow(1) }),
        topic("B", { mastery: 51, confidence: 52, lastPracticedAt: daysBeforeNow(1) }),
      ]),
    });
    expect(result.totals.averageMastery).toBe(51);  // 50.5 -> 51
    expect(result.totals.averageConfidence).toBe(51); // 51.0 -> 51
  });

  test("reports zero averages when the learner has no progress document", async () => {
    const result = await analytics({ progress: null });
    expect(result.totals.averageMastery).toBe(0);
    expect(result.totals.averageConfidence).toBe(0);
  });

  test("includes topics that have never been attempted in the averages", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("A", { attempted: 2, mastery: 60, confidence: 60, weaknessScore: 30, lastPracticedAt: daysBeforeNow(1) }),
        topic("B", { attempted: 0, mastery: 40, confidence: 40, weaknessScore: 30, lastPracticedAt: null }),
      ]),
    });
    // (60 + 40) / 2 = 50
    expect(result.totals.averageMastery).toBe(50);
    expect(result.totals.averageConfidence).toBe(50);
  });
});

// ─── Retention / decay ────────────────────────────────────────────────────────
// Production (`analyticsService.js:111-120`) subtracts 2.2 per day since the
// last practice, floored at zero, and averages across topics. A topic with no
// lastPracticedAt is treated as 30 days.

describe("retention and decay", () => {
  test("averages the per-topic decayed confidence over the topic list", async () => {
    const result = await analytics();
    // 90 - 2*2.2 = 85.6, 75 - 5*2.2 = 64, 40 - 1*2.2 = 37.8, 30 - 9*2.2 = 10.2
    // (85.6 + 64 + 37.8 + 10.2) / 4 = 49.4 -> 49
    expect(result.totals.retentionScore).toBe(49);
    expect(result.highlights.retentionScore).toBe(49);
  });

  test("decays a single recently practiced topic by 2.2 per elapsed day", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Recent", { mastery: 70, confidence: 100, weaknessScore: 10, lastPracticedAt: daysBeforeNow(3) }),
      ]),
    });
    // 100 - 3 * 2.2 = 93.4 -> 93
    expect(result.totals.retentionScore).toBe(93);
  });

  test("decays in proportion to the elapsed period", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Older", { mastery: 70, confidence: 80, weaknessScore: 10, lastPracticedAt: daysBeforeNow(25) }),
      ]),
    });
    // 80 - 25 * 2.2 = 25
    expect(result.totals.retentionScore).toBe(25);
  });

  test("treats a never-practiced topic as 30 days old", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Never", { mastery: 70, confidence: 80, weaknessScore: 10, lastPracticedAt: null }),
      ]),
    });
    // 80 - 30 * 2.2 = 14
    expect(result.totals.retentionScore).toBe(14);
  });

  test("does not report negative retention once decay exceeds confidence", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Faded", { mastery: 70, confidence: 50, weaknessScore: 10, lastPracticedAt: daysBeforeNow(40) }),
      ]),
    });
    // 50 - 40 * 2.2 is negative, so the per-topic value floors at 0
    expect(result.totals.retentionScore).toBe(0);
  });

  test("reports zero retention when the learner has no progress document", async () => {
    const result = await analytics({ progress: null });
    expect(result.totals.retentionScore).toBe(0);
  });
});

// ─── Readiness ────────────────────────────────────────────────────────────────
// Production (`analyticsService.js:121`):
//   round(averageMastery * 0.55 + averageConfidence * 0.25 + retentionScore * 0.2)

describe("estimated readiness", () => {
  test("combines mastery, confidence and retention for the main fixture", async () => {
    const result = await analytics();
    // 59 * 0.55 + 59 * 0.25 + 49 * 0.2 = 32.45 + 14.75 + 9.8 = 57
    expect(result.totals.estimatedReadiness).toBe(57);
    expect(result.highlights.estimatedReadiness).toBe(57);
  });

  test("pins the 0.55 mastery weight when confidence and retention are both zero", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Mastered", { mastery: 100, confidence: 0, weaknessScore: 0, lastPracticedAt: daysBeforeNow(40) }),
      ]),
    });
    // retention floors at 0 because confidence is 0, so only mastery contributes
    expect(result.totals.averageMastery).toBe(100);
    expect(result.totals.averageConfidence).toBe(0);
    expect(result.totals.retentionScore).toBe(0);
    // 100 * 0.55 = 55, which a 0.40 or 0.60 mastery weight would not produce
    expect(result.totals.estimatedReadiness).toBe(55);
  });

  test("pins the 0.25 confidence and 0.20 retention split", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Decayed", { mastery: 0, confidence: 100, weaknessScore: 0, lastPracticedAt: daysBeforeNow(10) }),
      ]),
    });
    // retention 100 - 10 * 2.2 = 78
    expect(result.totals.retentionScore).toBe(78);
    // 0 + 100 * 0.25 + 78 * 0.2 = 25 + 15.6 = 40.6 -> 41
    // A 0.30/0.15 split would give 42 and a 0.25/0.25 split would give 45.
    expect(result.totals.estimatedReadiness).toBe(41);
  });

  test("reports zero readiness for a learner with no progress", async () => {
    const result = await analytics({ progress: null });
    expect(result.totals.estimatedReadiness).toBe(0);
  });
});

// ─── Weak topics ──────────────────────────────────────────────────────────────
// Production (`analyticsService.js:65-78`): attempted >= 1 AND
// (weaknessScore > 35 OR mastery < 65), sorted by weaknessScore descending,
// capped at 6.

describe("weak topics", () => {
  test("returns only topics that were attempted and are weak or shaky", async () => {
    const result = await analytics();
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["Paging", "Deadlock"]);
  });

  test("excludes a topic with high mastery and low weakness", async () => {
    const result = await analytics();
    expect(result.weakTopics.map((t) => t.topic)).not.toContain("Process Control Block");
  });

  test("includes a topic that qualifies on weakness alone even when mastery is high", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("HighMasteryWeakGap", { mastery: 95, confidence: 95, weaknessScore: 50, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["HighMasteryWeakGap"]);
  });

  test("includes a topic that qualifies on low mastery alone even when weakness is low", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("LowMastery", { mastery: 40, confidence: 40, weaknessScore: 10 }),
      ]),
    });
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["LowMastery"]);
  });

  test("excludes a topic that has never been attempted, however weak it looks", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Untouched", { attempted: 0, mastery: 10, confidence: 5, weaknessScore: 95, lastPracticedAt: null }),
        topic("Real", { attempted: 2, mastery: 80, confidence: 80, weaknessScore: 15, reviewCount: 1, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.weakTopics).toEqual([]);
  });

  test("treats weakness of exactly 35 as not weak", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Boundary", { mastery: 70, confidence: 70, weaknessScore: 35, recommendedDifficulty: "Medium" }),
      ]),
    });
    expect(result.weakTopics).toEqual([]);
  });

  test("includes a weakness score just above the 35 threshold", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("JustOver", { mastery: 80, confidence: 80, weaknessScore: 36, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["JustOver"]);
  });

  test("excludes a weakness score just below the 35 threshold", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("JustUnder", { mastery: 80, confidence: 80, weaknessScore: 34, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.weakTopics).toEqual([]);
  });

  test("treats mastery of exactly 65 as not weak", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Boundary", { mastery: 65, confidence: 70, weaknessScore: 10, recommendedDifficulty: "Medium" }),
      ]),
    });
    expect(result.weakTopics).toEqual([]);
  });

  test("includes a mastery just below the 65 threshold", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("JustUnder", { mastery: 64, confidence: 70, weaknessScore: 10, recommendedDifficulty: "Medium" }),
      ]),
    });
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["JustUnder"]);
  });

  test("excludes a mastery just above the 65 threshold", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("JustOver", { mastery: 66, confidence: 70, weaknessScore: 10, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.weakTopics).toEqual([]);
  });

  test("orders weak topics by descending weakness score", async () => {
    const weak = ["Alpha", "Bravo", "Charlie"].map((name, i) =>
      topic(name, { mastery: 30, confidence: 30, weaknessScore: 40 + i * 5 }));
    const result = await analytics({ progress: progressWith(weak) });
    expect(result.weakTopics.map((t) => t.weaknessScore)).toEqual([50, 45, 40]);
  });

  test("caps the weak topic list at six entries", async () => {
    const many = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"]
      .map((name, i) => topic(name, { mastery: 40, confidence: 40, weaknessScore: 90 - i * 6 }));
    const result = await analytics({ progress: progressWith(many) });
    // nine topics qualify; production keeps the six highest weakness scores
    expect(result.weakTopics.map((t) => t.topic)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);
  });

  test("projects mastery onto the weak topic 'accuracy' field", async () => {
    const result = await analytics();
    expect(result.weakTopics[0]).toEqual({
      topic: "Paging",
      subject: "Computer Systems",
      accuracy: 35,
      confidence: 30,
      weaknessScore: 74,
      attempted: 1,
      reviewCount: 0,
      recommendedDifficulty: "Easy",
    });
  });

  test("defaults a missing reviewCount to zero in the projection", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("NoCount", { mastery: 40, confidence: 40, weaknessScore: 40 }),
      ]),
    });
    expect(result.weakTopics[0].reviewCount).toBe(0);
  });

  test("builds one recommendation per weak topic", async () => {
    const result = await analytics();
    expect(result.recommendations).toEqual([
      { type: "weak-topic", topic: "Paging", message: "Review Paging with easy practice and flashcards.", difficulty: "Easy" },
      { type: "weak-topic", topic: "Deadlock", message: "Review Deadlock with easy practice and flashcards.", difficulty: "Easy" },
    ]);
  });
});

// ─── Topic mastery chart ──────────────────────────────────────────────────────
// Production (`analyticsService.js:80-90`): ordered by attempts descending,
// capped at 8, with long topic names truncated.

describe("topic mastery chart", () => {
  test("orders topics by descending attempt count", async () => {
    const result = await analytics();
    expect(result.topicMastery.map((t) => t.fullTopic)).toEqual([
      "Process Control Block", "Scheduling", "Deadlock", "Paging",
    ]);
  });

  test("truncates a topic label longer than sixteen characters", async () => {
    const result = await analytics();
    expect(result.topicMastery[0].topic).toBe("Process Control...");
    expect(result.topicMastery[0].fullTopic).toBe("Process Control Block");
  });

  test("leaves a short topic label untouched", async () => {
    const result = await analytics();
    expect(result.topicMastery[1].topic).toBe("Scheduling");
  });

  test("caps the chart at eight topics", async () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      topic(`Topic ${i}`, { attempted: 20 - i, mastery: 50 + i, confidence: 50, weaknessScore: 10 }));
    const result = await analytics({ progress: progressWith(many) });
    expect(result.topicMastery).toHaveLength(8);
    expect(result.topicMastery.map((t) => t.fullTopic)).toEqual([
      "Topic 0", "Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5", "Topic 6", "Topic 7",
    ]);
  });
});

// ─── Accuracy trend ───────────────────────────────────────────────────────────
// Production (`analyticsService.js:42-62`) builds 30 day buckets, oldest first,
// and averages the accuracy of the attempts landing in each.

describe("accuracy trend", () => {
  test("produces exactly thirty day buckets", async () => {
    const result = await analytics();
    expect(result.accuracyTrend).toHaveLength(30);
  });

  test("labels every bucket as a short month-day string", async () => {
    const result = await analytics();
    result.accuracyTrend.forEach((bucket) => expect(bucket.day).toMatch(/^\d{2}-\d{2}$/));
  });

  test("orders buckets oldest first", async () => {
    const result = await analytics();
    const labels = result.accuracyTrend.map((b) => b.day);
    expect(labels).toEqual([...labels].sort());
    expect(new Set(labels).size).toBe(30);
  });

  test("averages the accuracies of attempts landing on the same day", async () => {
    const result = await analytics();
    // bucket 1 is 28 days ago and holds accuracies 80 and 60
    expect(result.accuracyTrend[1].score).toBe(70);
    // bucket 19 is 10 days ago and holds a single accuracy of 45
    expect(result.accuracyTrend[19].score).toBe(45);
    // bucket 29 is today and holds accuracies 100 and 90
    expect(result.accuracyTrend[29].score).toBe(95);
  });

  test("leaves days without an attempt as a null score", async () => {
    const result = await analytics();
    const withScores = result.accuracyTrend
      .map((bucket, index) => (bucket.score === null ? null : index))
      .filter((index) => index !== null);
    expect(withScores).toEqual([1, 19, 29]);
  });

  test("reports a fully null trend for a learner with no attempts", async () => {
    const result = await analytics({ attempts: [] });
    expect(result.accuracyTrend).toHaveLength(30);
    expect(result.accuracyTrend.every((bucket) => bucket.score === null)).toBe(true);
  });

  test("ignores an attempt whose day falls outside the thirty-day window", async () => {
    const result = await analytics({
      attempts: [attempt(localNoonDaysAgo(45), 100)],
    });
    expect(result.accuracyTrend.every((bucket) => bucket.score === null)).toBe(true);
  });
});

// ─── Review due today ─────────────────────────────────────────────────────────
// Production (`analyticsService.js:99-104`) re-checks each returned card against
// `now`, reading `nextReviewAt` and falling back to `dueAt`.

describe("reviewDueToday", () => {
  test("counts nothing when no deck is returned", async () => {
    const result = await analytics();
    expect(result.totals.reviewDueToday).toBe(0);
  });

  test("counts a card whose next review has already passed", async () => {
    const result = await analytics({
      dueSets: [dueSet("Overdue", [{ nextReviewAt: daysBeforeNow(3) }])],
    });
    expect(result.totals.reviewDueToday).toBe(1);
  });

  test("excludes a card scheduled for the future", async () => {
    const result = await analytics({
      dueSets: [dueSet("Future", [{ nextReviewAt: localNoonDaysAgo(-1) }])],
    });
    expect(result.totals.reviewDueToday).toBe(0);
  });

  test("falls back to dueAt when nextReviewAt is missing", async () => {
    const result = await analytics({
      dueSets: [dueSet("AliasOnly", [{ nextReviewAt: null, dueAt: daysBeforeNow(2) }])],
    });
    expect(result.totals.reviewDueToday).toBe(1);
  });

  test("counts only the due cards inside a mixed deck", async () => {
    const result = await analytics({
      dueSets: [dueSet("Mixed", [
        { nextReviewAt: daysBeforeNow(4) },
        { nextReviewAt: null, dueAt: daysBeforeNow(1) },
        { nextReviewAt: localNoonDaysAgo(-2) },
      ])],
    });
    expect(result.totals.reviewDueToday).toBe(2);
  });

  test("sums across decks", async () => {
    const result = await analytics({
      dueSets: [
        dueSet("One", [{ nextReviewAt: daysBeforeNow(1) }]),
        dueSet("Two", [{ nextReviewAt: daysBeforeNow(1) }, { nextReviewAt: daysBeforeNow(1) }]),
      ],
    });
    expect(result.totals.reviewDueToday).toBe(3);
  });

  test("ignores a card with no scheduling date at all", async () => {
    const result = await analytics({ dueSets: [dueSet("Undated", [{}])] });
    expect(result.totals.reviewDueToday).toBe(0);
  });
});

// ─── Recommended next action ──────────────────────────────────────────────────
// Production (`analyticsService.js:122-140`): three branches, in order.

describe("recommended next action", () => {
  test("asks the learner to clear reviews when a flashcard is due", async () => {
    const result = await analytics({ dueSets: [dueSet("Due", [{ nextReviewAt: daysBeforeNow(1) }])] });
    expect(result.recommendedNextAction).toEqual({
      type: "review-due",
      message: "1 flashcard due today. Clear review queue before new practice.",
      href: "/flashcards",
    });
  });

  test("uses the plural noun for more than one due flashcard", async () => {
    const result = await analytics({
      dueSets: [dueSet("Due", [{ nextReviewAt: daysBeforeNow(1) }, { nextReviewAt: daysBeforeNow(2) }])],
    });
    expect(result.recommendedNextAction.message).toBe("2 flashcards due today. Clear review queue before new practice.");
  });

  test("suggests targeted practice on the weakest topic when nothing is due", async () => {
    const result = await analytics();
    expect(result.recommendedNextAction).toEqual({
      type: "adaptive-quiz",
      topic: "Paging",
      difficulty: "Easy",
      message: "Generate easy practice around Paging.",
      href: "/assessments/create",
    });
  });

  test("asks for an upload when the learner has no attempted topic at all", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Never", { attempted: 0, mastery: 0, confidence: 0, weaknessScore: 0, lastPracticedAt: null }),
      ]),
    });
    expect(result.recommendedNextAction).toEqual({
      type: "upload-material",
      message: "Upload a study material to start building adaptive recommendations.",
      href: "/assessments/create",
    });
  });

  test("asks for an upload when the learner has no progress at all", async () => {
    const result = await analytics({ progress: null });
    expect(result.recommendedNextAction.type).toBe("upload-material");
  });
});

// ─── Highlights ───────────────────────────────────────────────────────────────
// Production (`analyticsService.js:166-183`).

describe("highlights", () => {
  test("reports the best and weakest attempted topics", async () => {
    const result = await analytics();
    expect(result.highlights.bestTopic).toEqual({ topic: "Process Control Block", accuracy: 82 });
    expect(result.highlights.weakestTopic).toEqual({ topic: "Paging", mastery: 35, weaknessScore: 74 });
  });

  test("ignores unattempted topics when picking best and weakest", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("UnattemptedStar", { attempted: 0, mastery: 99, confidence: 99, weaknessScore: 99, lastPracticedAt: null }),
        topic("Actual", { mastery: 50, confidence: 50, weaknessScore: 50, recommendedDifficulty: "Medium" }),
      ]),
    });
    expect(result.highlights.bestTopic.topic).toBe("Actual");
    expect(result.highlights.weakestTopic.topic).toBe("Actual");
  });

  test("reports a null best and weakest topic when nothing has been attempted", async () => {
    const result = await analytics({ progress: null });
    expect(result.highlights.bestTopic).toBeNull();
    expect(result.highlights.weakestTopic).toBeNull();
  });

  test("compares recent attempt accuracy against the stored average", async () => {
    const result = await analytics();
    // mean of the last three attempts (45, 100, 90) = 78, minus stored average 60
    expect(result.highlights.masteryTrend).toBe(18);
  });

  test("reports a zero mastery trend for a learner with fewer than two attempts", async () => {
    const result = await analytics({ attempts: [attempt(localNoonDaysAgo(1), 95)] });
    expect(result.highlights.masteryTrend).toBe(0);
  });

  test("averages the available attempts when exactly two exist", async () => {
    const result = await analytics({
      // stored average 50, so the computed trend is non-zero and a change to the
      // two-attempt cutoff would be visible
      progress: progressWith(TOPICS(), { ...TOTALS, averageAccuracy: 50 }),
      attempts: [attempt(localNoonDaysAgo(2), 80), attempt(localNoonDaysAgo(1), 40)],
    });
    // mean of 80 and 40 = 60, minus stored average 50
    expect(result.highlights.masteryTrend).toBe(10);
  });

  test("counts the weak topics that need attention", async () => {
    const result = await analytics();
    expect(result.highlights.needsAttention).toBe(2);
    expect(result.highlights.needsAttention).toBe(result.weakTopics.length);
  });

  test("reports zero topics needing attention for a strong learner", async () => {
    const result = await analytics({
      progress: progressWith([
        topic("Strong", { attempted: 5, mastery: 95, confidence: 95, weaknessScore: 5, recommendedDifficulty: "Hard" }),
      ]),
    });
    expect(result.highlights.needsAttention).toBe(0);
  });
});

// ─── Empty learner ────────────────────────────────────────────────────────────

describe("a learner with no data at all", () => {
  test("returns a fully populated zeroed dashboard rather than throwing", async () => {
    const result = await analytics({ progress: null, attempts: [], quizzes: [], materialCount: 0, flashcardSetCount: 0, dueSets: [] });

    expect(result.totals).toEqual({
      quizzesTaken: 0,
      questionsAnswered: 0,
      averageAccuracy: 0,
      averageMastery: 0,
      averageConfidence: 0,
      retentionScore: 0,
      estimatedReadiness: 0,
      reviewDueToday: 0,
      materialCount: 0,
      flashcardSetCount: 0,
    });
    expect(result.recentQuizzes).toEqual([]);
    expect(result.recentAttempts).toEqual([]);
    expect(result.weakTopics).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.topicMastery).toEqual([]);
    expect(result.accuracyTrend).toHaveLength(30);
    expect(result.accuracyTrend.every((bucket) => bucket.score === null)).toBe(true);
    expect(result.recommendedNextAction.type).toBe("upload-material");
    expect(result.highlights).toEqual({
      masteryTrend: 0,
      bestTopic: null,
      weakestTopic: null,
      needsAttention: 0,
      retentionScore: 0,
      estimatedReadiness: 0,
    });
  });
});

// ─── Query boundaries ─────────────────────────────────────────────────────────
// These lock in the learner scoping and the query shapes the production service
// issues, so an accidental removal of either is caught here.

describe("database query boundaries", () => {
  test("scopes every read to the requested learner", async () => {
    await analytics();
    expect(userProgressFindOne).toHaveBeenCalledTimes(1);
    expect(userProgressFindOne.mock.calls[0][0]).toEqual({ user: USER_ID });

    expect(quizAttemptFind).toHaveBeenCalledTimes(1);
    expect(quizAttemptFind.mock.calls[0][0]).toEqual(expect.objectContaining({ user: USER_ID }));

    expect(quizFind).toHaveBeenCalledTimes(1);
    expect(quizFind.mock.calls[0][0]).toEqual({ user: USER_ID });

    expect(studyMaterialCount).toHaveBeenCalledTimes(1);
    expect(studyMaterialCount).toHaveBeenCalledWith({ user: USER_ID });

    expect(flashcardCountDocuments).toHaveBeenCalledTimes(1);
    expect(flashcardCountDocuments).toHaveBeenCalledWith({ user: USER_ID });

    expect(flashcardFind).toHaveBeenCalledTimes(1);
    expect(flashcardFind.mock.calls[0][0]).toEqual(expect.objectContaining({ user: USER_ID }));
  });

  test("restricts the attempt query to a 29-day window expressed as a Date", async () => {
    await analytics();
    const filter = quizAttemptFind.mock.calls[0][0];
    expect(filter.createdAt).toBeDefined();
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$gte.getTime()).toBe(NOW.getTime() - 29 * MS_PER_DAY);
  });

  test("selects the due cards through the two production scheduling fields", async () => {
    await analytics();
    const filter = flashcardFind.mock.calls[0][0];
    expect(filter.$or).toHaveLength(2);
    expect(Object.keys(filter.$or[0])).toEqual(["cards.review.nextReviewAt"]);
    expect(Object.keys(filter.$or[1])).toEqual(["cards.review.dueAt"]);
    filter.$or.forEach((clause) => {
      const [condition] = Object.values(clause);
      expect(condition.$lte).toBeInstanceOf(Date);
      expect(condition.$lte.getTime()).toBe(NOW.getTime());
    });
  });

  test("populates the quiz summary on attempts and sorts them ascending", async () => {
    await analytics();
    const query = quizAttemptFind.mock.results[0].value;
    expect(query.chain.populate).toEqual(["quiz", "title difficulty questionCount subject"]);
    expect(query.chain.sort).toEqual([{ createdAt: 1 }]);
  });

  test("limits the recent quiz query to the five most recent quizzes", async () => {
    await analytics();
    const query = quizFind.mock.results[0].value;
    expect(query.chain.select).toEqual(["title difficulty questionCount sourceFileName subject createdAt studyMaterial"]);
    expect(query.chain.sort).toEqual([{ createdAt: -1 }]);
    expect(query.chain.limit).toEqual([5]);
  });

  test("selects only the review state and title when fetching due decks", async () => {
    await analytics();
    const query = flashcardFind.mock.results[0].value;
    expect(query.chain.select).toEqual(["cards.review title"]);
  });

  test("issues a different learner scope for a different user", async () => {
    install();
    await getDashboardAnalytics("user-analytics-2");
    expect(userProgressFindOne).toHaveBeenCalledWith({ user: "user-analytics-2" });
    expect(quizFind).toHaveBeenCalledWith({ user: "user-analytics-2" });
  });
});
