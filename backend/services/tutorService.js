import FlashcardSet from "../models/FlashcardSet.js";
import logger from "../utils/logger.js";
import QuizAttempt from "../models/QuizAttempt.js";
import UserProgress from "../models/UserProgress.js";
import { generateTutorResponseFromAI } from "./aiQuizService.js";
import { searchMaterialChunks } from "./embeddingService.js";
import { recordLearningEvent } from "./learningEventService.js";
import { evaluateTutorGrounding, insufficientContextResponse } from "./tutorGrounding.js";

const fallbackTutorResponse = ({ question, materialContexts, weakTopics }) => {
  const bestContext = materialContexts[0];
  const weakTopic = weakTopics[0];

  return {
    answer: bestContext
      ? `I found the closest match in "${bestContext.sourceTitle}". ${bestContext.chunkText.slice(0, 650)}${bestContext.chunkText.length > 650 ? "..." : ""}`
      : "I could not find enough indexed source material for this question yet. Upload or generate from relevant notes first, then ask again for a grounded explanation.",
    groundedSources: bestContext
      ? [{
        sourceNumber: 1,
        sourceTitle: bestContext.sourceTitle,
        whyRelevant: "Highest scoring retrieved source chunk.",
      }]
      : [],
    personalizedNotes: weakTopic
      ? [`This connects to your weak topic "${weakTopic.topic}" where confidence is ${weakTopic.confidence}%.`]
      : [],
    revisionPlan: [
      "Read the cited source chunk once.",
      "Write the concept in your own words.",
      "Create or review flashcards for the same topic.",
      "Attempt a short targeted quiz afterwards.",
    ],
    suggestedFollowUps: [
      `Give me an exam-style example of ${question}`,
      "Quiz me on this concept",
    ],
  };
};

const buildMistakeHistory = async (userId, queryTopics) => {
  const attempts = await QuizAttempt.find({
    user: userId,
    mistakeAnalyses: { $exists: true, $ne: [] },
  })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  const topicSet = new Set(queryTopics.map((topic) => topic.toLowerCase()));
  return attempts.flatMap((attempt) => attempt.mistakeAnalyses || [])
    .filter((analysis) => {
      if (!topicSet.size) return true;
      return topicSet.has(String(analysis.topic || "").toLowerCase());
    })
    .slice(0, 5)
    .map((analysis) => ({
      topic: analysis.topic,
      misconception: analysis.misconception,
      clarification: analysis.clarification,
      revisionSuggestion: analysis.revisionSuggestion,
    }));
};

const findRelatedFlashcards = async (userId, queryTopics) => {
  const sets = await FlashcardSet.find({ user: userId })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  const topicSet = new Set(queryTopics.map((topic) => topic.toLowerCase()));
  return sets.flatMap((set) => set.cards.map((card) => ({
    setTitle: set.title,
    topic: card.topic,
    front: card.front,
    back: card.back,
  })))
    .filter((card) => {
      if (!topicSet.size) return true;
      return topicSet.has(String(card.topic || "").toLowerCase());
    })
    .slice(0, 5);
};

export const gatherTutorContext = async ({ userId, question, materialId = null }) => {
  const trimmedQuestion = String(question || "").trim();
  if (trimmedQuestion.length < 4) {
    const error = new Error("Question is too short");
    error.status = 400;
    throw error;
  }

  const [materialContexts, progress] = await Promise.all([
    searchMaterialChunks({
      userId,
      query: trimmedQuestion,
      materialId,
      limit: 6,
    }),
    UserProgress.findOne({ user: userId }).lean(),
  ]);

  const weakTopics = (progress?.topics || [])
    .filter((topic) => (topic.weaknessScore || 0) > 30 || (topic.confidence || 0) < 60)
    .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))
    .slice(0, 5)
    .map((topic) => ({
      topic: topic.topic,
      mastery: topic.mastery,
      confidence: topic.confidence,
      weaknessScore: topic.weaknessScore,
      recommendedDifficulty: topic.recommendedDifficulty,
    }));

  const retrievedTopics = [
    ...new Set([
      ...materialContexts.flatMap((context) => context.topics || []),
      ...weakTopics.map((topic) => topic.topic),
    ]),
  ].slice(0, 10);

  const [mistakeHistory, flashcards] = await Promise.all([
    buildMistakeHistory(userId, retrievedTopics),
    findRelatedFlashcards(userId, retrievedTopics),
  ]);

  return {
    trimmedQuestion,
    materialContexts,
    weakTopics,
    retrievedTopics,
    mistakeHistory,
    flashcards,
  };
};

