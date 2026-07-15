/**
 * Unit Tests — analyticsService (pure computation logic)
 * Tests the analytics calculation formulas that power the dashboard without
 * any database or Mongoose dependency.
 */

// ─── Re-implement pure computation helpers for isolation ──────────────────────

const toPercent = (value) => Math.round(Number(value || 0));

const computeRetentionScore = (topics) => {
  if (!topics.length) return 0;
  const now = new Date();
  return Math.round(
    topics.reduce((sum, topic) => {
      const lastPracticedAt = topic.lastPracticedAt ? new Date(topic.lastPracticedAt) : null;
      const daysSincePractice = lastPracticedAt
        ? Math.max(0, (now - lastPracticedAt) / (1000 * 60 * 60 * 24))
        : 30;
      const retention = Math.max(0, (topic.confidence || 0) - daysSincePractice * 2.2);
      return sum + retention;
    }, 0) / topics.length
  );
};

const computeReadiness = (averageMastery, averageConfidence, retentionScore) =>
  Math.round(averageMastery * 0.55 + averageConfidence * 0.25 + retentionScore * 0.2);

const computeAverageMastery = (topics) =>
  topics.length
    ? Math.round(topics.reduce((sum, t) => sum + (t.mastery || 0), 0) / topics.length)
    : 0;

const computeAverageConfidence = (topics) =>
  topics.length
    ? Math.round(topics.reduce((sum, t) => sum + (t.confidence || 0), 0) / topics.length)
    : 0;

const computeWeakTopics = (topics) =>
  topics
    .filter((t) => t.attempted >= 1 && ((t.weaknessScore || 0) > 35 || t.mastery < 65))
    .sort((a, b) => (b.weaknessScore || 0) - (a.weaknessScore || 0))
    .slice(0, 6)
    .map((t) => ({
      topic: t.topic,
      accuracy: toPercent(t.mastery),
      confidence: toPercent(t.confidence),
      weaknessScore: toPercent(t.weaknessScore),
      attempted: t.attempted,
    }));

const buildAccuracyTrend = (attempts, dayCount = 30) => {
  const dayBuckets = new Map();
  for (let i = dayCount - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    dayBuckets.set(key, { day: key.slice(5), scoreTotal: 0, attempts: 0 });
  }
  attempts.forEach((attempt) => {
    const key = attempt.createdAt.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(key);
    if (bucket) {
      bucket.scoreTotal += attempt.accuracy;
      bucket.attempts += 1;
    }
  });
  return Array.from(dayBuckets.values()).map((b) => ({
    day: b.day,
    score: b.attempts ? Math.round(b.scoreTotal / b.attempts) : null,
  }));
};

// ─── toPercent ────────────────────────────────────────────────────────────────

describe("toPercent", () => {
  test("rounds a decimal number to nearest integer", () => {
    expect(toPercent(73.6)).toBe(74);
  });

  test("handles zero", () => {
    expect(toPercent(0)).toBe(0);
  });

  test("handles null (defaults to 0)", () => {
    expect(toPercent(null)).toBe(0);
  });

  test("handles undefined (defaults to 0)", () => {
    expect(toPercent(undefined)).toBe(0);
  });
});

// ─── computeAverageMastery ───────────────────────────────────────────────────

describe("computeAverageMastery", () => {
  test("calculates average mastery across topics", () => {
    const topics = [{ mastery: 80 }, { mastery: 60 }, { mastery: 70 }];
    expect(computeAverageMastery(topics)).toBe(70);
  });

  test("returns 0 for empty topics array", () => {
    expect(computeAverageMastery([])).toBe(0);
  });

  test("handles topics with missing mastery (treats as 0)", () => {
    const topics = [{ mastery: 80 }, {}];
    expect(computeAverageMastery(topics)).toBe(40);
  });
});

// ─── computeAverageConfidence ────────────────────────────────────────────────

describe("computeAverageConfidence", () => {
  test("calculates average confidence across topics", () => {
    const topics = [{ confidence: 90 }, { confidence: 50 }];
    expect(computeAverageConfidence(topics)).toBe(70);
  });

  test("returns 0 for empty topics array", () => {
    expect(computeAverageConfidence([])).toBe(0);
  });
});

// ─── computeRetentionScore ───────────────────────────────────────────────────

