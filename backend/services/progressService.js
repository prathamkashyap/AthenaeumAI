import User from "../models/User.js";
import UserProgress from "../models/UserProgress.js";
import Notification from "../models/Notification.js";
import { normalizeTopic as canonicalNormalize } from "./topicNormalizationService.js";

const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const daysBetween = (a, b) => {
  const aDate = new Date(`${a}T00:00:00.000Z`);
  const bDate = new Date(`${b}T00:00:00.000Z`);
  return Math.round((bDate - aDate) / (1000 * 60 * 60 * 24));
};

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(Math.round(value), min), max);

const recommendedDifficultyFor = (mastery) => {
  if (mastery >= 78) return "Hard";
  if (mastery >= 55) return "Medium";
  return "Easy";
};

const recencyScoreFor = (lastPracticedAt, now = new Date()) => {
  if (!lastPracticedAt) return 45;
  const elapsedDays = Math.max(0, (now - new Date(lastPracticedAt)) / (1000 * 60 * 60 * 24));
  return clamp(100 * Math.exp(-elapsedDays / 21));
};

const difficultyDeltaFor = (difficulty, isCorrect) => {
  const correctGain = { Easy: 8, Medium: 12, Hard: 16 };
  const wrongPenalty = { Easy: -18, Medium: -14, Hard: -10 };
  return isCorrect ? correctGain[difficulty] || 10 : wrongPenalty[difficulty] || -14;
};

const computeWeightedMastery = ({ accuracy, recencyScore, confidence }) => {
  return clamp((0.5 * accuracy) + (0.3 * recencyScore) + (0.2 * confidence));
};

const computeWeaknessScore = ({ mastery, confidence, lastWrongAt, now = new Date() }) => {
  const daysSinceWrong = lastWrongAt
    ? Math.max(0, (now - new Date(lastWrongAt)) / (1000 * 60 * 60 * 24))
    : null;
  const wrongRecencyPressure = daysSinceWrong === null ? 0 : Math.max(0, 25 - daysSinceWrong * 2);
  const confidenceGap = Math.max(0, 70 - confidence) * 0.35;
  return clamp((100 - mastery) + wrongRecencyPressure + confidenceGap);
};

export const normalizeTopic = (topic) => {
  return canonicalNormalize(topic);
};

export const updateUserProgressFromAttempt = async ({ userId, quiz, attempt }) => {
  const progress = await UserProgress.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { upsert: true, new: true }
  );

  progress.totals.quizzesTaken += 1;
  progress.totals.questionsAnswered += attempt.total;
  progress.totals.correctAnswers += attempt.score;
  progress.totals.averageAccuracy = Math.round(
    (progress.totals.correctAnswers / Math.max(progress.totals.questionsAnswered, 1)) * 100
  );

  const topicMap = new Map(progress.topics.map((topic) => [normalizeTopic(topic.topic), topic]));
  const now = new Date();

  attempt.answers.forEach((answer) => {
    const topicName = normalizeTopic(answer.topic);
    const existing = topicMap.get(topicName) || {
      topic: topicName,
      subject: quiz.subject || "",
      attempted: 0,
      correct: 0,
      mastery: 0,
      weaknessScore: 0,
      confidence: 35,
      reviewCount: 0,
      lastWrongAt: null,
      lastPracticedAt: null,
      recommendedDifficulty: "Easy",
    };

    const recencyScore = recencyScoreFor(existing.lastPracticedAt, now);
    existing.attempted += 1;
    existing.correct += answer.isCorrect ? 1 : 0;
    existing.reviewCount = (existing.reviewCount || 0) + 1;
    existing.confidence = clamp(
      (existing.confidence || 35) + difficultyDeltaFor(attempt.difficulty, answer.isCorrect)
    );

    if (!answer.isCorrect) {
      existing.lastWrongAt = now;
    }

    const accuracy = (existing.correct / Math.max(existing.attempted, 1)) * 100;
    existing.mastery = computeWeightedMastery({
      accuracy,
      recencyScore,
      confidence: existing.confidence,
    });
    existing.weaknessScore = computeWeaknessScore({
      mastery: existing.mastery,
      confidence: existing.confidence,
      lastWrongAt: existing.lastWrongAt,
      now,
    });
    existing.lastPracticedAt = now;
    existing.recommendedDifficulty = recommendedDifficultyFor(existing.mastery);
    topicMap.set(topicName, existing);
  });

  progress.topics = Array.from(topicMap.values()).sort((a, b) => b.weaknessScore - a.weaknessScore);

  // Check achievements
  if (progress.totals.quizzesTaken === 1) {
    const hasFirstQuiz = progress.achievements?.some(a => a.id === "first_quiz");
    if (!hasFirstQuiz) {
      if (!progress.achievements) progress.achievements = [];
      progress.achievements.push({
        id: "first_quiz",
        title: "First Steps",
        description: "Completed your first assessment.",
        unlockedAt: now,
      });
      await Notification.create({
        user: userId,
        title: "Achievement Unlocked! 🏆",
        message: "You've earned the 'First Steps' achievement.",
        type: "achievement"
      });
    }
  }

  await progress.save();

  await updateStudyStreak(userId);
  return progress;
};

export const updateStudyStreak = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;

  const today = dateKey();
  const last = user.streak?.lastStudyDate;

  if (last === today) return user.streak;

  const current = last && daysBetween(last, today) === 1 ? (user.streak?.current || 0) + 1 : 1;
  user.streak = {
    current,
    longest: Math.max(user.streak?.longest || 0, current),
    lastStudyDate: today,
  };

  await user.save();

  // Streak Notifications
  if (current > 1 && [3, 7, 14, 30, 50, 100].includes(current)) {
    await Notification.create({
      user: userId,
      title: `${current} Day Streak! 🔥`,
      message: `You've studied for ${current} consecutive days. Keep it up!`,
      type: "success"
    });
  }

  return user.streak;
};
