import FlashcardSet from "../models/FlashcardSet.js";
import ReviewQueue from "../models/ReviewQueue.js";
import UserProgress from "../models/UserProgress.js";
import { recordLearningEvent } from "./learningEventService.js";

const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

// A `failed_question` item is the record of one mistake made on one attempt, so
// the attempt is part of its identity. The producer always supplies one
// (`source.attempt: attempt._id`), and the open-item unique index already
// includes `source.attempt` for the same reason.
//
// Without this guard such an item would collapse to null at the index, where a
// second attempt's identical mistake raises E11000 -- an opaque failure for what
// is really a missing attribution.
const ATTEMPT_SCOPED_ITEM_TYPES = new Set(["failed_question"]);

// The `source` fields declared on the ReviewQueue schema.
const SOURCE_FIELDS = ["quiz", "attempt", "flashcardSet", "flashcardId"];

// Topic-derived review items. Listed separately from ATTEMPT_SCOPED_ITEM_TYPES
// because their snooze needs a different mechanism, not because they share one.
const TOPIC_ITEM_TYPES = new Set(["weak_topic", "low_confidence_topic"]);

/**
 * A snoozed item is still `open` with a future `dueAt`; that is the only signal
 * there is, since there is no snoozed status. Shared by the topic path below and
 * asserted by the tests, so the definition lives with the behaviour it describes.
 */
const isSnoozed = (dueAt) => Boolean(dueAt) && new Date(dueAt).getTime() > Date.now();

