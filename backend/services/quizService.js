import { generateQuizFromAI } from "./aiQuizService.js";

/**
 * Main quiz generation orchestrator.
 * Tries AI generation first, falls back to keyword-based generator.
 *
 * @param {string} text - Extracted document text
 * @param {string} difficulty - "Easy" | "Medium" | "Hard"
 * @param {number} count - Number of questions
 * @returns {Array} Quiz questions array
 */
export const generateQuiz = async (text, difficulty = "Easy", count = 5) => {
  try {
    const aiQuiz = await generateQuizFromAI(text, difficulty, count);

    if (aiQuiz && aiQuiz.length > 0) {
      console.log(`✅ AI generated ${aiQuiz.length} questions (${difficulty})`);
      return aiQuiz;
    }

    throw new Error("AI returned empty result");
  } catch (err) {
    console.warn("⚠️  AI failed, using fallback generator:", err.message);
    return fallbackQuizGenerator(text, count);
  }
};

/**
 * Improved fallback quiz generator.
 * Uses keyword extraction and content-aware distractor generation
 * instead of generic placeholder options.
 */
const fallbackQuizGenerator = (text, count = 5) => {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid text input for quiz generation");
  }

  const cleaned = text.replace(/\s+/g, " ").trim();

  if (cleaned.length < 50) {
    throw new Error("Text too short to generate quiz (minimum 50 characters)");
  }

  // Extract meaningful sentences (40+ chars, not headers/fragments)
  const sentences = cleaned
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.split(" ").length > 6);

  if (sentences.length < 2) {
    throw new Error("Not enough meaningful content to generate questions");
  }

  // Extract all significant keywords from the text for distractor generation
  const allKeywords = extractKeywords(cleaned);

  const selected = sentences.slice(0, Math.min(count, sentences.length));

  const quiz = selected.map((sentence, idx) => {
    const words = sentence.split(" ");

    // Find the most meaningful word to blank out (skip common words)
    const keywordIndex = findBestKeywordIndex(words);
    const answerWord = words[keywordIndex];

    // Build the question text
    const questionText = words
      .map((w, i) => (i === keywordIndex ? "______" : w))
      .join(" ");

    // Generate content-aware distractors
    const distractors = generateDistractors(answerWord, allKeywords, words);

    const options = shuffle([answerWord, ...distractors]);

    return {
      question: `Fill in the blank: ${questionText}`,
      options,
      answer: options.indexOf(answerWord),
      explanation: `The correct answer is "${answerWord}" as stated in the source material.`,
      topic: "",
    };
  });

  return quiz;
};

/**
 * Extracts significant keywords from text,
 * filtering out common stop words and short words.
 */
const extractKeywords = (text) => {
  const stopWords = new Set([
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "but",
    "in", "with", "to", "for", "of", "not", "no", "can", "had", "has",
    "have", "will", "would", "could", "should", "may", "might", "shall",
    "was", "were", "been", "being", "this", "that", "these", "those",
    "it", "its", "they", "them", "their", "from", "into", "by", "are",
    "as", "do", "does", "did", "if", "then", "than", "also", "each",
    "about", "between", "through", "during", "before", "after", "above",
    "below", "such", "when", "where", "how", "all", "both", "only",
    "very", "just", "more", "most", "some", "any", "other", "over",
    "used", "using", "use", "one", "two", "three", "new", "first",
  ]);

  return text
    .split(/[\s,;:()\[\]{}]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((w) => w.length > 3 && !stopWords.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
};

/**
 * Finds the index of the most suitable word to blank out.
 * Prefers longer, more specific words; avoids articles and prepositions.
 */
const findBestKeywordIndex = (words) => {
  const skipWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can",
    "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "as", "into", "through", "during",
    "this", "that", "it", "its", "they", "them", "their",
  ]);

  let bestIndex = Math.floor(words.length / 3);
  let bestScore = 0;

  words.forEach((word, i) => {
    const clean = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (skipWords.has(clean) || clean.length < 4) return;

    // Score based on word length and position (prefer middle words)
    const positionScore = 1 - Math.abs(i - words.length / 2) / (words.length / 2);
    const lengthScore = Math.min(clean.length / 10, 1);
    const score = positionScore * 0.4 + lengthScore * 0.6;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });

  return bestIndex;
};

/**
 * Generates 3 plausible distractors from the keyword pool,
 * ensuring they're different from the correct answer.
 */
const generateDistractors = (correctAnswer, allKeywords, contextWords) => {
  const correct = correctAnswer.toLowerCase().replace(/[^a-zA-Z0-9]/g, "");

  // Filter keywords that are different from the correct answer
  const candidates = allKeywords.filter((kw) => {
    const kwClean = kw.toLowerCase().replace(/[^a-zA-Z0-9]/g, "");
    return kwClean !== correct && kwClean.length > 2;
  });

  // Shuffle and pick unique distractors
  const shuffled = shuffle([...new Set(candidates)]);
  const distractors = [];

  for (const candidate of shuffled) {
    if (distractors.length >= 3) break;
    if (!distractors.some((d) => d.toLowerCase() === candidate.toLowerCase())) {
      distractors.push(candidate);
    }
  }

  // If we don't have enough, generate generic but relevant-sounding options
  const fallbacks = ["Parameter", "Algorithm", "Framework", "Protocol", "Architecture", "Component"];
  while (distractors.length < 3) {
    const fb = fallbacks[distractors.length];
    if (fb && fb.toLowerCase() !== correct) {
      distractors.push(fb);
    } else {
      distractors.push(`Term-${distractors.length + 1}`);
    }
  }

  return distractors.slice(0, 3);
};

/**
 * Fisher-Yates shuffle — unbiased.
 */
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};