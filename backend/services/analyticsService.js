import FlashcardSet from "../models/FlashcardSet.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import StudyMaterial from "../models/StudyMaterial.js";
import UserProgress from "../models/UserProgress.js";

const toPercent = (value) => Math.round(Number(value || 0));

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const getDashboardAnalytics = async (userId) => {
  const since = new Date();
  since.setDate(since.getDate() - 29);

  const now = new Date();
  const [progress, attempts, recentQuizzes, materialCount, flashcardCount, dueFlashcardSets] = await Promise.all([
    UserProgress.findOne({ user: userId }).lean(),
    QuizAttempt.find({ user: userId, createdAt: { $gte: since } })
      .populate("quiz", "title difficulty questionCount subject")
      .sort({ createdAt: 1 })
      .lean(),
    Quiz.find({ user: userId })
      .select("title difficulty questionCount sourceFileName subject createdAt studyMaterial")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    StudyMaterial.countDocuments({ user: userId }),
    FlashcardSet.countDocuments({ user: userId }),
    FlashcardSet.find({
      user: userId,
      $or: [
        { "cards.review.nextReviewAt": { $lte: now } },
        { "cards.review.dueAt": { $lte: now } },
      ],
    }).select("cards.review title").lean(),
  ]);

  const dayBuckets = new Map();
  for (let i = 29; i >= 0; i -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const key = startOfDay(day).toISOString().slice(0, 10);
    dayBuckets.set(key, { day: key.slice(5), scoreTotal: 0, attempts: 0 });
  }

  attempts.forEach((attempt) => {
    const key = startOfDay(attempt.createdAt).toISOString().slice(0, 10);
    const bucket = dayBuckets.get(key);
    if (bucket) {
      bucket.scoreTotal += attempt.accuracy;
      bucket.attempts += 1;
    }
  });

  const accuracyTrend = Array.from(dayBuckets.values()).map((bucket) => ({
    day: bucket.day,
    score: bucket.attempts ? Math.round(bucket.scoreTotal / bucket.attempts) : null,
  }));

  const topics = progress?.topics || [];
  const weakTopics = topics
    .filter((topic) => topic.attempted >= 1 && ((topic.weaknessScore || 0) > 35 || topic.mastery < 65))
    .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))
    .slice(0, 6)
    .map((topic) => ({
      topic: topic.topic,
      subject: topic.subject,
      accuracy: toPercent(topic.mastery),
      confidence: toPercent(topic.confidence),
      weaknessScore: toPercent(topic.weaknessScore),
      attempted: topic.attempted,
      reviewCount: topic.reviewCount || 0,
      recommendedDifficulty: topic.recommendedDifficulty,
    }));

  const topicMastery = topics
    .slice()
    .sort((a, b) => b.attempted - a.attempted)
    .slice(0, 8)
    .map((topic) => ({
      topic: topic.topic.length > 16 ? `${topic.topic.slice(0, 15)}...` : topic.topic,
      fullTopic: topic.topic,
      value: toPercent(topic.mastery),
      weaknessScore: toPercent(topic.weaknessScore),
    }));

  const bestTopic = topics
    .filter((topic) => topic.attempted > 0)
    .sort((a, b) => b.mastery - a.mastery)[0] || null;
  const weakestTopic = topics
    .filter((topic) => topic.attempted > 0)
    .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))[0] || null;

  const averageAccuracy = progress?.totals?.averageAccuracy || 0;
  const reviewDueToday = dueFlashcardSets.reduce((count, set) => {
    return count + set.cards.filter((card) => {
      const nextReviewAt = card.review?.nextReviewAt || card.review?.dueAt;
      return nextReviewAt && new Date(nextReviewAt) <= now;
    }).length;
  }, 0);
  const averageMastery = topics.length
    ? Math.round(topics.reduce((sum, topic) => sum + (topic.mastery || 0), 0) / topics.length)
    : 0;
  const averageConfidence = topics.length
    ? Math.round(topics.reduce((sum, topic) => sum + (topic.confidence || 0), 0) / topics.length)
    : 0;
  const retentionScore = topics.length
    ? Math.round(topics.reduce((sum, topic) => {
      const lastPracticedAt = topic.lastPracticedAt ? new Date(topic.lastPracticedAt) : null;
      const daysSincePractice = lastPracticedAt
        ? Math.max(0, (now - lastPracticedAt) / (1000 * 60 * 60 * 24))
        : 30;
      const retention = Math.max(0, (topic.confidence || 0) - daysSincePractice * 2.2);
      return sum + retention;
    }, 0) / topics.length)
    : 0;
  const estimatedReadiness = Math.round((averageMastery * 0.55) + (averageConfidence * 0.25) + (retentionScore * 0.2));
  const recommendedNextAction = reviewDueToday > 0
    ? {
      type: "review-due",
      message: `${reviewDueToday} flashcard${reviewDueToday === 1 ? "" : "s"} due today. Clear review queue before new practice.`,
      href: "/flashcards",
    }
    : weakestTopic
      ? {
        type: "adaptive-quiz",
        topic: weakestTopic.topic,
        difficulty: weakestTopic.recommendedDifficulty,
        message: `Generate ${weakestTopic.recommendedDifficulty.toLowerCase()} practice around ${weakestTopic.topic}.`,
        href: "/assessments/create",
      }
      : {
        type: "upload-material",
        message: "Upload a study material to start building adaptive recommendations.",
        href: "/assessments/create",
      };

  return {
    totals: {
      quizzesTaken: progress?.totals?.quizzesTaken || 0,
      questionsAnswered: progress?.totals?.questionsAnswered || 0,
      averageAccuracy,
      averageMastery,
      averageConfidence,
      retentionScore,
      estimatedReadiness,
      reviewDueToday,
      materialCount,
      flashcardSetCount: flashcardCount,
    },
    recentQuizzes,
    recentAttempts: attempts.slice(-6).reverse(),
    accuracyTrend,
    topicMastery,
    weakTopics,
    recommendations: weakTopics.map((topic) => ({
      type: "weak-topic",
      topic: topic.topic,
      message: `Review ${topic.topic} with ${topic.recommendedDifficulty.toLowerCase()} practice and flashcards.`,
      difficulty: topic.recommendedDifficulty,
    })),
    highlights: {
      masteryTrend: attempts.length >= 2
        ? Math.round(attempts.slice(-3).reduce((sum, item) => sum + item.accuracy, 0) / Math.min(3, attempts.length)) - averageAccuracy
        : 0,
      bestTopic: bestTopic
        ? { topic: bestTopic.topic, accuracy: toPercent(bestTopic.mastery) }
        : null,
      weakestTopic: weakestTopic
        ? {
          topic: weakestTopic.topic,
          mastery: toPercent(weakestTopic.mastery),
          weaknessScore: toPercent(weakestTopic.weaknessScore),
        }
        : null,
      needsAttention: weakTopics.length,
      retentionScore,
      estimatedReadiness,
    },
    recommendedNextAction,
  };
};
