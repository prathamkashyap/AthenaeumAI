/**
 * Contract Tests — attempt processing (`SYNC_ATTEMPT` path)
 *
 * This suite is production-bound: it imports the real
 * `updateUserProgressFromAttempt`, `updateStudyStreak`,
 * `recordAttemptEvents` and the worker's own `processBackgroundJob` handler. Only
 * the Mongoose model layer and the transaction helper are replaced — by a
 * stateful in-memory store and a transaction double — so that persisted state
 * genuinely accumulates across calls and "process once" can be compared against
 * "process twice".
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 *
 *   Processing one logical quiz attempt twice must produce the same learner
 *   state and the same learning-event state as processing it once.
 *
 * The second delivery must not increment quiz, question or correct-answer
 * counters; must not re-apply per-topic mastery, confidence or weakness; must
 * not extend the study streak; and must not insert a second logically identical
 * learning event.
 *
 * ── How the guarantee is produced ────────────────────────────────────────────
 *
 * The worker claims the attempt with a conditional update inside a transaction
 * and only applies the learner effects if that claim was won, so the durable
 * marker and the effects commit together or not at all. These tests exist to
 * catch any regression of that boundary, and they are written as ordinary
 * assertions: if idempotency breaks, the suite fails.
 *
 * The transaction double is deliberately not a no-op. It rolls back writes that
 * carried the session while leaving untagged writes in place, which is what makes
 * "did every effect actually join the transaction?" a testable question rather
 * than an assumption.
 *
 * The single-delivery tests pin concrete values for one application. Those are
 * the intended behaviour of the progress calculation and must survive any
 * idempotency change.
 *
 * ── Idempotency key ──────────────────────────────────────────────────────────
 *
 * `QuizAttempt._id` is the established identity of one logical attempt. It is
 * already the key used by the BullMQ `deduplicationId` at enqueue time
 * (`quizController.js:290`, `sync-attempt:<attemptId>`) and it is already written
 * into the metadata of every `quiz_attempt` learning event
 * (`learningEventService.js:39`). The contract below is stated in terms of that
 * identity: a repeat delivery of the same attempt id is a duplicate, and a
 * different attempt id is a different attempt.
 */

import { jest } from "@jest/globals";

// ─── Stateful in-memory persistence ───────────────────────────────────────────
// A persistence double, not a logic double. The service functions under test run
// in full; only document storage is simulated.

const store = {
  progress: new Map(),
  users: new Map(),
  attempts: new Map(),
  quizzes: new Map(),
  flashcardSets: [],
  events: [],
  notifications: [],
  queueItems: new Map(),
};

// ─── Transaction double ───────────────────────────────────────────────────────
// `runInTransaction` is replaced so the suite can assert the two properties the
// production design relies on, which a plain storage double cannot express:
//
//   1. Atomicity — a failure inside the transaction leaves no partial learner
//      state behind. Writes that carried the session are rolled back; writes that
//      did NOT carry it are left in place, because a write issued outside the
//      session escapes the transaction in MongoDB too. That distinction is what
//      makes "did every effect actually join the transaction?" testable.
//   2. Serialization — only one transaction runs at a time, which is what makes
//      the conditional claim a true compare-and-set: a second concurrent
//      delivery can only observe the first one's committed claim. This models
//      MongoDB's document-level write concurrency, not OS-level parallelism.
//
// The session object is passed through to the model layer exactly as Mongoose
// would, so production code is exercised through its real session-aware paths.

/** Tags a written record with the session that wrote it, or nothing if untagged. */
const markWrite = (record, session) => {
  if (record && typeof record === "object") {
    Object.defineProperty(record, "__sessionId", {
      value: session?.id ?? null, enumerable: false, configurable: true, writable: true,
    });
  }
  return record;
};

const writtenInSession = (record, sessionId) => record?.__sessionId === sessionId;

/** `structuredClone` cannot copy the plain-object `save` methods, so fields are copied individually. */
const cloneDoc = (doc) => {
  if (Array.isArray(doc)) return doc.map(cloneDoc);
  if (doc && typeof doc === "object") {
    const copy = {};
    for (const [key, value] of Object.entries(doc)) {
      copy[key] = typeof value === "function" ? value : cloneDoc(value);
    }
    return copy;
  }
  return doc;
};

const cloneStore = () => ({
  progress: [...store.progress].map(([k, v]) => [k, cloneDoc(v)]),
  users: [...store.users].map(([k, v]) => [k, cloneDoc(v)]),
  attempts: [...store.attempts].map(([k, v]) => [k, cloneDoc(v)]),
  quizzes: [...store.quizzes].map(([k, v]) => [k, cloneDoc(v)]),
  flashcardSets: cloneDoc(store.flashcardSets),
  events: cloneDoc(store.events),
  notifications: cloneDoc(store.notifications),
  queueItems: [...store.queueItems].map(([k, v]) => [k, cloneDoc(v)]),
});

/**
 * Rolls back only what the failed session wrote. Anything written without a
 * session is deliberately preserved, mirroring a write that escaped the
 * transaction and would survive `abortTransaction()` in MongoDB.
 */
const restoreStore = (snapshot, sessionId) => {
  const rollbackMap = (live, snap) => {
    const restored = new Map();
    for (const [key, value] of snap) {
      const current = live.get(key);
      restored.set(key, current === undefined || writtenInSession(current, sessionId) ? value : current);
    }
    for (const [key, value] of live) if (!snap.has(key)) restored.set(key, value);
    return restored;
  };
  const rollbackList = (live, snap) => [
    ...snap.filter((record) => !writtenInSession(record, sessionId)),
    ...live.filter((record) => !writtenInSession(record, sessionId)),
  ];

  store.progress = rollbackMap(store.progress, new Map(snapshot.progress));
  store.users = rollbackMap(store.users, new Map(snapshot.users));
  store.attempts = rollbackMap(store.attempts, new Map(snapshot.attempts));
  store.quizzes = rollbackMap(store.quizzes, new Map(snapshot.quizzes));
  store.queueItems = rollbackMap(store.queueItems, new Map(snapshot.queueItems));
  store.flashcardSets = rollbackList(store.flashcardSets, snapshot.flashcardSets);
  store.events = rollbackList(store.events, snapshot.events);
  store.notifications = rollbackList(store.notifications, snapshot.notifications);
};

let transactionChain = Promise.resolve();
let transactionCount = 0;

const runInTransaction = jest.fn(async (callback) => {
  const run = transactionChain.then(async () => {
    const session = { id: `session-${(transactionCount += 1)}`, ended: false };
    const snapshot = cloneStore();
    try {
      return await callback(session);
    } catch (error) {
      restoreStore(snapshot, session.id);
      throw error;
    } finally {
      session.ended = true;
    }
  });
  // Keep the chain alive even when a transaction rejects.
  transactionChain = run.then(() => undefined, () => undefined);
  return run;
});

