import FlashcardSet from "../models/FlashcardSet.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import UserProgress from "../models/UserProgress.js";
import { recordLearningEvent } from "./learningEventService.js";
import { listReviewQueue, rebuildReviewQueueForUser } from "./reviewQueueService.js";
import { jobQueue } from "../utils/jobQueue.js";
import logger from "../utils/logger.js";

const percent = (value) => Math.round(Number(value || 0));

const readinessFor = (topics) => {
  if (!topics.length) return 0;
  const mastery = topics.reduce((sum, topic) => sum + (topic.mastery || 0), 0) / topics.length;
  const confidence = topics.reduce((sum, topic) => sum + (topic.confidence || 0), 0) / topics.length;
  const weaknessDrag = topics.reduce((sum, topic) => sum + (topic.weaknessScore || 0), 0) / topics.length;
  return Math.max(0, Math.min(100, Math.round(mastery * 0.55 + confidence * 0.3 + (100 - weaknessDrag) * 0.15)));
};

export const getRecommendationSnapshot = async (userId) => {
  const now = new Date();
  const [progress, recentAttempt, quizCount, dueFlashcardSets] = await Promise.all([
    UserProgress.findOne({ user: userId }).lean(),
    QuizAttempt.findOne({ user: userId }).sort({ createdAt: -1 }).populate("quiz", "title").lean(),
    Quiz.countDocuments({ user: userId }),
    FlashcardSet.find({
      user: userId,
      $or: [
        { "cards.review.nextReviewAt": { $lte: now } },
        { "cards.review.dueAt": { $lte: now } },
      ],
    }).select("title cards.topic cards.review").lean(),
  ]);

  // This refresh is advisory: preserve dashboard availability if Redis is down,
  // while deduplicating concurrent dashboard reads for the same learner.
  void jobQueue.enqueue(`Rebuild Review Queue - User ${userId}`, {
    type: "REBUILD_REVIEW_QUEUE",
    data: { userId },
  }, {
    deduplicationId: `rebuild-review-queue:${userId}`,
  }).catch((error) => {
    logger.warn("[Recommendations] Review queue refresh was not scheduled.", {
      userId,
      error: error.message,
    });
  });
  const reviewQueueResult = await listReviewQueue(userId, { limit: 8 });
  const reviewQueue = reviewQueueResult.items;

  const topics = progress?.topics || [];
  const weakestTopic = topics
    .filter((topic) => topic.attempted > 0)
    .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))[0] || null;
  const lowConfidenceTopic = topics
    .filter((topic) => topic.attempted > 0)
    .sort((a, b) => (a.confidence || 0) - (b.confidence || 0))[0] || null;

  const dueFlashcards = dueFlashcardSets.reduce((count, set) => {
    return count + set.cards.filter((card) => {
      const dueAt = card.review?.nextReviewAt || card.review?.dueAt;
      return dueAt && new Date(dueAt) <= now;
    }).length;
  }, 0);

  const readinessScore = readinessFor(topics);
  const retentionTrend = topics.length
    ? percent(topics.reduce((sum, topic) => {
      const practicedAt = topic.lastPracticedAt ? new Date(topic.lastPracticedAt) : null;
      const days = practicedAt ? Math.max(0, (now - practicedAt) / (1000 * 60 * 60 * 24)) : 30;
      return sum + Math.max(0, (topic.confidence || 0) - days * 2);
    }, 0) / topics.length)
    : 0;

  const recommendedQuiz = weakestTopic
    ? {
      title: `${weakestTopic.recommendedDifficulty || "Easy"} practice: ${weakestTopic.topic}`,
      topic: weakestTopic.topic,
      difficulty: weakestTopic.recommendedDifficulty || "Easy",
      reason: `Weakness score ${percent(weakestTopic.weaknessScore)} with ${percent(weakestTopic.confidence)}% confidence.`,
      href: "/assessments/create",
    }
    : null;

  const suggestedRevision = reviewQueue[0]
    ? {
      title: reviewQueue[0].title,
      description: reviewQueue[0].description,
      priority: reviewQueue[0].priority,
      href: reviewQueue[0].itemType.includes("flashcard") || reviewQueue[0].itemType === "overdue_review"
        ? "/flashcards"
        : "/analytics",
    }
    : quizCount === 0
      ? {
        title: "Upload your first study material",
        description: "Generate an assessment so AthenaeumAI can begin modeling your mastery.",
        priority: 30,
        href: "/assessments/create",
      }
      : {
        title: "Continue with a fresh assessment",
        description: "No urgent revision is queued. Add more attempts to refine recommendations.",
        priority: 20,
        href: "/assessments/create",
      };

  const optimalNextAction = dueFlashcards > 0
    ? {
      type: "review_due",
      label: "Review Today",
      message: `${dueFlashcards} flashcard${dueFlashcards === 1 ? "" : "s"} due. Clear recall work before generating new questions.`,
      href: "/flashcards",
    }
    : weakestTopic
      ? {
        type: "weak_topic_revision",
        label: "High Priority Revision",
        message: `Focus on ${weakestTopic.topic}; confidence is ${percent(weakestTopic.confidence)}%.`,
        href: "/analytics",
      }
      : {
        type: "continue_studying",
        label: "Continue Studying",
        message: recentAttempt?.quiz?.title
          ? `Continue from ${recentAttempt.quiz.title}.`
          : "Upload material or generate an assessment to begin.",
        href: quizCount ? "/assessments" : "/assessments/create",
      };

  return {
    readinessScore,
    retentionTrend,
    reviewDueToday: dueFlashcards,
    weakestTopic: weakestTopic
      ? {
        topic: weakestTopic.topic,
        mastery: percent(weakestTopic.mastery),
        confidence: percent(weakestTopic.confidence),
        weaknessScore: percent(weakestTopic.weaknessScore),
        recommendedDifficulty: weakestTopic.recommendedDifficulty,
      }
      : null,
    lowConfidenceTopic: lowConfidenceTopic
      ? {
        topic: lowConfidenceTopic.topic,
        confidence: percent(lowConfidenceTopic.confidence),
      }
      : null,
    recommendedQuiz,
    suggestedRevision,
    optimalNextAction,
    continueStudying: {
      title: recentAttempt?.quiz?.title || "Start your adaptive learning loop",
      href: recentAttempt?.quiz?._id ? `/assessments/${recentAttempt.quiz._id}` : "/assessments/create",
      lastAttemptAt: recentAttempt?.createdAt || null,
    },
    reviewQueue,
  };
};

export const recordRecommendationFollowed = async ({ userId, recommendationType, topic = "General", metadata = {} }) => {
  return recordLearningEvent({
    userId,
    topic,
    eventType: "recommendation_followed",
    result: "completed",
    metadata: {
      recommendationType,
      ...metadata,
    },
  });
};
