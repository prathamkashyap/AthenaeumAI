/**
 * Unit Tests — qualityFilter
 * Tests calculateQualityScore and isLowQuality with a range of question shapes.
 */

import { calculateQualityScore, isLowQuality } from "../../utils/qualityFilter.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeQuestion = (overrides = {}) => ({
  question: "Which layer of the OSI model is responsible for end-to-end communication and error recovery?",
  options: ["Network Layer", "Transport Layer", "Session Layer", "Data Link Layer"],
  answer: 1,
  explanation: "The Transport Layer (Layer 4) is responsible for end-to-end communication and error recovery between hosts.",
  ...overrides,
});

// ─── calculateQualityScore ────────────────────────────────────────────────────

describe("calculateQualityScore — valid high-quality question", () => {
  test("returns 10 for a perfect question", () => {
    expect(calculateQualityScore(makeQuestion())).toBe(10);
  });

  test("returns a number between 0 and 10 for any input", () => {
    const score = calculateQualityScore(makeQuestion());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe("calculateQualityScore — structural disqualifiers", () => {
  test("returns 0 for null input", () => {
    expect(calculateQualityScore(null)).toBe(0);
  });

  test("returns 0 for missing question field", () => {
    expect(calculateQualityScore(makeQuestion({ question: null }))).toBe(0);
  });

  test("returns 0 for question that is not a string", () => {
    expect(calculateQualityScore(makeQuestion({ question: 123 }))).toBe(0);
  });

  test("returns 0 for options that is not an array", () => {
    expect(calculateQualityScore(makeQuestion({ options: "A, B, C, D" }))).toBe(0);
  });

  test("returns 0 for fewer than 4 options", () => {
    expect(calculateQualityScore(makeQuestion({ options: ["A", "B", "C"] }))).toBe(0);
  });

  test("returns 0 for more than 4 options", () => {
    expect(calculateQualityScore(makeQuestion({ options: ["A", "B", "C", "D", "E"] }))).toBe(0);
  });

  test("returns 0 for non-numeric answer index", () => {
    expect(calculateQualityScore(makeQuestion({ answer: "B" }))).toBe(0);
  });

  test("returns 0 for out-of-range answer index (negative)", () => {
    expect(calculateQualityScore(makeQuestion({ answer: -1 }))).toBe(0);
  });

  test("returns 0 for out-of-range answer index (> 3)", () => {
    expect(calculateQualityScore(makeQuestion({ answer: 4 }))).toBe(0);
  });
});

describe("calculateQualityScore — penalty cases", () => {
  test("deducts 2 points for short question (< 40 chars)", () => {
    const q = makeQuestion({ question: "What is TCP?" });
    expect(calculateQualityScore(q)).toBe(8); // -2 for length
  });

  test("deducts 6 points for 'all of the above' ambiguity", () => {
    const q = makeQuestion({ options: ["Network Layer", "Transport Layer", "Session Layer", "All of the above"] });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for 'none of the above' ambiguity", () => {
    const q = makeQuestion({ options: ["Network Layer", "Transport Layer", "Session Layer", "None of the above"] });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for a very short option (< 2 chars)", () => {
    const q = makeQuestion({ options: ["Network Layer", "Transport Layer", "Session Layer", "A"] });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for empty option string", () => {
    const q = makeQuestion({ options: ["Network Layer", "Transport Layer", "Session Layer", ""] });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for duplicate options", () => {
    const q = makeQuestion({ options: ["Network Layer", "Network Layer", "Session Layer", "Data Link Layer"] });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for missing explanation", () => {
    const q = makeQuestion({ explanation: null });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("deducts 6 points for explanation that is too short (< 30 chars)", () => {
    const q = makeQuestion({ explanation: "Too short." });
    expect(calculateQualityScore(q)).toBe(4);
  });

  test("returns 0 (clamped) when multiple major penalties stack", () => {
    const q = makeQuestion({
      options: ["A", "B", "All of the above", "None of the above"],
      explanation: null,
    });
    expect(calculateQualityScore(q)).toBe(0);
  });
});

// ─── isLowQuality ─────────────────────────────────────────────────────────────

describe("isLowQuality", () => {
  test("returns false for a high-quality question (score >= 5)", () => {
    expect(isLowQuality(makeQuestion())).toBe(false);
  });

  test("returns true for a question with ambiguous options (score < 5)", () => {
    const q = makeQuestion({ options: ["Network Layer", "Transport Layer", "Session Layer", "All of the above"] });
    expect(isLowQuality(q)).toBe(true);
  });

  test("returns true for a null question (score = 0)", () => {
    expect(isLowQuality(null)).toBe(true);
  });

  test("returns true for a question with missing explanation and ambiguity combined", () => {
    const q = makeQuestion({
      options: ["Network Layer", "Transport Layer", "Session Layer", "All of the above"],
      explanation: null,
    });
    expect(isLowQuality(q)).toBe(true);
  });

  test("returns false for question with only short-length penalty (score = 8)", () => {
    const q = makeQuestion({ question: "What is TCP?" });
    expect(isLowQuality(q)).toBe(false);
  });
});
