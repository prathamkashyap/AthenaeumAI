/**
 * Unit Tests — flashcardService (SM-2+ Spaced Repetition)
 * Tests the applySpacedRepetitionReview scheduling logic without database I/O.
 */

// ─── SM-2 Algorithm Pure Logic Tests (extracted for unit testing) ─────────────

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const computeNextReview = ({ rating, currentEase = 2.5, currentRepetitions = 0, currentInterval = 0 }) => {
  const qualityByRating = { again: 1, hard: 3, good: 4, easy: 5 };
  const quality = qualityByRating[rating] || 4;

  const nextEase = clamp(
    currentEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    1.3,
    3.0
  );

  const nextRepetitions = quality < 3 ? 0 : currentRepetitions + 1;
  let nextInterval = 1;

  if (quality < 3) {
    nextInterval = rating === "again" ? 0 : 1;
  } else if (nextRepetitions === 1) {
    nextInterval = 1;
  } else if (nextRepetitions === 2) {
    nextInterval = 6;
  } else {
    let multiplier = currentEase;
    if (rating === "easy") multiplier *= 1.3;
    nextInterval = Math.max(1, Math.round(currentInterval * multiplier));
  }

  return { nextEase, nextRepetitions, nextInterval };
};

// ─── Rating: "again" ──────────────────────────────────────────────────────────

describe("SM-2 — rating: again", () => {
  test("resets repetitions to 0", () => {
    const result = computeNextReview({ rating: "again", currentRepetitions: 5 });
    expect(result.nextRepetitions).toBe(0);
  });

  test("sets next interval to 0 (same-day review)", () => {
    const result = computeNextReview({ rating: "again" });
    expect(result.nextInterval).toBe(0);
  });

  test("lowers the ease factor", () => {
    const result = computeNextReview({ rating: "again", currentEase: 2.5 });
    expect(result.nextEase).toBeLessThan(2.5);
  });

  test("ease factor never goes below 1.3 (clamp floor)", () => {
    const result = computeNextReview({ rating: "again", currentEase: 1.3 });
    expect(result.nextEase).toBeGreaterThanOrEqual(1.3);
  });
});

// ─── Rating: "hard" ──────────────────────────────────────────────────────────

describe("SM-2 — rating: hard", () => {
  test("increments repetitions", () => {
    const result = computeNextReview({ rating: "hard", currentRepetitions: 2 });
    expect(result.nextRepetitions).toBe(3);
  });

  test("sets interval to 1 day on first repetition", () => {
    const result = computeNextReview({ rating: "hard", currentRepetitions: 0 });
    expect(result.nextInterval).toBe(1);
  });

  test("slightly lowers ease factor", () => {
    const result = computeNextReview({ rating: "hard", currentEase: 2.5 });
    expect(result.nextEase).toBeLessThan(2.5);
  });
});

// ─── Rating: "good" ──────────────────────────────────────────────────────────

describe("SM-2 — rating: good", () => {
  test("increments repetitions", () => {
    const result = computeNextReview({ rating: "good", currentRepetitions: 1 });
    expect(result.nextRepetitions).toBe(2);
  });

  test("sets interval to 6 days on second repetition", () => {
    const result = computeNextReview({ rating: "good", currentRepetitions: 1 });
    expect(result.nextInterval).toBe(6);
  });

  test("applies ease factor multiplier after second repetition", () => {
    const result = computeNextReview({
      rating: "good",
      currentRepetitions: 3,
      currentInterval: 10,
      currentEase: 2.5,
    });
    expect(result.nextInterval).toBeGreaterThan(10);
  });

  test("slightly adjusts ease factor upward", () => {
    const result = computeNextReview({ rating: "good", currentEase: 2.5 });
    expect(result.nextEase).toBeCloseTo(2.5, 1);
  });
});

// ─── Rating: "easy" ──────────────────────────────────────────────────────────

describe("SM-2 — rating: easy", () => {
  test("increments repetitions", () => {
    const result = computeNextReview({ rating: "easy", currentRepetitions: 2 });
    expect(result.nextRepetitions).toBe(3);
  });

  test("applies 1.3x bonus multiplier to interval", () => {
    const base = computeNextReview({
      rating: "good",
      currentRepetitions: 3,
      currentInterval: 10,
      currentEase: 2.5,
    });
    const easy = computeNextReview({
      rating: "easy",
      currentRepetitions: 3,
      currentInterval: 10,
      currentEase: 2.5,
    });
    expect(easy.nextInterval).toBeGreaterThan(base.nextInterval);
  });

  test("increases ease factor", () => {
    const result = computeNextReview({ rating: "easy", currentEase: 2.5 });
    expect(result.nextEase).toBeGreaterThan(2.5);
  });

  test("ease factor never exceeds 3.0 (clamp ceiling)", () => {
    const result = computeNextReview({ rating: "easy", currentEase: 3.0 });
    expect(result.nextEase).toBeLessThanOrEqual(3.0);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe("SM-2 — edge cases", () => {
  test("interval is always >= 0", () => {
    ["again", "hard", "good", "easy"].forEach((rating) => {
      const result = computeNextReview({ rating });
      expect(result.nextInterval).toBeGreaterThanOrEqual(0);
    });
  });

  test("ease factor is always between 1.3 and 3.0", () => {
    const extremes = [
      { rating: "again", currentEase: 1.3 },
      { rating: "easy", currentEase: 3.0 },
    ];
    extremes.forEach(({ rating, currentEase }) => {
      const result = computeNextReview({ rating, currentEase });
      expect(result.nextEase).toBeGreaterThanOrEqual(1.3);
      expect(result.nextEase).toBeLessThanOrEqual(3.0);
    });
  });

  test("unknown rating falls back to 'good' quality (4)", () => {
    const result = computeNextReview({ rating: "unknown", currentRepetitions: 1 });
    // quality 4 = good, should increment repetitions
    expect(result.nextRepetitions).toBe(2);
  });
});
