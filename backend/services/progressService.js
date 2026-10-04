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

// Keeps every read in an attempt-application inside the caller's transaction when
// one is supplied, and behaves exactly as before when it is not.
const withSession = (query, session) => (session ? query.session(session) : query);

const saveDoc = (doc, session) => (session ? doc.save({ session }) : doc.save());

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

/** Consecutive-day counts that earn a streak achievement. */
const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];

/**
 * Loads the learner's progress document, or null when none exists yet.
 *
 * A brand-new learner who has studied for three days but never sat an assessment
 * has no progress document, so there is nothing to attach an achievement to. That
 * is a legitimate state, not an error.
 */
const loadProgress = async (userId, session) => {
  const progress = await withSession(UserProgress.findOne({ user: userId }), session);
  return progress ?? null;
};

/**
 * Attaches an achievement to a progress document, at most once.
 *
 * Idempotent by id, so replaying the same attempt or re-running the same day
 * cannot produce a duplicate. Returns whether this call was the one that awarded
 * it, so the caller can fire a notification only on the transition.
 */
const awardAchievement = async (progress, achievement, { session } = {}) => {
  if (!progress) return false;

  const existing = progress.achievements ?? [];
  if (existing.some((a) => a.id === achievement.id)) return false;

  progress.achievements = [...existing, achievement];
  await saveDoc(progress, session);
  return true;
};

export const updateUserProgressFromAttempt = async ({ userId, quiz, attempt, session }) => {
  const progress = await UserProgress.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    session ? { upsert: true, returnDocument: "after", session } : { upsert: true, returnDocument: "after" }
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
    const awarded = await awardAchievement(
      progress,
      {
        id: "first_quiz",
        title: "First Steps",
        description: "Completed your first assessment.",
        unlockedAt: now,
      },
      { session }
    );
    if (awarded) {
      await Notification.create(
        [{
          user: userId,
          title: "Achievement unlocked",
          message: "You've earned the 'First Steps' achievement.",
          type: "achievement"
        }],
        session ? { session } : {}
      );
    }
  }

  await saveDoc(progress, session);

  await updateStudyStreak(userId, { session });
  return progress;
};

export const updateStudyStreak = async (userId, { session } = {}) => {
  const user = await withSession(User.findById(userId), session);
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

  await saveDoc(user, session);

  // Streak milestones: notify, and persist the milestone as a real achievement.
  //
  // The Profile page lists achievements, so a milestone that only ever produced a
  // notification was invisible there — the section could never show a streak. The
  // notification is unchanged in substance; the achievement is the addition.
  if (current > 1 && STREAK_MILESTONES.includes(current)) {
    const awarded = await awardAchievement(
      await loadProgress(userId, session),
      {
        id: `streak_${current}`,
        title: `${current} Day Streak`,
        description: `Studied for ${current} consecutive days.`,
        unlockedAt: new Date(),
      },
      { session }
    );

    await Notification.create(
      [{
        user: userId,
        title: `${current} day streak`,
        message: `You've studied for ${current} consecutive days. Keep it up!`,
        type: "success"
      }],
      session ? { session } : {}
    );
  }

  return user.streak;
};
