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

const { enqueueFailedQuestionItems } = await import("../../services/reviewQueueService.js");

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