/**
 * Calculates a detailed quality score from 0.0 to 10.0 for a given question.
 * @param {object} q - The question object to evaluate.
 * @returns {number} The quality score.
 */
export function calculateQualityScore(q) {
  if (!q) return 0;
  
  let score = 10.0;
  
  // Basic structural requirements (immediate disqualification if failed)
  if (!q.question || typeof q.question !== "string") return 0;
  if (!Array.isArray(q.options) || q.options.length !== 4) return 0;
  if (typeof q.answer !== "number" || q.answer < 0 || q.answer > 3) return 0;

  // 1. Question Length Check (minor penalty, not automatically rejected)
  if (q.question.length < 40) {
    score -= 2.0;
  }
  
  // 2. Ambiguity Checks (penalize "all of the above" / "none of the above" - critical, so major penalty)
  const ambiguousPhrases = [
    "all of the above",
    "none of the above",
    "all of these",
    "none of these",
    "both a and b",
    "both b and c",
    "both a and c"
  ];
  const hasAmbiguity = q.options.some(opt => {
    if (typeof opt !== "string") return true;
    const lowerOpt = opt.toLowerCase();
    return ambiguousPhrases.some(phrase => lowerOpt.includes(phrase));
  });
  
  if (hasAmbiguity) {
    score -= 6.0;
  }

  // 3. Short/Empty Options Check (critical, so major penalty)
  const hasShortOption = q.options.some(opt => typeof opt !== "string" || opt.trim().length < 2);
  if (hasShortOption) {
    score -= 6.0;
  }

  // 4. Duplicate Options Check (critical, so major penalty)
  const uniqueOptions = new Set(q.options.map(opt => String(opt).trim().toLowerCase()));
  if (uniqueOptions.size < 4) {
    score -= 6.0;
  }

  // 5. Explanation Check (critical, so major penalty)
  if (!q.explanation || typeof q.explanation !== "string" || q.explanation.trim().length < 30) {
    score -= 6.0;
  }

  // 6. Character Sanity Check (minor penalty)
  // Allow letters, numbers, spaces, standard punctuation, math symbols
  const weirdCharRegex = /[^\w\s.,?()'"\-:;%$/=+*<>!#@&[\]]/;
  if (weirdCharRegex.test(q.question)) {
    score -= 1.5;
  }

  // Keep score within [0, 10]
  return Math.max(0.0, Math.min(10.0, score));
}

/**
 * Filters out low-quality questions based on the threshold score of 5.0.
 * @param {object} q - The question object.
 * @returns {boolean} True if the question is low-quality and should be rejected.
 */
export function isLowQuality(q) {
  const score = calculateQualityScore(q);
  return score < 5.0;
}