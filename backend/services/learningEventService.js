import LearningEvent from "../models/LearningEvent.js";
import { normalizeTopic } from "./topicNormalizationService.js";

export const recordLearningEvent = async ({
  userId,
  subject = "",
  topic = "General",
  eventType,
  result = "completed",
  confidence = 0,
  difficulty = "",
  metadata = {},
}) => {
  if (!userId || !eventType) return null;

  return LearningEvent.create({
    user: userId,
    subject,
    topic: normalizeTopic(topic),
    eventType,
    result,
    confidence,
    difficulty,
    metadata,
  });
};

export const recordAttemptEvents = async ({ userId, quiz, attempt }) => {
  const events = attempt.answers.map((answer) => ({
    user: userId,
    subject: quiz.subject || "",
    topic: normalizeTopic(answer.topic || "General"),
    eventType: "quiz_attempt",
    result: answer.isCorrect ? "correct" : "incorrect",
    confidence: answer.isCorrect ? 70 : 30,
    difficulty: attempt.difficulty,
    metadata: {
      quizId: quiz._id,
      attemptId: attempt._id,
      questionIndex: answer.questionIndex,
      selected: answer.selected,
      correct: answer.correct,
      score: attempt.score,
      total: attempt.total,
      accuracy: attempt.accuracy,
    },
  }));

  if (!events.length) return [];
  return LearningEvent.insertMany(events);
};