export const askContextualTutor = async ({ userId, question, materialId = null }) => {
  const context = await gatherTutorContext({ userId, question, materialId });
  const { trimmedQuestion, materialContexts, weakTopics, retrievedTopics, mistakeHistory, flashcards } = context;

  // The grounding decision is made here, before the model is consulted, and it is
  // the same decision the streaming path makes. A refusal is returned without the
  // model ever being called, so "the tutor answered" can no longer mean "the model
  // decided the context was good enough". See `tutorGrounding.js` for why this
  // refuses only on absent evidence and not on a score threshold.
  const grounding = evaluateTutorGrounding(materialContexts);

  if (!grounding.grounded) {
    logger.info("Tutor refused without calling the model: no retrieved evidence", {
      userId,
      reason: grounding.reason,
      consideredCount: grounding.consideredCount,
    });

    await recordLearningEvent({
      userId,
      topic: weakTopics[0]?.topic || retrievedTopics[0] || "General",
      eventType: "ai_tutoring_interaction",
      // Distinct from the pre-existing "partial", which meant the model failed or
      // context was empty. Here the retrieval ran and returned nothing usable, so
      // the interaction is recorded as a refusal rather than a partial answer.
      result: "insufficient_context",
      confidence: weakTopics[0]?.confidence || 0,
      difficulty: weakTopics[0]?.recommendedDifficulty || "",
      metadata: {
        question: trimmedQuestion,
        materialId,
        retrievedChunkIds: materialContexts.map((context) => context._id),
        sourceCount: materialContexts.length,
        grounding,
      },
    });

    return {
      ...insufficientContextResponse({ question: trimmedQuestion, grounding }),
      learnerContext: {
        weakTopics,
        mistakeHistory,
        flashcards,
      },
    };
  }

  let response;
  try {
    response = await generateTutorResponseFromAI({
      question: trimmedQuestion,
      materialContexts,
      weakTopics,
      mistakeHistory,
      flashcards,
    });
  } catch (err) {
    logger.warn("Tutor AI failed, using fallback", { error: err.message });
    response = fallbackTutorResponse({ question: trimmedQuestion, materialContexts, weakTopics });
  }

  await recordLearningEvent({
    userId,
    topic: weakTopics[0]?.topic || retrievedTopics[0] || "General",
    eventType: "ai_tutoring_interaction",
    result: materialContexts.length ? "completed" : "partial",
    confidence: weakTopics[0]?.confidence || 0,
    difficulty: weakTopics[0]?.recommendedDifficulty || "",
    metadata: {
      question: trimmedQuestion,
      materialId,
      retrievedChunkIds: materialContexts.map((context) => context._id),
      sourceCount: materialContexts.length,
    },
  });

  return {
    question: trimmedQuestion,
    ...response,
    // Additive: lets a client or a log tell a grounded answer from a refusal
    // without inspecting prose. The client does not declare this field and is
    // unaffected by its presence.
    grounding,
    retrievedContext: materialContexts.map((context, index) => ({
      sourceNumber: index + 1,
      chunkId: context._id,
      studyMaterialId: context.studyMaterial?._id || context.studyMaterial,
      sourceTitle: context.sourceTitle || context.studyMaterial?.title || "Study Material",
      chunkIndex: context.chunkIndex,
      score: context.score,
      preview: context.textPreview,
      topics: context.topics || [],
    })),
    learnerContext: {
      weakTopics,
      mistakeHistory,
      flashcards,
    },
  };
};
