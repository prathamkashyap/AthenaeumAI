import FlashcardSet from "../models/FlashcardSet.js";
import logger from "../utils/logger.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import ReviewQueue from "../models/ReviewQueue.js";
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

/**
 * Builds cards from the questions a learner actually got wrong.
 *
 * A quiz-sourced set is built from every question, so it rehearses material the
 * learner already demonstrated. This variant is built from the attempt's recorded
 * wrong answers only, which is what makes a review set a response to a mistake
 * rather than a re-run of the quiz.
 *
 * `sourceQuestionIndex` is preserved from the quiz rather than from the filtered
 * list's own position. The index is how a card is traced back to the question it
 * came from, so renumbering it here would silently break that link — a card
 * built from the second wrong answer of a quiz would claim to be the second
 * question of the quiz.
 *
 * The explanation is preferred for the back of the card, since for a wrong answer
 * it is the corrective content; the correct option is the fallback when a question
 * was generated without one.
 */
const cardsFromMistakes = ({ quiz, wrongAnswers, mistakeAnalyses, count }) => {
  const analysesByIndex = new Map(
    (mistakeAnalyses || []).map((analysis) => [analysis.questionIndex, analysis]),
  );

  return wrongAnswers.slice(0, count).map((answer) => {
    const question = quiz.questions?.[answer.questionIndex];
    const analysis = analysesByIndex.get(answer.questionIndex);
    return {
      front: question?.question || analysis?.misconception || "Review this question.",
      back:
        question?.explanation ||
        analysis?.clarification ||
        question?.options?.[question?.answer] ||
        "Review the source material for the full explanation.",
      topic: question?.topic || analysis?.topic || "General",
      sourceQuestionIndex: answer.questionIndex,
    };
  });
};

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
  let attempt = null;
  let fallbackCards = [];

  if (sourceType === "quiz") {
    quiz = await Quiz.findOne({ _id: sourceId, user: userId });
    if (!quiz) throw new Error("Quiz not found");
    title = `${quiz.title} Flashcards`;
    text = quiz.questions.map((q) => `${q.topic || "General"}: ${q.question} ${q.explanation || ""}`).join("\n");
    fallbackCards = fallbackFromQuestions(quiz.questions, safeCount);
    studyMaterial = quiz.studyMaterial || null;
  } else if (sourceType === "mistakes") {
    // Selected from the attempt, not from the quiz. The quiz is loaded only to
    // recover the question text the attempt's indices refer to, and the attempt
    // is scoped to the learner exactly as a quiz would be, so an id belonging to
    // somebody else cannot generate a set from this learner's attempt.
    attempt = await QuizAttempt.findOne({ _id: sourceId, user: userId });
    if (!attempt) throw new Error("Quiz attempt not found");
    quiz = await Quiz.findOne({ _id: attempt.quiz, user: userId });
    if (!quiz) throw new Error("Quiz not found for this attempt");

    // The attempt's own record of which answers were wrong, rather than a
    // re-derivation. It is the same array the mistake analysis and the review
    // queue were built from, so all three agree by construction.
    const wrongAnswers = (attempt.answers || []).filter((answer) => answer.isCorrect === false);

    if (!wrongAnswers.length) {
      // A perfect attempt is a legitimate input, and the honest response to it is
      // to decline rather than to build a set from questions the learner already
      // answered correctly. The controller surfaces this as a 400.
      const error = new Error("This attempt had no incorrect answers to review.");
      error.status = 400;
      throw error;
    }

    title = `${quiz.title} — Mistake Review`;
    text = wrongAnswers
      .map((answer) => {
        const question = quiz.questions?.[answer.questionIndex];
        return `${question?.topic || "General"}: ${question?.question || ""} ${question?.explanation || ""}`;
      })
      .join("\n");
    fallbackCards = cardsFromMistakes({
      quiz,
      wrongAnswers,
      mistakeAnalyses: attempt.mistakeAnalyses,
      count: safeCount,
    });
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
  if (!cards.length) {
    // Nothing was produced, and there is nothing to persist, so this is the
    // learner hitting a genuine "not yet" condition rather than a fault. With no
    // attempts there are no weak topics to build a deck from, and the AI
    // generator short-circuits on empty input so it never fills the gap.
    //
    // The 400 is the point. Without a status this surfaced as a 500, which is
    // both a lie about what happened and an error-log entry for an expected
    // state.
    //
    // The message is per-source and learner-facing, because the endpoint's
    // `error` field is already part of the error contract and the alternative is
    // teaching the client to recognise an internal string. A single shared
    // message would be actively wrong for the other sources: a material with no
    // extractable text has no weak topics to be missing.
    const noContentMessage = {
      "weak-topics":
        "No weak topics yet. Take an assessment first to build adaptive review.",
      material:
        "This material has no text to build flashcards from yet. Try a different file.",
      quiz: "This quiz has no questions to build flashcards from.",
      mistakes:
        "This attempt has nothing to review. No incorrect answers were recorded.",
    }[sourceType] || "There is not enough material yet to build flashcards from this source.";

    const error = new Error(noContentMessage);
    error.status = 400;
    throw error;
  }

  const set = await FlashcardSet.create({
    user: userId,
    title,
    sourceType,
    studyMaterial: studyMaterial?._id || studyMaterial || null,
    quiz: quiz?._id || null,
    // The attempt the set was built from, when there was one. Without it a
    // mistake set is indistinguishable from a quiz set by its shape alone, and a
    // later consumer could not tell which attempt motivated the cards.
    attempt: attempt?._id || null,
    cards: normalizeCardsForScheduling(cards.slice(0, safeCount)),
    tags: [...new Set(cards.map((card) => card.topic).filter(Boolean))].slice(0, 8),
  });

  if (studyMaterial?._id) {
    await StudyMaterial.findByIdAndUpdate(studyMaterial._id, { $addToSet: { linkedFlashcardSets: set._id } });
  }

  // Connects the new cards to the review items the same attempt already created,
  // so the review queue can point a learner at the flashcard built to fix the
  // question it names.
  //
  // Idempotent by filter, not by the ReviewQueue's unique index: an item that is
  // already linked has a non-null `source.flashcardSet` and so no longer matches
  // `null`, leaving a repeated run with nothing to update. Linking is a `$set`
  // rather than an add, so even a hypothetical double match would not duplicate
  // the reference.
  if (attempt?._id) {
    await ReviewQueue.updateMany(
      {
        user: userId,
        itemType: "failed_question",
        status: "open",
        "source.attempt": attempt._id,
        "source.flashcardSet": null,
      },
      { $set: { "source.flashcardSet": set._id } }
    );
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
