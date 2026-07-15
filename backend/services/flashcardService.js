import FlashcardSet from "../models/FlashcardSet.js";
import logger from "../utils/logger.js";
import Quiz from "../models/Quiz.js";
import StudyMaterial from "../models/StudyMaterial.js";
import UserProgress from "../models/UserProgress.js";
import { generateFlashcardsFromAI } from "./aiQuizService.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeCardsForScheduling = (cards) =>
  cards.map((card) => ({
    ...card,
    review: {
      nextReviewAt: new Date(),
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      ease: 2.5,
      intervalDays: 0,
      dueAt: new Date(),
      lastReviewedAt: null,
      reviewCount: 0,
    },
  }));

const fallbackFromQuestions = (questions, count) =>
  questions.slice(0, count).map((question, index) => ({
    front: question.question,
    back: question.explanation || question.options?.[question.answer] || "Review the source material for the full explanation.",
    topic: question.topic || "General",
    sourceQuestionIndex: index,
  }));

const fallbackFromText = (text, count) => {
  const sentences = String(text || "")
    .replace(/\s+/g, " ")
    .split(/[.?!]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 60);

  return sentences.slice(0, count).map((sentence) => {
    const topic = sentence.split(" ").slice(0, 4).join(" ");
    return {
      front: `Explain the concept: ${topic}`,
      back: sentence,
      topic,
    };
  });
};

export const createFlashcardSet = async ({ userId, sourceType, sourceId, count = 12 }) => {
  const safeCount = Math.min(Math.max(Number(count) || 12, 4), 30);
  let title = "Adaptive Flashcards";
  let text = "";
  let quiz = null;
  let studyMaterial = null;
  let fallbackCards = [];

  if (sourceType === "quiz") {
    quiz = await Quiz.findOne({ _id: sourceId, user: userId });
    if (!quiz) throw new Error("Quiz not found");
    title = `${quiz.title} Flashcards`;
    text = quiz.questions.map((q) => `${q.topic || "General"}: ${q.question} ${q.explanation || ""}`).join("\n");
    fallbackCards = fallbackFromQuestions(quiz.questions, safeCount);
    studyMaterial = quiz.studyMaterial || null;
  } else if (sourceType === "material") {
    studyMaterial = await StudyMaterial.findOne({ _id: sourceId, user: userId });
    if (!studyMaterial) throw new Error("Study material not found");
    title = `${studyMaterial.title} Flashcards`;
    text = studyMaterial.extractedText;
    fallbackCards = fallbackFromText(studyMaterial.extractedText, safeCount);
  } else {
    const progress = await UserProgress.findOne({ user: userId }).lean();
    const weakTopics = (progress?.topics || [])
      .filter((topic) => (topic.weaknessScore || (100 - topic.mastery)) > 35)
      .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))
      .slice(0, safeCount)
      .map((topic) => `${topic.topic}: mastery ${topic.mastery}%, confidence ${topic.confidence || 0}%, weakness ${topic.weaknessScore || 0}`);
    text = weakTopics.join("\n");
    fallbackCards = weakTopics.map((topic) => ({
      front: `Review weak area: ${topic.split(":")[0]}`,
      back: "Use this as a focused recall prompt, then generate a targeted quiz after review.",
      topic: topic.split(":")[0],
    }));
  }

  let cards = [];
  try {
    cards = await generateFlashcardsFromAI(text, safeCount);
  } catch (err) {
    logger.warn("Flashcard AI generation failed, using fallback", { error: err.message });
  }

  if (!cards.length) cards = fallbackCards;
  if (!cards.length) throw new Error("Not enough content to generate flashcards");

  const set = await FlashcardSet.create({
    user: userId,
    title,
    sourceType,
    studyMaterial: studyMaterial?._id || studyMaterial || null,
    quiz: quiz?._id || null,
    cards: normalizeCardsForScheduling(cards.slice(0, safeCount)),
    tags: [...new Set(cards.map((card) => card.topic).filter(Boolean))].slice(0, 8),
  });

  if (studyMaterial?._id) {
    await StudyMaterial.findByIdAndUpdate(studyMaterial._id, { $addToSet: { linkedFlashcardSets: set._id } });
  }

  return set;
};

export const getDueFlashcards = async ({ userId, limit = 30 }) => {
  const now = new Date();
  const sets = await FlashcardSet.find({
    user: userId,
    $or: [
      { "cards.review.nextReviewAt": { $lte: now } },
      { "cards.review.dueAt": { $lte: now } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(30)
    .lean();

  const dueCards = [];
  sets.forEach((set) => {
    set.cards.forEach((card) => {
      const nextReviewAt = card.review?.nextReviewAt || card.review?.dueAt || set.createdAt;
      if (new Date(nextReviewAt) <= now) {
        dueCards.push({
          setId: set._id,
          setTitle: set.title,
          card,
          nextReviewAt,
        });
      }
    });
  });

  return dueCards
    .sort((a, b) => new Date(a.nextReviewAt) - new Date(b.nextReviewAt))
    .slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100));
};

export const applySpacedRepetitionReview = async ({ userId, setId, cardId, rating }) => {
  const qualityByRating = {
    again: 1,   // Incorrect; correct one recognized
    hard: 3,    // Correct; recalled with serious difficulty
    good: 4,    // Correct; after hesitation
    easy: 5,    // Perfect response
  };
  const quality = qualityByRating[rating] || 4;
  const set = await FlashcardSet.findOne({ _id: setId, user: userId });

  if (!set) {
    const error = new Error("Flashcard set not found");
    error.status = 404;
    throw error;
  }

  const card = set.cards.id(cardId);
  if (!card) {
    const error = new Error("Flashcard not found");
    error.status = 404;
    throw error;
  }

  const review = card.review || {};
  const currentEase = review.easeFactor || review.ease || 2.5;
  const currentRepetitions = review.repetitions || 0;
  const currentInterval = review.interval || review.intervalDays || 0;

  // Standard SM-2 Ease Factor calculation
  const nextEase = clamp(
    currentEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    1.3,
    3.0
  );

  const nextRepetitions = quality < 3 ? 0 : currentRepetitions + 1;
  let nextInterval = 1;

  if (quality < 3) {
    nextInterval = rating === "again" ? 0 : 1; // reset interval: 0 days if again (same day review), 1 day if other low score
  } else if (nextRepetitions === 1) {
    nextInterval = 1;
  } else if (nextRepetitions === 2) {
    nextInterval = 6; // Standard SM-2 second interval is 6 days
  } else {
    let multiplier = currentEase;
    if (rating === "easy") multiplier *= 1.3; // Easy bonus multiplier
    nextInterval = Math.max(1, Math.round(currentInterval * multiplier));
  }

  const nextReviewAt = new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000);

  card.review.easeFactor = nextEase;
  card.review.interval = nextInterval;
  card.review.repetitions = nextRepetitions;
  card.review.nextReviewAt = nextReviewAt;
  card.review.ease = nextEase;
  card.review.intervalDays = nextInterval;
  card.review.dueAt = nextReviewAt;
  card.review.lastReviewedAt = new Date();
  card.review.reviewCount = (review.reviewCount || 0) + 1;

  await set.save();
  return card;
};
