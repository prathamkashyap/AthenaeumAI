/**
 * Integration Tests — ReviewQueue open-item identity against real MongoDB
 *
 * The unit suites (`tests/unit/reviewQueueService.test.js` and
 * `tests/unit/reviewQueueAttemptAttribution.test.js`) replace the Mongoose layer,
 * so they can only assert the filter the service builds and the documents a
 * stand-in store derives from it. Neither can see the open-item unique index in
 * `backend/models/ReviewQueue.js:70-84`, which is what makes an open review item
 * unique in the first place. This file therefore drives the *real* service
 * against a *real* MongoDB connection and the real index, which is what
 * requirement F asks for: the corrected identity has to agree with the index as
 * actually declared, not merely with a mock of it.
 *
 * The properties checked here:
 *
 *   1. two attempts at the same quiz/topic keep separate open items, each
 *      attributed to its own attempt — the defect this task corrects;
 *   2. repeated delivery of one attempt still converges on a single item;
 *   3. replaying an earlier attempt after a later one exists disturbs neither;
 *   4. the partial unique index is genuinely live — a duplicate insert of the
 *      same identity still fails with E11000, so convergence comes from the
 *      filter rather than from weakened uniqueness;
 *   5. items with no attempt are still deduplicated by the old identity.
 *
 * These need MongoDB but not Redis, so like `attemptSyncDurability.test.js` they
 * are not gated behind the job queue being enabled, and unlike the transaction
 * tests they need no replica set.
 */

import mongoose from "mongoose";
import { config } from "dotenv";
import ReviewQueue from "../../models/ReviewQueue.js";

config({ path: new URL("../../.env", import.meta.url).pathname });

const testDbUri =
  process.env.MONGODB_URI_TEST ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/athenaeumAI_test";

let connected = false;

try {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testDbUri, { serverSelectionTimeoutMS: 5000 });
  }
  // The production models must be loaded against the live connection before the
  // service is imported, so that the index declared on the schema is the one
  // actually enforced below.
  ReviewQueue.syncIndexes();
  connected = true;
} catch (error) {
  console.warn(`[reviewQueueAttemptIdentity] MongoDB unavailable, skipping: ${error.message}`);
}

const {
  enqueueFailedQuestionItems,
  snoozeReviewQueueItem,
  rebuildReviewQueueForUser,
} = await import("../../services/reviewQueueService.js");

// Topic rebuilds read progress, so the real UserProgress model is used here.
const { default: UserProgress } = await import("../../models/UserProgress.js");

afterAll(async () => {
  if (connected) {
    await ReviewQueue.deleteMany({});
    await mongoose.connection.close();
  }
}, 15000);

const describeDb = connected ? describe : describe.skip;

const oid = () => new mongoose.Types.ObjectId();

