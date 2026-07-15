import FlashcardSet from "../models/FlashcardSet.js";
import ReviewQueue from "../models/ReviewQueue.js";
import UserProgress from "../models/UserProgress.js";
import { recordLearningEvent } from "./learningEventService.js";

const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

const upsertOpenQueueItem = async (item) => {
  const filter = {
    user: item.user,
    itemType: item.itemType,
    topic: item.topic || "General",
    status: "open",
  };

  if (item.source?.quiz) filter["source.quiz"] = item.source.quiz;
  if (item.source?.flashcardSet) filter["source.flashcardSet"] = item.source.flashcardSet;
  if (item.source?.flashcardId) filter["source.flashcardId"] = item.source.flashcardId;

  return ReviewQueue.findOneAndUpdate(
    filter,
    { $set: item, $setOnInsert: { createdAt: new Date() } },
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