const upsertOpenQueueItem = async (item) => {
  if (ATTEMPT_SCOPED_ITEM_TYPES.has(item.itemType) && !item.source?.attempt) {
    const error = new Error(
      `A ${item.itemType} review item requires source.attempt to identify the attempt it came from`
    );
    error.status = 422;
    throw error;
  }

  const filter = {
    user: item.user,
    itemType: item.itemType,
    topic: item.topic || "General",
    status: "open",
  };

  if (item.source?.quiz) filter["source.quiz"] = item.source.quiz;
  // Part of the identity, matching the open-item unique index. Omitted when the
  // item carries no attempt, so topic and flashcard items keep deduplicating
  // across attempts exactly as before.
  if (item.source?.attempt) filter["source.attempt"] = item.source.attempt;
  // Part of the identity for the same reason, and omitted when absent so the four
  // item types that are not scoped to a question keep deduplicating by topic
  // exactly as before. Matches the open-item unique index.
  if (item.questionIndex !== undefined && item.questionIndex !== null) {
    filter.questionIndex = item.questionIndex;
  }
  if (item.source?.flashcardSet) filter["source.flashcardSet"] = item.source.flashcardSet;
  if (item.source?.flashcardId) filter["source.flashcardId"] = item.source.flashcardId;

  // `source` is written key by key rather than as one subdocument, because not
  // every caller supplies all of it. `enqueueFailedQuestionItems` sends only
  // { quiz, attempt } and knows nothing about flashcards, so assigning its
  // `source` wholesale would erase a link that `createFlashcardSet` added after
  // the item was created -- and every SYNC_ATTEMPT replay re-runs that enqueue,
  // because a duplicate delivery is not evidence that the queue effects ran.
  //
  // Nothing legitimately clears a `source` field here: no caller sends a field
  // it intends to unset, so absent means "not mine to write" rather than
  // "remove it". Writing only what the caller owns still refreshes the
  // producer's own content on replay.
  const { source, ...ownedFields } = item;
  const $set = { ...ownedFields };
  for (const key of SOURCE_FIELDS) {
    if (source?.[key]) $set[`source.${key}`] = source[key];
  }

  // A snooze is "push the date forward and demote the priority". Carrying those two
  // fields in $max/$min rather than $set means a replay cannot undo it: the later
  // date and the lower priority win, which is exactly what the learner asked for,
  // while every other field is still refreshed normally.
  //
  // Scoped to the attempt-scoped item types deliberately. A topic item's dueAt is
  // recomputed from progress on every rebuild and must keep being overwritten; a
  // flashcard item's dueAt mirrors the card's own SM-2 schedule and must keep
  // tracking it. Only a failed question is snoozed by the learner and has no
  // scheduler behind it.
  //
  // Applied to every write below, not only the creating one: during a replay the
  // identifying lookup is the write that lands on the existing row, so omitting
  // these operators there would preserve the snooze only on the inserting paths.
  //
  // Done inside the same atomic findOneAndUpdate rather than by reading the row
  // first: no extra round trip, and no window in which a snooze landing between a
  // read and a write would still be overwritten. A field may not appear in two
  // operators, so these two leave $set for these item types only.
  const update = { $set };
  if (ATTEMPT_SCOPED_ITEM_TYPES.has(item.itemType)) {
    const { dueAt, priority, ...withoutScheduling } = $set;
    update.$set = withoutScheduling;
    update.$max = { dueAt };
    update.$min = { priority };
  }

  // A topic item's `dueAt` is its only scheduling state -- nothing outside the
  // queue computes it -- so a snooze applied to one is the only record of that
  // decision, and a rebuild would otherwise throw it away on every dashboard load.
  //
  // The mechanism is deliberately not the `$max`/`$min` pair used for a failed
  // question. `dueAt` alone could reuse `$max`, since the rebuild value is always
  // `now`; `priority` cannot, because it is computed per rebuild and can fall below
  // the 40 a snooze forces -- `$min` would destroy the demotion and, worse, freeze
  // an unsnoozed row's priority precisely when the learner improves. So the
  // decision is taken from the stored row and the fields are simply left out of the
  // payload, which keeps the single findOneAndUpdate that does the write.
  //
  // Costs one extra read per topic item per rebuild, in a background job. The
  // atomic alternative is an aggregation-pipeline update with `$cond`, which would
  // change the update shape for all three writes including the upsert, where a
  // pipeline has to rebuild a missing document out of the filter. Not worth it.
  //
  // A snooze landing between the read and the write would still be overwritten; that
  // window is one round trip, and closing it needs the conditional update above.
  if (TOPIC_ITEM_TYPES.has(item.itemType)) {
    const existing = await ReviewQueue.findOne(filter).lean();
    if (isSnoozed(existing?.dueAt)) {
      const { dueAt, priority, ...withoutScheduling } = update.$set;
      update.$set = withoutScheduling;
    }
  }

  const hasQuestionIdentity =
    item.questionIndex !== undefined && item.questionIndex !== null;

  // 1. The ordinary path. Split from the upsert so a miss is observable: an upsert
  //    would create the row we may still be able to adopt instead.
  const identified = await ReviewQueue.findOneAndUpdate(filter, update, { new: true });
  if (identified) return identified;

  // 2. A row written before `questionIndex` became part of the identity carries
  //    the question only in `metadata`, so it indexes as null and matched nothing
  //    above. Replay would otherwise insert a second row for the same question,
  //    and because the old row still holds `metadata.questionIndex` the review
  //    page would render two cards with the same `Q{n}`.
  //
  //    Run only after an identified-row miss, never before: Task 64's own upsert
  //    can leave a legacy row and an identified row coexisting for one question
  //    (their index keys differ), and adopting first would then set a
  //    `questionIndex` that the unique index already holds elsewhere.
  if (hasQuestionIdentity && item.source?.quiz && item.source?.attempt) {
    const adopted = await ReviewQueue.findOneAndUpdate(
      {
        user: item.user,
        itemType: item.itemType,
        status: "open",
        topic: filter.topic,
        "source.quiz": item.source.quiz,
        "source.attempt": item.source.attempt,
        // Equality-matches absent and null identically, which is the same
        // semantics the unique index relies on, so this selects only rows that
        // predate the field.
        questionIndex: null,
        "metadata.questionIndex": item.questionIndex,
      },
      update,
      { new: true }
    );
    if (adopted) return adopted;
  }

  // 3. Nothing to adopt: create the row as before. The filter is reused verbatim,
  //    so a row written concurrently between the steps is matched here rather
  //    than duplicated.
  return ReviewQueue.findOneAndUpdate(
    filter,
    { ...update, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, new: true }
  );
};

export const enqueueFailedQuestionItems = async ({ userId, quiz, attempt, mistakeAnalyses }) => {
  const items = mistakeAnalyses.map((analysis) => ({
    user: userId,
    itemType: "failed_question",
    subject: quiz.subject || "",
    topic: analysis.topic || "General",
    title: `Fix misconception: ${analysis.topic || "General"}`,
    description: analysis.revisionSuggestion || analysis.clarification,
    priority: 80,
    dueAt: new Date(),
    source: {
      quiz: quiz._id,
      attempt: attempt._id,
    },
    // Two mistakes in one attempt can share a topic -- and when the generator
    // omits a topic they all normalise to "General" -- so without this the second
    // upsert matched and overwrote the first, losing a diagnosis. Also written
    // into `metadata` below as a deliberate denormalisation, so the review UI
    // keeps rendering its `Q{n}` badge with no frontend change.
    questionIndex: analysis.questionIndex,
    metadata: {
      questionIndex: analysis.questionIndex,
      misconception: analysis.misconception,
      clarification: analysis.clarification,
      distractorReason: analysis.distractorReason,
      relatedFlashcards: analysis.relatedFlashcards,
    },
  }));

  return Promise.all(items.map(upsertOpenQueueItem));
};