const newProgress = (userId) => ({
  _id: `progress-${userId}`,
  user: userId,
  totals: { quizzesTaken: 0, questionsAnswered: 0, correctAnswers: 0, averageAccuracy: 0 },
  topics: [],
  achievements: [],
  // A save that carries no session is a write that escaped the transaction, so
  // the session is (re)tagged here rather than only at read time.
  save: async function save(options = {}) {
    markWrite(this, options.session);
  },
});

const newUser = (userId) => ({
  _id: userId,
  name: "Contract Learner",
  streak: { current: 0, longest: 0, lastStudyDate: null },
  save: async function save(options = {}) {
    markWrite(this, options.session);
  },
});

const chainOf = (data) => {
  const chain = { sort: null, skip: null, limit: null };
  const query = {
    chain,
    sort: (...a) => { chain.sort = a; return query; },
    skip: (...a) => { chain.skip = a; return query; },
    limit: (...a) => { chain.limit = a; return query; },
    select: () => query,
    lean: () => query,
    session: () => query,
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return query;
};

/** A minimal stand-in for a Mongoose Query. `.session()` is what puts the read in
 *  the transaction, so that is where the record gets tagged. */
const sessionQuery = (data) => {
  const query = {
    session: (session) => {
      markWrite(data, session);
      return query;
    },
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return query;
};

const userProgressFindOneAndUpdate = jest.fn(async (filter, update, options = {}) => {
  if (failInsideTransaction) await failInsideTransaction();

  const key = String(filter.user);
  let doc = store.progress.get(key);
  if (!doc) {
    doc = newProgress(update?.$setOnInsert?.user ?? key);
    store.progress.set(key, doc);
  }
  return markWrite(doc, options.session);
});

const userProgressFindOne = jest.fn((filter) => chainOf(store.progress.get(String(filter.user)) ?? null));

const userFindById = jest.fn((userId) => sessionQuery(store.users.get(String(userId)) ?? null));

/**
 * MongoDB `create` and `insertMany` are both called with a document array plus
 * an options object, so the doubles normalise either shape.
 */
const notificationCreate = jest.fn(async (docs, options = {}) => {
  const list = Array.isArray(docs) ? docs : [docs];
  list.forEach((doc) => store.notifications.push(markWrite({ ...doc }, options.session)));
  return list;
});

const learningEventCreate = jest.fn(async (docs, options = {}) => {
  const list = Array.isArray(docs) ? docs : [docs];
  list.forEach((doc) => store.events.push(markWrite({ ...doc }, options.session)));
  return list;
});
const learningEventInsertMany = jest.fn(async (docs, options = {}) => {
  if (failInsideEventInsert) await failInsideEventInsert();
  docs.forEach((doc) => store.events.push(markWrite({ ...doc }, options.session)));
  // Fails after the write, which is the only way to tell whether the insert
  // actually joined the transaction.
  if (failAfterEventInsert) await failAfterEventInsert();
  return docs;
});

const reviewQueueFindOneAndUpdate = jest.fn(async (filter, update, options = {}) => {
  const key = filter._id ? `id:${filter._id}` : JSON.stringify(filter);
  const existing = store.queueItems.get(key);
  if (existing) {
    Object.assign(existing, update.$set);
    return existing;
  }
  if (!options.upsert) return null;
  const created = { _id: `rq-${store.queueItems.size + 1}`, ...update.$set, ...(update.$setOnInsert ?? {}) };
  store.queueItems.set(key, created);
  return created;
});

const matchingQueueItems = (filter) => [...store.queueItems.values()].filter((item) => {
  if (filter.user !== undefined && String(item.user) !== String(filter.user)) return false;
  if (filter.status !== undefined && item.status !== filter.status) return false;
  return true;
});

const reviewQueueFind = jest.fn((filter) => {
  const items = matchingQueueItems(filter);
  const query = chainOf(items);
  query.sort = (...args) => {
    query.chain.sort = args;
    for (const [field, direction] of Object.entries(args[0])) {
      items.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * direction;
      });
    }
    return query;
  };
  return query;
});

const reviewQueueCountDocuments = jest.fn(async (filter) => matchingQueueItems(filter).length);

const flashcardSetFind = jest.fn(() => chainOf(store.flashcardSets));
const quizAttemptFindById = jest.fn(async (id) => store.attempts.get(String(id)) ?? null);
const quizFindById = jest.fn(async (id) => store.quizzes.get(String(id)) ?? null);

/**
 * The idempotency claim. This is the correctness boundary, so the double has to
 * reproduce MongoDB's conditional-update semantics exactly: the filter is
 * evaluated against the attempt as it stands, and a claim that matches nothing
 * returns null rather than creating or resetting the document.
 */
const quizAttemptFindOneAndUpdate = jest.fn(async (filter, update, options = {}) => {
  const attempt = store.attempts.get(String(filter._id));
  if (!attempt) return null;

  // Mirrors MongoDB's conditional update: the filter is evaluated against the
  // attempt as it stands, and an update matching nothing returns null rather
  // than modifying or creating the document.
  if (filter["sync.status"]?.$ne !== undefined
    && attempt.sync?.status === filter["sync.status"].$ne) {
    return null;
  }

  // `$set` uses dotted paths, which MongoDB stores as nested fields.
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    const parts = path.split(".");
    let target = attempt;
    for (const part of parts.slice(0, -1)) {
      if (typeof target[part] !== "object" || target[part] === null) target[part] = {};
      target = target[part];
    }
    target[parts.at(-1)] = value;
  }
  return markWrite(attempt, options.session);
});

/** Lets a test arm a failure inside the transaction to prove atomicity.
 *  `failInsideTransaction` fires at the first effect, `failInsideEventInsert`
 *  before the events are written, and `failAfterEventInsert` once they have
 *  been written. Only a failure that lands after a given write can prove that
 *  write joined the transaction rather than escaping the rollback. */
let failInsideTransaction = null;
let failInsideEventInsert = null;
let failAfterEventInsert = null;

jest.unstable_mockModule("../../utils/dbTransactions.js", () => ({ runInTransaction }));

jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOneAndUpdate: userProgressFindOneAndUpdate, findOne: userProgressFindOne },
}));
jest.unstable_mockModule("../../models/User.js", () => ({ default: { findById: userFindById } }));
jest.unstable_mockModule("../../models/Notification.js", () => ({ default: { create: notificationCreate } }));
jest.unstable_mockModule("../../models/LearningEvent.js", () => ({
  default: { create: learningEventCreate, insertMany: learningEventInsertMany },
}));
jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({
  default: { findOneAndUpdate: reviewQueueFindOneAndUpdate, find: reviewQueueFind, countDocuments: reviewQueueCountDocuments },
}));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({ default: { find: flashcardSetFind } }));
jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({
  default: { findById: quizAttemptFindById, findOneAndUpdate: quizAttemptFindOneAndUpdate },
}));
jest.unstable_mockModule("../../models/Quiz.js", () => ({ default: { findById: quizFindById } }));

