import { generateQuizFromAI } from "./aiQuizService.js";
import logger from "../utils/logger.js";
import { chunkText } from "../utils/chunker.js";
import { isLowQuality } from "../utils/qualityFilter.js";
import { normalizeTopic } from "./topicNormalizationService.js";

/**
 * Main quiz generation orchestrator.
 */
export const generateQuiz = async (text, difficulty = "Easy", count = 5) => {
  try {
    if (!text || text.length < 500) {
      throw new Error("PDF content too small for quiz generation");
    }

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
    logger.warn("⚠️ AI failed, using fallback generator:", { error: err.message });
    return fallbackQuizGenerator(text, count);
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




/**
 * Fallback quiz generator
 */
const fallbackQuizGenerator = (text, count = 5) => {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid text input for quiz generation");
  }

  const cleaned = text.replace(/\s+/g, " ").trim();

  if (cleaned.length < 50) {
    throw new Error("Text too short to generate quiz");
  }

  const sentences = cleaned
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.split(" ").length > 6);

  if (sentences.length < 2) {
    throw new Error("Not enough meaningful content");
  }

  const selected = sentences.slice(0, Math.min(count, sentences.length));

  return selected.map((sentence) => ({
    question: sentence,
    options: ["True", "False", "Depends", "None"],
    answer: 0,
    explanation: "Generated from source text",
    topic: normalizeTopic(""),
  }));
};