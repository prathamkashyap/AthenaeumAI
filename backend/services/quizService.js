import { generateQuizFromAI } from "./aiQuizService.js";
import logger from "../utils/logger.js";
import { AIServiceError } from "../utils/errors.js";
import { chunkText } from "../utils/chunker.js";
import { isLowQuality } from "../utils/qualityFilter.js";
import { normalizeTopic } from "./topicNormalizationService.js";

/**
 * Main quiz generation orchestrator.
 */
export const generateQuiz = async (text, difficulty = "Easy", count = 5) => {
  // An input problem, not a provider failure, so it is checked before the
  // pipeline: inside the try it would be indistinguishable from the AI failing.
  if (!text || text.length < 500) {
    throw new Error("PDF content too small for quiz generation");
  }

  try {
    // STEP 1: Clean basic noise
    const cleanedText = text.replace(/\s+/g, " ").trim();

    // STEP 2: Chunk text
    const chunks = chunkText(cleanedText, 1500);

    // STEP 3: Select distributed chunks (better coverage)
    const selectedChunks = chunks.slice(0, Math.min(5, chunks.length));

    const perChunk = Math.ceil(count / selectedChunks.length);

    let allQuestions = [];

    // STEP 4: Retry wrapper
    const tryGenerate = async (chunk) => {
      for (let i = 0; i < 2; i++) {
        try {
          return await generateQuizFromAI(chunk, difficulty, perChunk);
        } catch (err) {
          logger.warn("Quiz generation chunk attempt failed, retrying...");
        }
      }
      return [];
    };

    // STEP 5: Generate from chunks
    for (const chunk of selectedChunks) {
      const aiQuiz = await tryGenerate(chunk);

      if (aiQuiz && aiQuiz.length > 0) {
        // Normalize topic strings before adding
        const normalizedChunkQuiz = aiQuiz.map((q) => ({
          ...q,
          topic: normalizeTopic(q.topic),
        }));
        allQuestions.push(...normalizedChunkQuiz);
      }
    }

    // STEP 6: Remove low-quality
    const filtered = allQuestions.filter(q => !isLowQuality(q));

    // STEP 7: Remove similar questions (semantic dedup)
    const unique = removeSimilar(filtered);

    // STEP 8: Score and rank
    unique.sort((a, b) => scoreQuestion(b) - scoreQuestion(a));

    if (unique.length > 0) {
      logger.info(`✅ AI generated ${unique.length} clean questions`);
      return unique.slice(0, count);
    }

    throw new Error("AI returned empty result");

  } catch (err) {
    // A provider that cannot answer is reported as a failure. Substituting
    // synthetic questions here would persist them as an ordinary quiz with no
    // marker that the model was never consulted — every fabricated question is
    // answered "True", because that is what the generator produced — which
    // contradicts the documented requirement that AI configuration is required
    // for generation. `AIServiceError` is the repository's existing provider
    // failure convention (502).
    logger.warn("⚠️ Quiz generation failed:", { error: err.message });
    throw new AIServiceError("Failed to generate questions. Please try again.", err);
  }
};




/**
 * Semantic similarity check
 */
const isSimilar = (q1, q2) => {
  const a = q1.toLowerCase();
  const b = q2.toLowerCase();

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));

  let overlap = 0;
  for (let word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  return overlap / wordsA.size > 0.6;
};

/**
 * Remove semantically similar questions
 */
const removeSimilar = (questions) => {
  const unique = [];

  for (const q of questions) {
    if (!unique.some(u => isSimilar(u.question, q.question))) {
      unique.push(q);
    }
  }

  return unique;
};




/**
 * Score question quality
 */
const scoreQuestion = (q) => {
  let score = 0;

  if (q.question.length > 60) score += 2;
  if (q.options.some(o => o.length > 20)) score += 2;
  if (q.explanation && q.explanation.length > 30) score += 2;

  if (q.question.toLowerCase().includes("what is")) score -= 2;

  return score;
};