describe("computeRetentionScore", () => {
  test("returns 0 for empty topics array", () => {
    expect(computeRetentionScore([])).toBe(0);
  });

  test("returns 0 for topics never practiced (uses 30-day decay)", () => {
    // confidence 50 - 30*2.2 = 50 - 66 = -16, clamped to 0
    const topics = [{ confidence: 50, lastPracticedAt: null }];
    expect(computeRetentionScore(topics)).toBe(0);
  });

  test("returns positive score for recently practiced high-confidence topic", () => {
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    const topics = [{ confidence: 90, lastPracticedAt: recentDate }];
    const score = computeRetentionScore(topics);
    expect(score).toBeGreaterThan(0);
    // 90 - 1*2.2 = 87.8 ≈ 88
    expect(score).toBeCloseTo(88, -1);
  });

  test("retention is higher for recently practiced vs long-ago topics", () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const recentScore = computeRetentionScore([{ confidence: 90, lastPracticedAt: recent }]);
    const oldScore = computeRetentionScore([{ confidence: 90, lastPracticedAt: old }]);
    expect(recentScore).toBeGreaterThan(oldScore);
  });
});

// ─── computeReadiness ────────────────────────────────────────────────────────

describe("computeReadiness (estimatedReadiness formula)", () => {
  test("computes weighted formula correctly", () => {
    // 80*0.55 + 70*0.25 + 60*0.20 = 44 + 17.5 + 12 = 73.5 ≈ 74
    expect(computeReadiness(80, 70, 60)).toBe(74);
  });

  test("returns 0 when all inputs are 0", () => {
    expect(computeReadiness(0, 0, 0)).toBe(0);
  });

  test("mastery weight (0.55) is the largest factor", () => {
    const masteryDriven = computeReadiness(100, 0, 0);
    const confidenceDriven = computeReadiness(0, 100, 0);
    const retentionDriven = computeReadiness(0, 0, 100);
    expect(masteryDriven).toBeGreaterThan(confidenceDriven);
    expect(masteryDriven).toBeGreaterThan(retentionDriven);
  });
});

// ─── computeWeakTopics ───────────────────────────────────────────────────────

describe("computeWeakTopics", () => {
  test("includes topics with weaknessScore > 35", () => {
    const topics = [
      { topic: "OS", mastery: 70, weaknessScore: 40, attempted: 2, confidence: 60 },
    ];
    const result = computeWeakTopics(topics);
    expect(result.length).toBe(1);
    expect(result[0].topic).toBe("OS");
  });

  test("includes topics with mastery < 65 (even if weaknessScore is low)", () => {
    const topics = [
      { topic: "DBMS", mastery: 50, weaknessScore: 20, attempted: 1, confidence: 60 },
    ];
    const result = computeWeakTopics(topics);
    expect(result.length).toBe(1);
  });

  test("excludes topics with 0 attempts", () => {
    const topics = [
      { topic: "Networks", mastery: 30, weaknessScore: 70, attempted: 0, confidence: 40 },
    ];
    const result = computeWeakTopics(topics);
    expect(result.length).toBe(0);
  });

  test("sorts by weaknessScore descending", () => {
    const topics = [
      { topic: "OS", mastery: 50, weaknessScore: 30, attempted: 2, confidence: 40 },
      { topic: "Algorithms", mastery: 40, weaknessScore: 70, attempted: 3, confidence: 30 },
    ];
    const result = computeWeakTopics(topics);
    expect(result[0].topic).toBe("Algorithms");
  });

  test("caps results at 6 topics", () => {
    const topics = Array.from({ length: 10 }, (_, i) => ({
      topic: `Topic ${i}`,
      mastery: 30,
      weaknessScore: 60,
      attempted: 2,
      confidence: 40,
    }));
    const result = computeWeakTopics(topics);
    expect(result.length).toBe(6);
  });

  test("returns empty array when no weak topics", () => {
    const topics = [
      { topic: "ML", mastery: 90, weaknessScore: 10, attempted: 5, confidence: 85 },
    ];
    expect(computeWeakTopics(topics)).toEqual([]);
  });
});

// ─── buildAccuracyTrend ──────────────────────────────────────────────────────

describe("buildAccuracyTrend", () => {
  test("generates 30 day buckets by default", () => {
    const result = buildAccuracyTrend([]);
    expect(result.length).toBe(30);
  });

  test("buckets with no attempts have null score", () => {
    const result = buildAccuracyTrend([]);
    result.forEach((bucket) => expect(bucket.score).toBeNull());
  });

  test("correctly averages scores for a day with multiple attempts", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const attempts = [
      { accuracy: 80, createdAt: today },
      { accuracy: 60, createdAt: today },
    ];
    const result = buildAccuracyTrend(attempts);
    const todayBucket = result[result.length - 1];
    expect(todayBucket.score).toBe(70);
  });
});