export const rebuildReviewQueueForUser = async (userId) => {
  const now = new Date();
  const progress = await UserProgress.findOne({ user: userId }).lean();
  const topics = progress?.topics || [];

  const topicItems = topics
    .filter((topic) => topic.attempted > 0 && ((topic.weaknessScore || 0) > 35 || (topic.confidence || 0) < 55))
    .slice(0, 12)
    .map((topic) => ({
      user: userId,
      itemType: (topic.confidence || 0) < 55 ? "low_confidence_topic" : "weak_topic",
      subject: topic.subject || "",
      topic: topic.topic,
      title: (topic.confidence || 0) < 55 ? `Rebuild confidence: ${topic.topic}` : `Review weak topic: ${topic.topic}`,
      description: `Mastery ${topic.mastery || 0}%, confidence ${topic.confidence || 0}%, weakness ${topic.weaknessScore || 0}%.`,
      priority: Math.max(topic.weaknessScore || 0, 100 - (topic.confidence || 0)),
      dueAt: now,
      source: {},
      metadata: {
        mastery: topic.mastery,
        confidence: topic.confidence,
        weaknessScore: topic.weaknessScore,
        recommendedDifficulty: topic.recommendedDifficulty,
      },
    }));

  const dueSets = await FlashcardSet.find({
    user: userId,
    $or: [
      { "cards.review.nextReviewAt": { $lte: now } },
      { "cards.review.dueAt": { $lte: now } },
    ],
  }).lean();

  const flashcardItems = [];
  dueSets.forEach((set) => {
    set.cards.forEach((card) => {
      const dueAt = card.review?.nextReviewAt || card.review?.dueAt;
      if (!dueAt || new Date(dueAt) > now) return;

      const daysOverdue = Math.max(0, (now - new Date(dueAt)) / (1000 * 60 * 60 * 24));
      flashcardItems.push({
        user: userId,
        itemType: daysOverdue >= 1 ? "overdue_review" : "due_flashcard",
        subject: "",
        topic: card.topic || "General",
        title: `${daysOverdue >= 1 ? "Overdue" : "Due"} flashcard: ${card.topic || "General"}`,
        description: card.front,
        priority: Math.round(55 + daysOverdue * 8),
        dueAt: new Date(dueAt),
        source: {
          flashcardSet: set._id,
          flashcardId: card._id,
        },
        metadata: {
          setTitle: set.title,
          interval: card.review?.interval || card.review?.intervalDays || 0,
          repetitions: card.review?.repetitions || 0,
        },
      });
    });
  });

  await Promise.all([...topicItems, ...flashcardItems].map(upsertOpenQueueItem));
  return listReviewQueue(userId);
};

export const listReviewQueue = async (userId, { page = 1, limit = 20 } = {}) => {
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [items, total] = await Promise.all([
    ReviewQueue.find({ user: userId, status: "open" })
      .sort({ priority: -1, dueAt: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ReviewQueue.countDocuments({ user: userId, status: "open" }),
  ]);

  return {
    items,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
};

export const completeReviewQueueItem = async ({ userId, itemId }) => {
  const item = await ReviewQueue.findOneAndUpdate(
    { _id: itemId, user: userId, status: "open" },
    { status: "completed", completedAt: new Date() },
    { new: true }
  );

  if (!item) {
    const error = new Error("Review queue item not found");
    error.status = 404;
    throw error;
  }

  await recordLearningEvent({
    userId,
    subject: item.subject,
    topic: item.topic,
    eventType: "revision_completed",
    result: "completed",
    confidence: item.metadata?.confidence || 0,
    difficulty: item.metadata?.recommendedDifficulty || "",
    metadata: {
      reviewQueueId: item._id,
      itemType: item.itemType,
      priority: item.priority,
    },
  });

  return item;
};

export const snoozeReviewQueueItem = async ({ userId, itemId, hours = 24 }) => {
  const item = await ReviewQueue.findOneAndUpdate(
    { _id: itemId, user: userId, status: "open" },
    { dueAt: nowPlusHours(hours), priority: 40 },
    { new: true }
  );

  if (!item) {
    const error = new Error("Review queue item not found");
    error.status = 404;
    throw error;
  }

  return item;
};
