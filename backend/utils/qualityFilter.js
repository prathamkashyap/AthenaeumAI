export function isLowQuality(q) {
  const text = q.question.toLowerCase();

  // reject direct fill-in-the-blank copying
  if (text.includes("fill in the blank")) return true;

  // reject too similar to source pattern
  if (text.length < 30) return true;

  // reject weird encoding
  if (/[^a-zA-Z0-9\s.,?]/.test(q.question)) return true;

  return false;
}

const clean = questions.filter(q => !isLowQuality(q));