const { updateUserProgressFromAttempt, updateStudyStreak } =
  await import("../../services/progressService.js");
const { processBackgroundJob, syncAttemptOnce } = await import("../../worker.js");

// ─── Deterministic clock ──────────────────────────────────────────────────────

const NOW = new Date("2026-05-01T09:00:00.000Z");
const USER_ID = "user-contract-1";
const OTHER_USER_ID = "user-contract-2";
const QUIZ_ID = "quiz-os-1";

// ─── Fixture builders ─────────────────────────────────────────────────────────

const answer = (questionIndex, topic, isCorrect) => ({ questionIndex, selected: 0, correct: 0, isCorrect, topic });

const mistake = (questionIndex, topic) => ({
  questionIndex,
  topic,
  misconception: "Misconception recorded for the question.",
  clarification: "A clarification of the concept.",
  distractorReason: "The chosen option was plausible.",
  revisionSuggestion: "Review the topic.",
  relatedFlashcards: ["Recall the definition."],
});

/**
 * A five-question attempt: three correct, two wrong, across three topics, with
 * the mistake analyses already present so the worker never calls the LLM.
 */
const buildAttempt = (id, overrides = {}) => ({
  _id: id,
  user: USER_ID,
  quiz: QUIZ_ID,
  studyMaterial: null,
  score: 3,
  total: 5,
  accuracy: 60,
  difficulty: "Medium",
  durationSeconds: 120,
  createdAt: NOW,
  answers: [
    answer(0, "Deadlock", true),
    answer(1, "Deadlock", false),
    answer(2, "Paging", true),
    answer(3, "Paging", true),
    answer(4, "Scheduling", false),
  ],
  mistakeAnalyses: [mistake(1, "Deadlock"), mistake(4, "Scheduling")],
  ...overrides,
});

const buildQuiz = (id = QUIZ_ID) => ({
  _id: id,
  title: "OS Fundamentals",
  subject: "Operating Systems",
  difficulty: "Medium",
  questionCount: 5,
  attempts: [],
  questions: [],
});

/** Registers an attempt and a quiz in the store, and returns them. */
const seedAttempt = (id, overrides = {}) => {
  const attempt = buildAttempt(id, overrides);
  const quiz = buildQuiz(overrides.quiz ?? QUIZ_ID);
  store.attempts.set(String(id), attempt);
  store.quizzes.set(String(quiz._id), quiz);
  return { attempt, quiz };
};

const syncJob = (attemptId, userId = USER_ID, quizId = QUIZ_ID) => ({
  data: { type: "SYNC_ATTEMPT", data: { attemptId, userId, quizId } },
});

/**
 * Everything the contract speaks about: counters, per-topic learning state,
 * achievements, streak, learning events, notifications and queue items.
 */