describeDb("ReviewQueue open-item identity (real MongoDB)", () => {
  let user;
  let quiz;

  beforeEach(async () => {
    user = oid();
    quiz = oid();
    await ReviewQueue.deleteMany({});
  });

  afterAll(async () => {
    if (connected) await ReviewQueue.deleteMany({});
  });

  /** The superseded index name, as MongoDB derives it from the old key spec. */
  const COARSE_INDEX_NAME =
    "user_1_itemType_1_topic_1_source.quiz_1_source.attempt_1_source.flashcardSet_1_source.flashcardId_1";

  const mistake = (overrides = {}) => ({
    questionIndex: 2,
    topic: "Deadlock",
    misconception: "Holding a lock while requesting another",
    clarification: "Deadlock needs all four conditions at once",
    distractorReason: "Chose a single condition",
    relatedFlashcards: [],
    ...overrides,
  });

  const enqueue = (attemptId, analyses = [mistake()]) =>
    enqueueFailedQuestionItems({
      userId: user,
      quiz: { _id: quiz, subject: "Operating Systems" },
      attempt: { _id: attemptId },
      mistakeAnalyses: analyses,
    });

  const openItems = () =>
    ReviewQueue.find({ user, status: "open" }).sort({ createdAt: 1 }).lean();

  // ─── Different attempts remain distinct ─────────────────────────────────────

  test("two attempts at the same quiz and topic produce two open items", async () => {
    await enqueue(oid());
    await enqueue(oid());

    expect(await openItems()).toHaveLength(2);
  });

  test("each item keeps the attempt it came from", async () => {
    const first = oid();
    const second = oid();

    await enqueue(first);
    await enqueue(second);

    const items = await openItems();
    const attempts = items.map((i) => String(i.source.attempt)).sort();
    expect(attempts).toEqual([String(first), String(second)].sort());
  });

  test("a later attempt does not overwrite an earlier attempt's metadata", async () => {
    const first = oid();
    const second = oid();

    await enqueue(first, [mistake({ misconception: "first misconception", questionIndex: 1 })]);
    await enqueue(second, [mistake({ misconception: "second misconception", questionIndex: 4 })]);

    const items = await openItems();
    const firstItem = items.find((i) => String(i.source.attempt) === String(first));
    const secondItem = items.find((i) => String(i.source.attempt) === String(second));

    expect(firstItem.metadata.misconception).toBe("first misconception");
    expect(firstItem.metadata.questionIndex).toBe(1);
    expect(secondItem.metadata.misconception).toBe("second misconception");
    expect(secondItem.metadata.questionIndex).toBe(4);
  });

  test("three attempts stay three items", async () => {
    await enqueue(oid());
    await enqueue(oid());
    await enqueue(oid());

    expect(await openItems()).toHaveLength(3);
  });

  // ─── Same-attempt convergence ───────────────────────────────────────────────

  test("repeated delivery of one attempt stays a single item", async () => {
    const attempt = oid();

    await enqueue(attempt);
    await enqueue(attempt);
    await enqueue(attempt);

    const items = await openItems();
    expect(items).toHaveLength(1);
    expect(String(items[0].source.attempt)).toBe(String(attempt));
  });

  test("distinct mistakes within one attempt are stored separately", async () => {
    await enqueue(oid(), [mistake({ topic: "Deadlock" }), mistake({ topic: "Paging", questionIndex: 5 })]);

    const items = await openItems();
    expect(items.map((i) => i.topic).sort()).toEqual(["Deadlock", "Paging"]);
  });

  // ─── Replay ─────────────────────────────────────────────────────────────────

  test("replaying an earlier attempt after a later one leaves both intact", async () => {
    const first = oid();
    const second = oid();

    await enqueue(first);
    await enqueue(second);
    await enqueue(first);
    await enqueue(first);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.filter((i) => String(i.source.attempt) === String(first))).toHaveLength(1);
    expect(items.filter((i) => String(i.source.attempt) === String(second))).toHaveLength(1);
  });

  // ─── The unique index is still enforcing identity ───────────────────────────

  test("a duplicate insert of the same identity is still refused by the index", async () => {
    const attempt = oid();
    await enqueue(attempt);

    // Inserted directly rather than through the upsert, so this bypasses the
    // filter under test and asks the index alone. If uniqueness had been
    // weakened to make the service's behaviour work, this would succeed.
    await expect(
      ReviewQueue.create({
        user,
        itemType: "failed_question",
        subject: "Operating Systems",
        topic: "Deadlock",
        title: "Fix misconception: Deadlock",
        priority: 80,
        status: "open",
        source: { quiz, attempt },
        // Question identity is part of the item, so a genuine duplicate has to
        // repeat it. Omitting it here would produce a different item, which the
        // widened index correctly permits.
        questionIndex: 2,
        metadata: { questionIndex: 2 },
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test("the same identity is allowed again once the item is completed", async () => {
    const attempt = oid();
    await enqueue(attempt);

    await ReviewQueue.updateMany(
      { user, status: "open" },
      { $set: { status: "completed", completedAt: new Date() } }
    );

    await enqueue(attempt);
    expect(await openItems()).toHaveLength(1);
  });

  // ─── A link added after creation must survive a replay ───────────────────────

  test("a linked failed-question item keeps its flashcard link across replays", async () => {
    const attempt = oid();
    await enqueue(attempt);

    // The exact update `createFlashcardSet` issues
    // (backend/services/flashcardService.js:236-242). Reproduced here rather
    // than called so the test drives real persistence without pulling the AI
    // flashcard generator into a queue test; the linker has its own coverage in
    // tests/unit/flashcardMistakes.test.js.
    const linkResult = await ReviewQueue.updateMany(
      {
        user,
        itemType: "failed_question",
        status: "open",
        "source.attempt": attempt,
        "source.flashcardSet": null,
      },
      { $set: { "source.flashcardSet": oid() } }
    );
    expect(linkResult.modifiedCount).toBe(1);

    const linkedSetId = String((await openItems())[0].source.flashcardSet);
    expect(linkedSetId).toBeDefined();

    // Three replays, as a redelivered SYNC_ATTEMPT would produce.
    await enqueue(attempt);
    await enqueue(attempt);
    await enqueue(attempt);

    const items = await openItems();
    expect(items).toHaveLength(1);
    expect(String(items[0].source.flashcardSet)).toBe(linkedSetId);
    expect(String(items[0].source.attempt)).toBe(String(attempt));
    expect(String(items[0].source.quiz)).toBe(String(quiz));
  });

  test("a replay refreshes producer content without touching the link", async () => {
    const attempt = oid();
    await enqueue(attempt, [mistake({ clarification: "first explanation" })]);

    const setId = oid();
    await ReviewQueue.updateMany(
      { user, itemType: "failed_question", status: "open", "source.attempt": attempt, "source.flashcardSet": null },
      { $set: { "source.flashcardSet": setId } }
    );

    await enqueue(attempt, [mistake({ clarification: "corrected explanation" })]);

    const [item] = await openItems();
    expect(item.metadata.clarification).toBe("corrected explanation");
    expect(String(item.source.flashcardSet)).toBe(String(setId));
  });

  test("a later attempt leaves an earlier attempt's link alone", async () => {
    const first = oid();
    const second = oid();
    await enqueue(first);

    const setId = oid();
    await ReviewQueue.updateMany(
      { user, itemType: "failed_question", status: "open", "source.attempt": first, "source.flashcardSet": null },
      { $set: { "source.flashcardSet": setId } }
    );

    await enqueue(second);
    await enqueue(first);

    const items = await openItems();
    expect(items).toHaveLength(2);

    const firstItem = items.find((i) => String(i.source.attempt) === String(first));
    const secondItem = items.find((i) => String(i.source.attempt) === String(second));

    expect(String(firstItem.source.flashcardSet)).toBe(String(setId));
    expect(String(firstItem.source.attempt)).toBe(String(first));
    expect(secondItem.source.flashcardSet ?? null).toBeNull();
  });

  // ─── One item per wrong question, enforced by the real index ────────────────

  test("one enqueue carrying two same-topic mistakes writes two items", async () => {
    const attemptId = oid();

    await enqueue(attemptId, [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.questionIndex).sort()).toEqual([1, 4]);
  });

  test("the same attempt reporting its two mistakes separately still yields two", async () => {
    const attemptId = oid();

    // Same attempt, same topic, one delivery per mistake.
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.map((i) => String(i.source.attempt))).toEqual([String(attemptId), String(attemptId)]);
  });

  test("replaying one same-topic mistake does not duplicate it", async () => {
    const attemptId = oid();
    const analyses = [mistake({ topic: "General", questionIndex: 1 })];

    await enqueue(attemptId, analyses);
    await enqueue(attemptId, analyses);
    await enqueue(attemptId, analyses);

    expect(await openItems()).toHaveLength(1);
  });

  test("two attempts asking the same question number stay distinct", async () => {
    await enqueue(oid(), [mistake({ topic: "General", questionIndex: 1 })]);
    await enqueue(oid(), [mistake({ topic: "General", questionIndex: 1 })]);

    expect(await openItems()).toHaveLength(2);
  });

  test("a failed question stores its question index as a first-class field", async () => {
    await enqueue(oid(), [mistake({ topic: "General", questionIndex: 4 })]);

    const [item] = await openItems();
    expect(item.questionIndex).toBe(4);
    // Still duplicated into metadata so the review UI's Q{n} badge is unaffected.
    expect(item.metadata.questionIndex).toBe(4);
  });

  test("a true duplicate of the same question is still refused by the index", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);

    // Bypasses the filter under test and asks the index alone.
    await expect(
      ReviewQueue.create({
        user,
        itemType: "failed_question",
        subject: "Operating Systems",
        topic: "General",
        title: "Fix misconception: General",
        priority: 80,
        status: "open",
        source: { quiz, attempt: attemptId },
        questionIndex: 1,
        metadata: { questionIndex: 1 },
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test("two questions on one named topic are both kept", async () => {
    await enqueue(oid(), [
      mistake({ topic: "Deadlock", questionIndex: 1 }),
      mistake({ topic: "Deadlock", questionIndex: 4 }),
    ]);

    const items = await openItems();
    expect(items.every((i) => i.questionIndex !== undefined)).toBe(true);
    expect(items.map((i) => i.questionIndex).sort()).toEqual([1, 4]);
  });

  // ─── Legacy adoption, against the real index ─────────────────────────────────

  /**
   * A row as it existed before `questionIndex` became part of the identity: no
   * top-level field, the question named only in `metadata`. Inserted directly so it
   * is exactly what an older deployment left behind.
   */
  const legacyItem = (attemptId, questionIndex, metadata = {}) =>
    ReviewQueue.create({
      user,
      itemType: "failed_question",
      subject: "Operating Systems",
      topic: "General",
      title: "Fix misconception: General",
      description: "legacy",
      priority: 80,
      status: "open",
      dueAt: new Date(),
      source: { quiz, attempt: attemptId, flashcardSet: null, flashcardId: null },
      metadata: { questionIndex, misconception: "legacy diagnosis", ...metadata },
    });

  test("a pre-identity row is adopted rather than duplicated", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const items = await openItems();
    expect(items).toHaveLength(1);
    expect(items[0].questionIndex).toBe(4);
  });

  test("the two-question case yields two rows, not three", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);

    await enqueue(attemptId, [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.questionIndex).sort()).toEqual([1, 4]);
  });

  test("adoption raises no E11000 under the live partial unique index", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);

    await expect(
      enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })])
    ).resolves.toBeDefined();
    expect(await openItems()).toHaveLength(1);
  });

  test("a true duplicate identified question is still refused after adoption", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    await expect(
      ReviewQueue.create({
        user,
        itemType: "failed_question",
        subject: "Operating Systems",
        topic: "General",
        title: "Fix misconception: General",
        priority: 80,
        status: "open",
        source: { quiz, attempt: attemptId },
        questionIndex: 4,
        metadata: { questionIndex: 4 },
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test("repeated replay leaves no extra open row", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);
    const analyses = [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ];

    await enqueue(attemptId, analyses);
    const afterFirst = (await openItems()).length;

    await enqueue(attemptId, analyses);
    await enqueue(attemptId, analyses);

    expect(afterFirst).toBe(2);
    expect(await openItems()).toHaveLength(afterFirst);
  });

  test("a legacy row for another question is not adopted", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, 4);

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.questionIndex == null)).toHaveLength(1);
  });

  test("a legacy row with no question in its metadata is never adopted", async () => {
    const attemptId = oid();
    await legacyItem(attemptId, undefined);

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.questionIndex == null)).toHaveLength(1);
  });

  test("adoption does not cross attempts", async () => {
    const first = oid();
    const second = oid();
    await legacyItem(first, 4);

    await enqueue(second, [mistake({ topic: "General", questionIndex: 4 })]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.filter((i) => String(i.source.attempt) === String(first) && i.questionIndex == null))
      .toHaveLength(1);
    expect(items.filter((i) => String(i.source.attempt) === String(second))).toHaveLength(1);
  });

  test("adoption preserves a flashcard link on the adopted row", async () => {
    const attemptId = oid();
    const setId = oid();
    await legacyItem(attemptId, 4);
    await ReviewQueue.updateMany(
      { user, itemType: "failed_question", status: "open", "source.attempt": attemptId },
      { $set: { "source.flashcardSet": setId } }
    );

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const [item] = await openItems();
    expect(String(item.source.flashcardSet)).toBe(String(setId));
    expect(item.questionIndex).toBe(4);
  });

  test("the topic item types are unaffected by adoption", async () => {
    const build = () =>
      ReviewQueue.findOneAndUpdate(
        { user, itemType: "weak_topic", topic: "Deadlock", status: "open" },
        {
          $set: {
            user, itemType: "weak_topic", topic: "Deadlock",
            title: "Review weak topic: Deadlock", source: {}, metadata: {},
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, new: true }
      );

    await build();
    await build();
    await build();

    expect(await openItems()).toHaveLength(1);
  });

  // ─── A learner snooze survives a real replay ─────────────────────────────────

  const isFuture = (d) => new Date(d).getTime() > Date.now();

  const snooze = async (questionIndex, hours = 48) => {
    const item = (await openItems()).find((i) => i.questionIndex === questionIndex);
    await snoozeReviewQueueItem({ userId: user, itemId: item._id, hours });
    return item._id;
  };

  test("a snoozed question keeps its future due date and demoted priority", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);
    const id = await snooze(4, 48);

    const before = await ReviewQueue.findById(id).lean();
    expect(isFuture(before.dueAt)).toBe(true);
    expect(before.priority).toBe(40);

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const after = await ReviewQueue.findById(id).lean();
    expect(isFuture(after.dueAt)).toBe(true);
    expect(new Date(after.dueAt).getTime()).toBe(new Date(before.dueAt).getTime());
    expect(after.priority).toBe(40);
  });

  test("three replays leave exactly one open row, still snoozed", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);
    const id = await snooze(4);

    for (let i = 0; i < 3; i++) {
      await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);
    }

    expect(await openItems()).toHaveLength(1);
    const item = await ReviewQueue.findById(id).lean();
    expect(isFuture(item.dueAt)).toBe(true);
    expect(item.priority).toBe(40);
  });

  test("an unsnoozed question still gets the producer's scheduling", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);

    const [item] = await openItems();
    expect(isFuture(item.dueAt)).toBe(false);
    expect(item.priority).toBe(80);
  });

  test("a snoozed question does not protect its sibling", async () => {
    const attemptId = oid();
    const analyses = [
      mistake({ topic: "General", questionIndex: 1 }),
      mistake({ topic: "General", questionIndex: 4 }),
    ];
    await enqueue(attemptId, analyses);
    await snooze(4);

    await enqueue(attemptId, analyses);

    const items = await openItems();
    expect(items).toHaveLength(2);
    const snoozedItem = items.find((i) => i.questionIndex === 4);
    const sibling = items.find((i) => i.questionIndex === 1);
    expect(isFuture(snoozedItem.dueAt)).toBe(true);
    expect(snoozedItem.priority).toBe(40);
    expect(isFuture(sibling.dueAt)).toBe(false);
    expect(sibling.priority).toBe(80);
  });

  test("another attempt's identical question is unaffected", async () => {
    await enqueue(oid(), [mistake({ topic: "General", questionIndex: 4 })]);
    await snooze(4);

    await enqueue(oid(), [mistake({ topic: "General", questionIndex: 4 })]);

    const items = await openItems();
    expect(items).toHaveLength(2);
    expect(items.filter((i) => isFuture(i.dueAt))).toHaveLength(1);
  });

  test("a snoozed question keeps its flashcard link across replay", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);
    const id = await snooze(4);
    const setId = oid();
    await ReviewQueue.updateMany(
      { user, itemType: "failed_question", status: "open", "source.attempt": attemptId },
      { $set: { "source.flashcardSet": setId } }
    );

    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);

    const item = await ReviewQueue.findById(id).lean();
    expect(String(item.source.flashcardSet)).toBe(String(setId));
    expect(isFuture(item.dueAt)).toBe(true);
    expect(item.priority).toBe(40);
  });

  // ─── A topic snooze survives a real rebuild ─────────────────────────────────

  const topicFixture = (overrides = {}) => ({
    topic: "Deadlock",
    subject: "Operating Systems",
    attempted: 3,
    mastery: 30,
    confidence: 40,
    weaknessScore: 70,
    reviewCount: 0,
    lastWrongAt: null,
    lastPracticedAt: new Date(Date.now() - 60 * 60 * 1000),
    recommendedDifficulty: "Easy",
    ...overrides,
  });

  const withProgressTopics = async (topics) => {
    await UserProgress.deleteMany({ user });
    await UserProgress.create({ user, totals: {}, topics });
    await rebuildReviewQueueForUser(user);
  };

  const topicRow = async (topic = "Deadlock") =>
    (await openItems()).find((i) => i.topic === topic && i.itemType.endsWith("_topic"));

  beforeEach(async () => {
    await UserProgress.deleteMany({ user });
  });

  afterAll(async () => {
    if (connected) await UserProgress.deleteMany({ user });
  });

  test("a snoozed topic item keeps its future due date and priority", async () => {
    await withProgressTopics([topicFixture()]);
    const row = await topicRow();
    await snoozeReviewQueueItem({ userId: user, itemId: row._id, hours: 48 });
    const before = await ReviewQueue.findById(row._id).lean();
    expect(isFuture(before.dueAt)).toBe(true);
    expect(before.priority).toBe(40);

    await rebuildReviewQueueForUser(user);

    const after = await ReviewQueue.findById(row._id).lean();
    expect(isFuture(after.dueAt)).toBe(true);
    expect(new Date(after.dueAt).getTime()).toBe(new Date(before.dueAt).getTime());
    expect(after.priority).toBe(40);
  });

  test("repeated rebuilds do not resurface or duplicate the item", async () => {
    await withProgressTopics([topicFixture()]);
    const row = await topicRow();
    await snoozeReviewQueueItem({ userId: user, itemId: row._id, hours: 48 });

    await rebuildReviewQueueForUser(user);
    await rebuildReviewQueueForUser(user);
    await rebuildReviewQueueForUser(user);

    expect(await openItems()).toHaveLength(1);
    const after = await ReviewQueue.findById(row._id).lean();
    expect(isFuture(after.dueAt)).toBe(true);
    expect(after.priority).toBe(40);
  });

  test("an unsnoozed topic item still receives the rebuild's scheduling", async () => {
    await withProgressTopics([topicFixture()]);

    await rebuildReviewQueueForUser(user);

    const after = await topicRow();
    expect(isFuture(after.dueAt)).toBe(false);
    expect(after.priority).toBe(70);
  });

  test("a falling rebuild priority is written rather than frozen", async () => {
    await withProgressTopics([topicFixture()]);
    expect((await topicRow()).priority).toBe(70);

    await withProgressTopics([topicFixture({ mastery: 50, weaknessScore: 30 })]);

    expect((await topicRow()).priority).toBe(60);
  });

  test("topics are independent: one snoozed, one rebuilding", async () => {
    await withProgressTopics([
      topicFixture(),
      topicFixture({ topic: "Paging", weaknessScore: 60 }),
    ]);
    const deadlocked = await topicRow("Deadlock");
    await snoozeReviewQueueItem({ userId: user, itemId: deadlocked._id, hours: 48 });

    await rebuildReviewQueueForUser(user);

    expect(isFuture((await topicRow("Deadlock")).dueAt)).toBe(true);
    expect(isFuture((await topicRow("Paging")).dueAt)).toBe(false);
    expect((await topicRow("Paging")).priority).toBe(60);
  });

  test("the itemType classification is unchanged by the preservation path", async () => {
    await withProgressTopics([
      topicFixture({ topic: "Confident", confidence: 80, weaknessScore: 50 }),
      topicFixture({ topic: "Anxious", confidence: 40, weaknessScore: 10 }),
    ]);

    await rebuildReviewQueueForUser(user);

    expect((await topicRow("Confident")).itemType).toBe("weak_topic");
    expect((await topicRow("Anxious")).itemType).toBe("low_confidence_topic");
  });

  test("a failed-question snooze is unaffected by the topic path", async () => {
    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 4 })]);
    const [item] = await openItems();
    await snoozeReviewQueueItem({ userId: user, itemId: item._id, hours: 48 });

    await withProgressTopics([topicFixture()]);
    await rebuildReviewQueueForUser(user);

    const after = await ReviewQueue.findById(item._id).lean();
    expect(isFuture(after.dueAt)).toBe(true);
    expect(after.priority).toBe(40);
  });

  // ─── The deployment trap ───────────────────────────────────────────────────
  //
  // Mongoose's automatic index build only ever calls createIndex, so widening the
  // unique index's key spec leaves the superseded coarse index in place -- still
  // unique, still enforced, and still rejecting the insert this change exists to
  // permit. A schema edit alone would therefore deploy successfully, pass every
  // test that runs against a fresh database, and change nothing in production.
  //
  // This test reproduces that state deliberately.

  const COARSE_INDEX = {
    user: 1,
    itemType: 1,
    topic: 1,
    "source.quiz": 1,
    "source.attempt": 1,
    "source.flashcardSet": 1,
    "source.flashcardId": 1,
  };

  /**
   * Restores exactly the index state a pre-fix deployment would have: the coarse
   * unique index, and no question-aware one. Anything else would not be the bug.
   */
  const restorePreFixIndexes = async () => {
    const existing = await ReviewQueue.collection.indexes();
    for (const index of existing) {
      if (index.unique && index.name !== COARSE_INDEX_NAME) {
        await ReviewQueue.collection.dropIndex(index.name);
      }
    }
    const now = await ReviewQueue.collection.indexes();
    if (!now.some((i) => i.name === COARSE_INDEX_NAME)) {
      await ReviewQueue.collection.createIndex(COARSE_INDEX, {
        unique: true,
        partialFilterExpression: { status: "open" },
      });
    }
  };

  test("a coarse index left behind by an earlier deploy is dropped by reconciliation", async () => {
    // Recreate the pre-fix deployment state.
    await restorePreFixIndexes();

    const before = (await ReviewQueue.collection.indexes()).filter((i) => i.unique);
    expect(before).toHaveLength(1);
    expect(before[0].name).toBe(COARSE_INDEX_NAME);

    // What `npm run indexes:sync` performs.
    await ReviewQueue.syncIndexes();

    const after = (await ReviewQueue.collection.indexes()).filter((i) => i.unique);
    expect(after).toHaveLength(1);
    expect(after[0].name).not.toBe(COARSE_INDEX_NAME);
    expect(after[0].key.questionIndex).toBe(1);
  });

  test("without reconciliation the coarse index still blocks the second question", async () => {
    await restorePreFixIndexes();
    await ReviewQueue.collection.createIndex(
      { ...COARSE_INDEX, questionIndex: 1 },
      { unique: true, partialFilterExpression: { status: "open" } },
    );

    const attemptId = oid();
    await enqueue(attemptId, [mistake({ topic: "General", questionIndex: 1 })]);
    // Two identical-filter upserts would race here; the coarse index is what makes
    // the second one fail outright rather than create the row.
    await expect(
      ReviewQueue.collection.insertOne({
        user,
        itemType: "failed_question",
        topic: "General",
        title: "Fix misconception: General",
        status: "open",
        source: { quiz, attempt: attemptId, flashcardSet: null, flashcardId: null },
        metadata: { questionIndex: 4 },
      })
    ).rejects.toMatchObject({ code: 11000 });

    // Leaving the collection reconciled so later assertions are not affected.
    await ReviewQueue.syncIndexes();
  });

  test("items without an attempt are still deduplicated by topic", async () => {
    const build = () =>
      ReviewQueue.findOneAndUpdate(
        { user, itemType: "weak_topic", topic: "Deadlock", status: "open" },
        {
          $set: {
            user,
            itemType: "weak_topic",
            topic: "Deadlock",
            title: "Review weak topic: Deadlock",
            source: {},
            metadata: {},
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, new: true }
      );

    await build();
    await build();
    await build();

    expect(await openItems()).toHaveLength(1);
  });
});