const learnerState = (userId = USER_ID) => {
  const progress = store.progress.get(String(userId));
  return {
    totals: { ...progress.totals },
    topics: progress.topics.map((topic) => ({ ...topic })),
    achievements: progress.achievements.map((a) => a.id).sort(),
    streak: { ...store.users.get(String(userId)).streak },
    quizEventCount: store.events.filter(
      (e) => e.eventType === "quiz_attempt" && String(e.user) === String(userId),
    ).length,
    notificationCount: store.notifications.filter(
      (n) => String(n.user) === String(userId),
    ).length,
    queueItemCount: [...store.queueItems.values()].filter(
      (item) => String(item.user) === String(userId),
    ).length,
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  store.progress.clear();
  store.users.clear();
  store.attempts.clear();
  store.quizzes.clear();
  store.events.length = 0;
  store.notifications.length = 0;
  store.queueItems.clear();
  store.flashcardSets = [];

  failInsideTransaction = null;
  failInsideEventInsert = null;
  failAfterEventInsert = null;
  transactionChain = Promise.resolve();

  store.users.set(USER_ID, newUser(USER_ID));
  store.users.set(OTHER_USER_ID, newUser(OTHER_USER_ID));
  store.progress.set(USER_ID, newProgress(USER_ID));
  store.progress.set(OTHER_USER_ID, newProgress(OTHER_USER_ID));

  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Single delivery: the intended result of applying an attempt once.
// These pin concrete values and must survive any idempotency change.
// ─────────────────────────────────────────────────────────────────────────────

describe("applying one attempt once", () => {
  beforeEach(() => {
    seedAttempt("attempt-1");
  });

  test("counts the attempt, its questions and its correct answers", async () => {
    const { attempt, quiz } = { attempt: store.attempts.get("attempt-1"), quiz: store.quizzes.get(QUIZ_ID) };
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 1, questionsAnswered: 5, correctAnswers: 3, averageAccuracy: 60,
    });
  });

  test("records per-topic attempt counts, correctness and review counts", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });

    const byTopic = Object.fromEntries(
      store.progress.get(USER_ID).topics.map((t) => [t.topic, t]),
    );
    expect(byTopic.Deadlock).toMatchObject({ attempted: 2, correct: 1, reviewCount: 2 });
    expect(byTopic.Paging).toMatchObject({ attempted: 2, correct: 2, reviewCount: 2 });
    expect(byTopic.Scheduling).toMatchObject({ attempted: 1, correct: 0, reviewCount: 1 });
  });

  test("computes mastery, confidence and weakness for each topic", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });

    const byTopic = Object.fromEntries(
      store.progress.get(USER_ID).topics.map((t) => [t.topic, t]),
    );
    expect(byTopic.Scheduling).toMatchObject({ mastery: 18, confidence: 21, weaknessScore: 100, recommendedDifficulty: "Easy" });
    expect(byTopic.Deadlock).toMatchObject({ mastery: 62, confidence: 33, weaknessScore: 76, recommendedDifficulty: "Medium" });
    expect(byTopic.Paging).toMatchObject({ mastery: 92, confidence: 59, weaknessScore: 12, recommendedDifficulty: "Hard" });
  });

  test("stores topics ordered by descending weakness", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    expect(store.progress.get(USER_ID).topics.map((t) => t.topic)).toEqual(["Scheduling", "Deadlock", "Paging"]);
  });

  test("starts the study streak on the first attempt of the day", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    expect(store.users.get(USER_ID).streak).toEqual({ current: 1, longest: 1, lastStudyDate: "2026-05-01" });
  });

  test("unlocks the first-quiz achievement and notifies the learner", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    expect(store.progress.get(USER_ID).achievements.map((a) => a.id)).toEqual(["first_quiz"]);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  test("emits one learning event per answer", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    await import("../../services/learningEventService.js").then(({ recordAttemptEvents }) =>
      recordAttemptEvents({ userId: USER_ID, quiz, attempt }));

    expect(store.events).toHaveLength(5);
    expect(store.events.map((e) => e.result)).toEqual([
      "correct", "incorrect", "correct", "correct", "incorrect",
    ]);
    expect(store.events.map((e) => e.metadata.questionIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  test("stamps every learning event with the attempt id", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    const { recordAttemptEvents } = await import("../../services/learningEventService.js");
    await recordAttemptEvents({ userId: USER_ID, quiz, attempt });
    expect(store.events.every((e) => e.metadata.attemptId === "attempt-1")).toBe(true);
  });

  test("records the confidence the service assigns to a correct and a wrong answer", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    const { recordAttemptEvents } = await import("../../services/learningEventService.js");
    await recordAttemptEvents({ userId: USER_ID, quiz, attempt });

    const byIndex = Object.fromEntries(store.events.map((e) => [e.metadata.questionIndex, e]));
    expect(byIndex[0].confidence).toBe(70);
    expect(byIndex[1].confidence).toBe(30);
  });

  test("records the quiz, subject, difficulty and topic on every event", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    const { recordAttemptEvents } = await import("../../services/learningEventService.js");
    await recordAttemptEvents({ userId: USER_ID, quiz, attempt });

    expect(store.events.every((e) => e.subject === "Operating Systems")).toBe(true);
    expect(store.events.every((e) => e.difficulty === "Medium")).toBe(true);
    expect(store.events.every((e) => e.metadata.quizId === QUIZ_ID)).toBe(true);
    expect(store.events.map((e) => e.topic)).toEqual(["Deadlock", "Deadlock", "Paging", "Paging", "Scheduling"]);
  });

  test("reads the learner's progress and streak scoped to that learner", async () => {
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt });
    expect(userProgressFindOneAndUpdate).toHaveBeenCalledWith(
      { user: USER_ID }, { $setOnInsert: { user: USER_ID } }, { upsert: true, new: true },
    );
    expect(userFindById).toHaveBeenCalledWith(USER_ID);
  });

  test("applies the Easy difficulty gain and lands just below the Hard threshold", async () => {
    // A fresh topic with a single correct Easy answer: confidence 35 + 8 = 43,
    // accuracy 100, recency 45, so mastery = 0.5*100 + 0.3*45 + 0.2*43 = 72.1 -> 72,
    // which is Medium because 72 is below the 78 cut-off.
    seedAttempt("attempt-easy", {
      score: 1, total: 1, accuracy: 100, difficulty: "Easy",
      answers: [answer(0, "Cache", true)],
      mistakeAnalyses: [],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-easy"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", mastery: 72, confidence: 43, recommendedDifficulty: "Medium" });
  });

  test("applies the Easy difficulty penalty for a wrong answer", async () => {
    seedAttempt("attempt-easy-wrong", {
      score: 0, total: 1, accuracy: 0, difficulty: "Easy",
      answers: [answer(0, "Cache", false)],
      mistakeAnalyses: [mistake(0, "Cache")],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-easy-wrong"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", confidence: 17, recommendedDifficulty: "Easy" });
  });

  test("applies the Hard difficulty gain", async () => {
    seedAttempt("attempt-hard", {
      score: 1, total: 1, accuracy: 100, difficulty: "Hard",
      answers: [answer(0, "Cache", true)],
      mistakeAnalyses: [],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-hard"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", confidence: 51, mastery: 74, recommendedDifficulty: "Medium" });
  });

  test("applies the Hard difficulty penalty", async () => {
    seedAttempt("attempt-hard-wrong", {
      score: 0, total: 1, accuracy: 0, difficulty: "Hard",
      answers: [answer(0, "Cache", false)],
      mistakeAnalyses: [mistake(0, "Cache")],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-hard-wrong"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", confidence: 25, mastery: 19, recommendedDifficulty: "Easy" });
  });

  test("keeps a topic in the mid-mastery band as Medium difficulty", async () => {
    // Two correct and two wrong Easy answers on one topic settle at mastery 58,
    // which must be Medium: below the 78 Hard cut-off and above the 55 cut-off.
    seedAttempt("attempt-mid", {
      score: 2, total: 4, accuracy: 50, difficulty: "Easy",
      answers: [
        answer(0, "Cache", true), answer(1, "Cache", false),
        answer(2, "Cache", true), answer(3, "Cache", false),
      ],
      mistakeAnalyses: [mistake(1, "Cache"), mistake(3, "Cache")],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-mid"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", mastery: 58, recommendedDifficulty: "Medium" });
  });

  test("promotes a topic just above the Hard threshold", async () => {
    // Three correct and one wrong Medium answer settle at mastery 79, which must
    // be Hard: above the 78 cut-off.
    seedAttempt("attempt-high", {
      score: 3, total: 4, accuracy: 75, difficulty: "Medium",
      answers: [
        answer(0, "Cache", true), answer(1, "Cache", true),
        answer(2, "Cache", true), answer(3, "Cache", false),
      ],
      mistakeAnalyses: [mistake(3, "Cache")],
    });
    const quiz = store.quizzes.get(QUIZ_ID);
    await updateUserProgressFromAttempt({
      userId: USER_ID, quiz, attempt: store.attempts.get("attempt-high"),
    });

    const [only] = store.progress.get(USER_ID).topics;
    expect(only).toMatchObject({ topic: "Cache", mastery: 79, recommendedDifficulty: "Hard" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CONTRACT — processing one logical attempt must equal processing it once,
// whether the repeat arrives sequentially or as a duplicate job delivery.
// ─────────────────────────────────────────────────────────────────────────────

describe("CONTRACT: processing the same attempt twice is a no-op", () => {
  beforeEach(() => {
    seedAttempt("attempt-1");
  });

  // Delivers through the real worker handler so the durable claim, not just the
  // progress service, is what these clauses exercise.
  const deliver = async () => {
    await processBackgroundJob(syncJob("attempt-1"));
  };

  test("leaves the aggregate counters unchanged", async () => {
    await deliver();
    const afterFirst = { ...store.progress.get(USER_ID).totals };
    await deliver();
    expect(store.progress.get(USER_ID).totals).toEqual(afterFirst);
  });

  test("leaves per-topic attempt, correct and review counts unchanged", async () => {
    await deliver();
    const afterFirst = store.progress.get(USER_ID).topics.map((t) => ({
      topic: t.topic, attempted: t.attempted, correct: t.correct, reviewCount: t.reviewCount,
    }));
    await deliver();
    expect(store.progress.get(USER_ID).topics.map((t) => ({
      topic: t.topic, attempted: t.attempted, correct: t.correct, reviewCount: t.reviewCount,
    }))).toEqual(afterFirst);
  });

  test("does not apply mastery, confidence or weakness a second time", async () => {
    await deliver();
    const afterFirst = store.progress.get(USER_ID).topics.map((t) => ({
      topic: t.topic, mastery: t.mastery, confidence: t.confidence, weaknessScore: t.weaknessScore,
    }));
    await deliver();
    expect(store.progress.get(USER_ID).topics.map((t) => ({
      topic: t.topic, mastery: t.mastery, confidence: t.confidence, weaknessScore: t.weaknessScore,
    }))).toEqual(afterFirst);
  });

  test("leaves the whole learner state unchanged", async () => {
    await deliver();
    const afterFirst = learnerState();
    await deliver();
    expect(learnerState()).toEqual(afterFirst);
  });

  test("does not extend the study streak a second time", async () => {
    // Already satisfied: `updateStudyStreak` returns early when the learner's
    // lastStudyDate is today (progressService.js:148), so a same-day repeat
    // cannot advance the streak. Kept as a contract test so the guarantee
    // cannot be lost while the other clauses are implemented.
    await deliver();
    const afterFirst = { ...store.users.get(USER_ID).streak };
    await deliver();
    expect(store.users.get(USER_ID).streak).toEqual(afterFirst);
  });

  test("unlocks the first-quiz achievement exactly once", async () => {
    // Already satisfied: the achievement branch only fires when quizzesTaken is
    // exactly 1 (progressService.js:116) and re-checks for an existing
    // "first_quiz" entry (progressService.js:117), so a redelivered job adds
    // neither a second achievement nor a second notification.
    await deliver();
    const afterFirst = learnerState();
    expect(afterFirst.achievements).toEqual(["first_quiz"]);
    expect(afterFirst.notificationCount).toBe(1);

    await deliver();
    expect(learnerState().achievements).toEqual(afterFirst.achievements);
    expect(learnerState().notificationCount).toBe(afterFirst.notificationCount);
  });

  test("does not duplicate review queue items", async () => {
    // Already satisfied: the review queue is keyed on an upsert filter
    // (reviewQueueService.js:9-18), so a repeated rebuild converges on the same
    // items instead of adding more.
    await deliver();
    const { enqueueFailedQuestionItems, rebuildReviewQueueForUser } =
      await import("../../services/reviewQueueService.js");
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);
    const produceQueueItems = async () => {
      await enqueueFailedQuestionItems({ userId: USER_ID, quiz, attempt, mistakeAnalyses: attempt.mistakeAnalyses });
      await rebuildReviewQueueForUser(USER_ID);
    };

    await produceQueueItems();
    const afterFirst = store.queueItems.size;
    const topicsAfterFirst = [...store.queueItems.values()].map((i) => `${i.itemType}:${i.topic}`).sort();
    expect(afterFirst).toBeGreaterThan(0);

    await produceQueueItems();
    expect(store.queueItems.size).toBe(afterFirst);
    expect([...store.queueItems.values()].map((i) => `${i.itemType}:${i.topic}`).sort()).toEqual(topicsAfterFirst);
  });
});

describe("CONTRACT: a repeated SYNC_ATTEMPT job is a no-op", () => {
  beforeEach(() => {
    seedAttempt("attempt-1");
  });

  test("produces the same learner state after a redelivered job", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    const afterFirst = learnerState();
    await processBackgroundJob(syncJob("attempt-1"));
    expect(learnerState()).toEqual(afterFirst);
  });

  test("does not insert a second set of learning events", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    const afterFirst = learnerState();
    await processBackgroundJob(syncJob("attempt-1"));
    expect(learnerState().quizEventCount).toBe(afterFirst.quizEventCount);
  });

  test("does not duplicate review queue items", async () => {
    // Already satisfied: the review queue is upsert-keyed, so a redelivered job
    // converges on the same items (see the equivalent clause above).
    await processBackgroundJob(syncJob("attempt-1"));
    const afterFirst = learnerState();
    await processBackgroundJob(syncJob("attempt-1"));
    expect(learnerState().queueItemCount).toBe(afterFirst.queueItemCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The recovery window Task 38 identified.
//
// `enqueueFailedQuestionItems` and `rebuildReviewQueueForUser` run *after* the
// transaction commits, so a worker that dies between the commit and them leaves
// the review queue incomplete. The durable claim still reads as "processed", so
// the redelivery below is exactly the case that used to return early and lose
// those effects for good.
// ─────────────────────────────────────────────────────────────────────────────
describe("CONTRACT: a redelivery repairs post-commit review queue effects", () => {
  beforeEach(() => {
    // The transaction committed and the claim is durable, but the review queue
    // this attempt should have produced was never written.
    seedAttempt("attempt-1", { sync: { status: "processed", appliedAt: NOW } });
    expect(learnerState().queueItemCount).toBe(0);
  });

  test("reconstructs the failed-question state for an already-processed attempt", async () => {
    await processBackgroundJob(syncJob("attempt-1"));

    const repaired = learnerState();
    expect(repaired.queueItemCount).toBeGreaterThan(0);

    const failedQuestions = [...store.queueItems.values()].filter(
      (item) => item.itemType === "failed_question" && String(item.user) === USER_ID,
    );
    expect(failedQuestions.map((item) => item.topic).sort()).toEqual([
      "Deadlock",
      "Scheduling",
    ]);
  });

  test("still reports the delivery as a duplicate that applied nothing", async () => {
    await expect(processBackgroundJob(syncJob("attempt-1"))).resolves.toEqual({
      type: "SYNC_ATTEMPT",
      attemptId: "attempt-1",
      quizId: QUIZ_ID,
      applied: false,
      duplicate: true,
    });
  });

  test("replaying the repair repeatedly does not duplicate queue items", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    const afterFirst = learnerState();
    // Guards against this passing vacuously by comparing zero to zero.
    expect(afterFirst.queueItemCount).toBeGreaterThan(0);
    const topicsAfterFirst = [...store.queueItems.values()]
      .map((item) => `${item.itemType}:${item.topic}`)
      .sort();

    await processBackgroundJob(syncJob("attempt-1"));
    await processBackgroundJob(syncJob("attempt-1"));

    expect(learnerState().queueItemCount).toBe(afterFirst.queueItemCount);
    expect(
      [...store.queueItems.values()].map((item) => `${item.itemType}:${item.topic}`).sort(),
    ).toEqual(topicsAfterFirst);
  });

  test("repairs the queue without re-applying the transactional effects", async () => {
    // Nothing was ever committed for this attempt, so a correct repair creates
    // review-queue state and touches nothing the transaction owns.
    await processBackgroundJob(syncJob("attempt-1"));

    const state = learnerState();
    expect(state.totals.quizzesTaken).toBe(0);
    expect(state.totals.questionsAnswered).toBe(0);
    expect(state.quizEventCount).toBe(0);
    expect(state.achievements).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The key boundary: duplicates are per attempt, not global.
// These must hold before AND after idempotency is implemented, so that a fix
// cannot simply suppress all later attempts.
// ─────────────────────────────────────────────────────────────────────────────

describe("duplicate suppression must be scoped to one attempt", () => {
  test("applies a second, different attempt", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2", { score: 5, accuracy: 100 });
    const quiz = store.quizzes.get(QUIZ_ID);

    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt: store.attempts.get("attempt-1") });
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt: store.attempts.get("attempt-2") });

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(2);
  });

  test("counts questions and correct answers across two different attempts", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2", { score: 5, accuracy: 100 });
    const quiz = store.quizzes.get(QUIZ_ID);

    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt: store.attempts.get("attempt-1") });
    await updateUserProgressFromAttempt({ userId: USER_ID, quiz, attempt: store.attempts.get("attempt-2") });

    expect(store.progress.get(USER_ID).totals.questionsAnswered).toBe(10);
    expect(store.progress.get(USER_ID).totals.correctAnswers).toBe(8);
  });

  test("processes a second job for a different attempt", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2", { score: 5, accuracy: 100 });

    await processBackgroundJob(syncJob("attempt-1"));
    await processBackgroundJob(syncJob("attempt-2"));

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(2);
    expect(learnerState().quizEventCount).toBe(10);
  });

  test("keeps two attempts on the same quiz independent", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2", { score: 5, accuracy: 100 });

    await processBackgroundJob(syncJob("attempt-1"));
    await processBackgroundJob(syncJob("attempt-2"));

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(2);
  });

  test("does not let one learner's attempt touch another learner's progress", async () => {
    seedAttempt("attempt-1");
    const other = buildAttempt("attempt-other", { user: OTHER_USER_ID, _id: "attempt-other" });
    store.attempts.set("attempt-other", other);

    await updateUserProgressFromAttempt({ userId: USER_ID, quiz: store.quizzes.get(QUIZ_ID), attempt: store.attempts.get("attempt-1") });

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(1);
    expect(store.progress.get(OTHER_USER_ID).totals.quizzesTaken).toBe(0);
  });

  test("lets another learner's own attempt apply normally", async () => {
    seedAttempt("attempt-1");
    store.attempts.set("attempt-other", buildAttempt("attempt-other", { user: OTHER_USER_ID }));

    await processBackgroundJob(syncJob("attempt-1"));
    await processBackgroundJob(syncJob("attempt-other", OTHER_USER_ID));

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(1);
    expect(store.progress.get(OTHER_USER_ID).totals.quizzesTaken).toBe(1);
    expect(learnerState(USER_ID).quizEventCount).toBe(5);
    expect(learnerState(OTHER_USER_ID).quizEventCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The durable boundary itself: a claim on the attempt document.
// ─────────────────────────────────────────────────────────────────────────────

describe("the durable attempt claim", () => {
  test("records the attempt as processed with a timestamp", async () => {
    seedAttempt("attempt-1");
    expect(store.attempts.get("attempt-1").sync).toBeUndefined();

    await processBackgroundJob(syncJob("attempt-1"));

    expect(store.attempts.get("attempt-1").sync.status).toBe("processed");
    expect(store.attempts.get("attempt-1").sync.appliedAt).toEqual(expect.any(Date));
  });

  test("leaves a different attempt unclaimed", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2");

    await processBackgroundJob(syncJob("attempt-1"));

    expect(store.attempts.get("attempt-1").sync.status).toBe("processed");
    expect(store.attempts.get("attempt-2").sync?.status).toBeUndefined();
  });

  test("does not claim an attempt whose learner does not own it", async () => {
    seedAttempt("attempt-1");
    store.attempts.get("attempt-1").user = OTHER_USER_ID;

    await processBackgroundJob(syncJob("attempt-1")).catch(() => {});

    expect(store.attempts.get("attempt-1").sync?.status).toBeUndefined();
  });

  test("claims through a conditional update, not a read-then-write", async () => {
    seedAttempt("attempt-1");
    await processBackgroundJob(syncJob("attempt-1"));

    expect(quizAttemptFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "attempt-1", "sync.status": { $ne: "processed" } },
      { $set: { "sync.status": "processed", "sync.appliedAt": expect.any(Date) } },
      expect.objectContaining({ new: true }),
    );
  });

  test("applies the learner effects inside the same transaction as the claim", async () => {
    seedAttempt("attempt-1");
    await processBackgroundJob(syncJob("attempt-1"));

    // The claim is taken first, and both effect writes carry that session, so
    // the marker can never commit without the learner update.
    const claimOrder = quizAttemptFindOneAndUpdate.mock.invocationCallOrder[0];
    const progressOrder = userProgressFindOneAndUpdate.mock.invocationCallOrder[0];
    const eventOrder = learningEventInsertMany.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(progressOrder);
    expect(progressOrder).toBeLessThan(eventOrder);
    expect(runInTransaction).toHaveBeenCalledTimes(1);
  });

  test("the claim alone blocks a repeat, with no help from the worker's pre-check", async () => {
    // `syncAttemptOnce` is the whole idempotency boundary: the worker's
    // `isAttemptSynced` pre-check is only an optimisation, so removing it must
    // not change the outcome. Calling the claim path directly proves the second
    // delivery is stopped by the durable conditional update and not by a
    // read-then-skip check in the handler.
    seedAttempt("attempt-1");
    const attempt = store.attempts.get("attempt-1");
    const quiz = store.quizzes.get(QUIZ_ID);

    await expect(syncAttemptOnce({ attempt, quiz, userId: USER_ID })).resolves.toBe(true);
    const afterFirst = learnerState();
    await expect(syncAttemptOnce({ attempt, quiz, userId: USER_ID })).resolves.toBe(false);

    expect(learnerState()).toEqual(afterFirst);
    expect(store.events).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Crash safety: a failure inside the transaction must not leave a partially
// applied attempt behind, and must not mark it processed either.
// ─────────────────────────────────────────────────────────────────────────────

describe("a failure during application is rolled back", () => {
  test("leaves no learner state and no claim when the first effect fails", async () => {
    seedAttempt("attempt-1");
    failInsideTransaction = async () => {
      throw new Error("simulated failure while applying progress");
    };

    await expect(processBackgroundJob(syncJob("attempt-1"))).rejects.toThrow("simulated failure");

    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 0, questionsAnswered: 0, correctAnswers: 0, averageAccuracy: 0,
    });
    expect(store.events).toHaveLength(0);
    expect(store.attempts.get("attempt-1").sync?.status).toBeUndefined();
  });

  test("rolls back the progress already written when a later effect fails", async () => {
    // This is the case that catches an effect which is not actually part of the
    // transaction: the progress update has already committed at this point, so
    // unless it carried the session it would survive the abort and be applied
    // twice by the retry.
    seedAttempt("attempt-1");
    failInsideEventInsert = async () => {
      throw new Error("simulated failure while writing learning events");
    };

    await expect(processBackgroundJob(syncJob("attempt-1"))).rejects.toThrow("simulated failure");

    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 0, questionsAnswered: 0, correctAnswers: 0, averageAccuracy: 0,
    });
    expect(store.progress.get(USER_ID).topics).toEqual([]);
    expect(store.events).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
    expect(store.users.get(USER_ID).streak).toEqual({
      current: 0, longest: 0, lastStudyDate: null,
    });
    expect(store.attempts.get("attempt-1").sync?.status).toBeUndefined();
  });

  test("rolls back the learning events already written when the transaction aborts after them", async () => {
    seedAttempt("attempt-1");
    failAfterEventInsert = async () => {
      throw new Error("simulated failure after writing learning events");
    };

    await expect(processBackgroundJob(syncJob("attempt-1"))).rejects.toThrow("simulated failure after writing");

    expect(store.events).toHaveLength(0);
    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(0);
    expect(store.attempts.get("attempt-1").sync?.status).toBeUndefined();
  });

  test("rolls back a milestone streak notification written inside the transaction", async () => {
    // Puts the learner one day short of a 3-day streak so the worker creates a
    // streak notification, then aborts, to prove the notification joined the
    // transaction rather than escaping it.
    jest.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    store.users.get(USER_ID).streak = { current: 2, longest: 2, lastStudyDate: "2026-04-30" };
    seedAttempt("attempt-1");
    failAfterEventInsert = async () => {
      throw new Error("simulated failure after the streak notification");
    };

    await expect(processBackgroundJob(syncJob("attempt-1"))).rejects.toThrow("simulated failure");

    expect(store.notifications).toHaveLength(0);
    expect(store.users.get(USER_ID).streak).toEqual({
      current: 2, longest: 2, lastStudyDate: "2026-04-30",
    });
  });

  test("applies the attempt exactly once when the failed delivery is retried", async () => {
    seedAttempt("attempt-1");
    failInsideEventInsert = async () => {
      throw new Error("simulated transient failure");
    };
    await expect(processBackgroundJob(syncJob("attempt-1"))).rejects.toThrow("simulated transient failure");

    // The retry, as BullMQ would perform it after the failure.
    failInsideEventInsert = null;
    await processBackgroundJob(syncJob("attempt-1"));

    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 1, questionsAnswered: 5, correctAnswers: 3, averageAccuracy: 60,
    });
    expect(store.events).toHaveLength(5);
    expect(store.progress.get(USER_ID).topics.reduce((sum, t) => sum + t.attempted, 0)).toBe(5);
  });

  test("a third delivery after a successful retry is still a no-op", async () => {
    seedAttempt("attempt-1");
    await processBackgroundJob(syncJob("attempt-1"));
    const afterFirst = learnerState();
    await processBackgroundJob(syncJob("attempt-1"));
    await processBackgroundJob(syncJob("attempt-1"));
    expect(learnerState()).toEqual(afterFirst);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency: a plain "if already processed, skip" check is not enough, because
// two deliveries can both read "pending" before either writes. The claim is a
// conditional update inside the transaction, so only one delivery can win it.
// ─────────────────────────────────────────────────────────────────────────────

describe("concurrent duplicate delivery", () => {
  test("two simultaneous deliveries apply the attempt exactly once", async () => {
    seedAttempt("attempt-1");

    const results = await Promise.all([
      processBackgroundJob(syncJob("attempt-1")),
      processBackgroundJob(syncJob("attempt-1")),
    ]);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);

    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 1, questionsAnswered: 5, correctAnswers: 3, averageAccuracy: 60,
    });
    expect(store.events).toHaveLength(5);
  });

  test("concurrent duplicates equal a single delivery", async () => {
    seedAttempt("attempt-1");
    await processBackgroundJob(syncJob("attempt-1"));
    const afterSingle = learnerState();

    store.progress = new Map();
    store.users = new Map();
    store.events = [];
    store.notifications = [];
    store.queueItems = new Map();
    store.users.set(USER_ID, newUser(USER_ID));
    store.progress.set(USER_ID, newProgress(USER_ID));
    store.attempts.get("attempt-1").sync = undefined;

    await Promise.all([
      processBackgroundJob(syncJob("attempt-1")),
      processBackgroundJob(syncJob("attempt-1")),
    ]);

    const { appliedAt, ...concurrentSync } = store.attempts.get("attempt-1").sync;
    expect(learnerState()).toEqual(afterSingle);
    expect(concurrentSync).toEqual({ status: "processed" });
  });

  test("many simultaneous deliveries still apply the attempt once", async () => {
    seedAttempt("attempt-1");

    const results = await Promise.all(
      Array.from({ length: 8 }, () => processBackgroundJob(syncJob("attempt-1"))),
    );

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(1);
    expect(store.events).toHaveLength(5);
  });

  test("concurrent deliveries of two different attempts both apply", async () => {
    seedAttempt("attempt-1");
    seedAttempt("attempt-2");

    await Promise.all([
      processBackgroundJob(syncJob("attempt-1")),
      processBackgroundJob(syncJob("attempt-2")),
    ]);

    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(2);
    expect(store.progress.get(USER_ID).totals.questionsAnswered).toBe(10);
    expect(store.events).toHaveLength(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker job validation — existing behaviour that the idempotency work must keep.
// ─────────────────────────────────────────────────────────────────────────────

describe("SYNC_ATTEMPT job validation", () => {
  test("rejects a job when the attempt does not exist", async () => {
    await expect(processBackgroundJob(syncJob("attempt-missing")))
      .rejects.toThrow("Quiz attempt attempt-missing was not found for synchronization.");
  });

  test("rejects a job when the quiz does not exist", async () => {
    seedAttempt("attempt-1");
    store.quizzes.delete(QUIZ_ID);
    await expect(processBackgroundJob(syncJob("attempt-1")))
      .rejects.toThrow(`Quiz ${QUIZ_ID} was not found for attempt synchronization.`);
  });

  test("rejects a job when the attempt belongs to another learner", async () => {
    seedAttempt("attempt-1");
    store.attempts.get("attempt-1").user = OTHER_USER_ID;
    await expect(processBackgroundJob(syncJob("attempt-1")))
      .rejects.toThrow(`Quiz attempt attempt-1 does not belong to user ${USER_ID}.`);
  });

  test("applies nothing when ownership fails", async () => {
    seedAttempt("attempt-1");
    store.attempts.get("attempt-1").user = OTHER_USER_ID;
    await processBackgroundJob(syncJob("attempt-1")).catch(() => {});
    expect(store.progress.get(USER_ID).totals.quizzesTaken).toBe(0);
  });

  test("rejects a job with no attempt id", async () => {
    await expect(processBackgroundJob({ data: { type: "SYNC_ATTEMPT", data: { userId: USER_ID, quizId: QUIZ_ID } } }))
      .rejects.toThrow("Background job is missing attemptId.");
  });

  test("rejects an unknown job type", async () => {
    await expect(processBackgroundJob({ data: { type: "NOT_A_JOB", data: {} } }))
      .rejects.toThrow("Unknown background job type: NOT_A_JOB");
  });

  test("reports the attempt and quiz it processed", async () => {
    seedAttempt("attempt-1");
    await expect(processBackgroundJob(syncJob("attempt-1")))
      .resolves.toEqual({
        type: "SYNC_ATTEMPT",
        attemptId: "attempt-1",
        quizId: QUIZ_ID,
        applied: true,
        duplicate: false,
      });
  });

  test("reports a redelivery as a duplicate that applied nothing", async () => {
    seedAttempt("attempt-1");
    await processBackgroundJob(syncJob("attempt-1"));
    await expect(processBackgroundJob(syncJob("attempt-1")))
      .resolves.toEqual({
        type: "SYNC_ATTEMPT",
        attemptId: "attempt-1",
        quizId: QUIZ_ID,
        applied: false,
        duplicate: true,
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One full job delivery, pinned concretely.
// ─────────────────────────────────────────────────────────────────────────────

describe("one SYNC_ATTEMPT delivery", () => {
  beforeEach(() => {
    seedAttempt("attempt-1");
  });

  test("applies the attempt to learner progress", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    expect(store.progress.get(USER_ID).totals).toEqual({
      quizzesTaken: 1, questionsAnswered: 5, correctAnswers: 3, averageAccuracy: 60,
    });
  });

  test("records one learning event per answered question", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    expect(store.events.filter((e) => e.eventType === "quiz_attempt")).toHaveLength(5);
  });

  test("queues a review item for each recorded mistake", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    const failed = [...store.queueItems.values()].filter((i) => i.itemType === "failed_question");
    expect(failed).toHaveLength(2);
    expect(failed.map((i) => i.topic).sort()).toEqual(["Deadlock", "Scheduling"]);
  });

  test("queues topic review items for the learner's weak topics", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    const topicItems = [...store.queueItems.values()]
      .filter((i) => i.itemType === "low_confidence_topic" || i.itemType === "weak_topic");
    // Scheduling (weakness 100) and Deadlock (weakness 76) exceed the weakness
    // threshold. Paging does not: weakness 12 is not above 35 and confidence 59
    // is not below 55.
    expect(topicItems.map((i) => i.topic).sort()).toEqual(["Deadlock", "Scheduling"]);
  });

  test("reuses the stored mistake analyses instead of calling the model again", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    // The attempt already carries mistakeAnalyses, so the worker must not
    // regenerate them; the two failure topics prove which analyses were used.
    const failed = [...store.queueItems.values()].filter((i) => i.itemType === "failed_question");
    expect(failed.map((i) => i.metadata.questionIndex).sort()).toEqual([1, 4]);
  });

  test("starts the learner's streak", async () => {
    await processBackgroundJob(syncJob("attempt-1"));
    expect(store.users.get(USER_ID).streak).toEqual({ current: 1, longest: 1, lastStudyDate: "2026-05-01" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Streak continuity — one streak is advanced per day, not per attempt.
// ─────────────────────────────────────────────────────────────────────────────

describe("updateStudyStreak", () => {
  test("does not advance twice within the same day", async () => {
    await updateStudyStreak(USER_ID);
    const afterFirst = { ...store.users.get(USER_ID).streak };
    await updateStudyStreak(USER_ID);
    expect(store.users.get(USER_ID).streak).toEqual(afterFirst);
  });

  test("continues the streak on the following day", async () => {
    await updateStudyStreak(USER_ID);
    jest.setSystemTime(new Date("2026-05-02T09:00:00.000Z"));
    await updateStudyStreak(USER_ID);
    expect(store.users.get(USER_ID).streak).toEqual({ current: 2, longest: 2, lastStudyDate: "2026-05-02" });
  });

  test("resets the current streak after a missed day but keeps the longest", async () => {
    await updateStudyStreak(USER_ID);
    jest.setSystemTime(new Date("2026-05-02T09:00:00.000Z"));
    await updateStudyStreak(USER_ID);
    jest.setSystemTime(new Date("2026-05-05T09:00:00.000Z"));
    await updateStudyStreak(USER_ID);
    expect(store.users.get(USER_ID).streak).toEqual({ current: 1, longest: 2, lastStudyDate: "2026-05-05" });
  });

  test("returns null for a learner that does not exist", async () => {
    store.users.delete(USER_ID);
    expect(await updateStudyStreak(USER_ID)).toBeNull();
  });

  test("celebrates a milestone streak length", async () => {
    jest.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    for (let day = 1; day <= 3; day += 1) {
      jest.setSystemTime(new Date(`2026-04-${String(27 + day).padStart(2, "0")}T09:00:00.000Z`));
      await updateStudyStreak(USER_ID);
    }
    expect(store.users.get(USER_ID).streak.current).toBe(3);
    expect(store.notifications.map((n) => n.title)).toContain("3 Day Streak! 🔥");
  });

  test("does not reset a multi-day streak when called twice on the same day", async () => {
    for (let day = 1; day <= 3; day += 1) {
      jest.setSystemTime(new Date(`2026-04-${String(27 + day).padStart(2, "0")}T09:00:00.000Z`));
      await updateStudyStreak(USER_ID);
    }
    const atMilestone = { ...store.users.get(USER_ID).streak };
    expect(atMilestone).toEqual({ current: 3, longest: 3, lastStudyDate: "2026-04-30" });

    await updateStudyStreak(USER_ID);
    expect(store.users.get(USER_ID).streak).toEqual(atMilestone);
  });

  test("does not raise a second milestone notification on a same-day repeat", async () => {
    for (let day = 1; day <= 3; day += 1) {
      jest.setSystemTime(new Date(`2026-04-${String(27 + day).padStart(2, "0")}T09:00:00.000Z`));
      await updateStudyStreak(USER_ID);
    }
    const notificationsAfterMilestone = store.notifications.length;
    await updateStudyStreak(USER_ID);
    expect(store.notifications).toHaveLength(notificationsAfterMilestone);
  });
});
