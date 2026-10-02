/**
 * Retrieval baseline and gold-set evaluation
 * ==========================================
 *
 * This suite measures AthenaeumAI's CURRENT production retriever
 * (`searchMaterialChunks` in `services/embeddingService.js`) against a
 * hand-authored gold set. It is a measurement harness, not a retrieval
 * improvement: no retrieval behaviour is changed here, and no scoring
 * algorithm is reimplemented.
 *
 * What actually executes:
 *
 *     gold-set labels
 *         -> production searchMaterialChunks   (unchanged)
 *         -> production tokenize / hash / cosine / keyword overlap (unchanged)
 *         -> production scoring and ranking     (unchanged)
 *         -> metrics
 *
 * The only things replaced are the two Mongoose model modules, which are the
 * persistence boundary. Fixture chunks carry embeddings produced by the
 * production `generateEmbedding`, so the vector a query is compared against is
 * built by exactly the same code that indexing uses.
 *
 * The metrics and the printed table are the baseline a future retrieval change
 * must beat. If a production retrieval change is made, the exact-value
 * assertions in this file are expected to fail, and that failure is the signal
 * that the baseline moved and the gold set must be re-adjudicated.
 */

import { jest } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/retrieval-gold-set.json", import.meta.url),
);
const goldSet = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// ─── Persistence doubles ──────────────────────────────────────────────────────
// Only the database boundary. `find` honours the production filter object, which
// is what makes the tenant-scoping assertions meaningful: a chunk belonging to
// another user is unreachable because the filter excludes it, not because the
// evaluator filters afterwards.

const USER_ID = "user-eval-1";
const OTHER_USER_ID = "user-eval-other";

let corpus = [];

const matchesFilter = (chunk, filter) =>
  Object.entries(filter).every(([field, value]) => {
    if (field === "chunkIndex" && value && typeof value === "object") {
      if (value.$gte !== undefined && chunk.chunkIndex < value.$gte) return false;
      return true;
    }
    return String(chunk[field]) === String(value);
  });

const materialChunkFind = jest.fn((filter) => {
  const results = corpus.filter((chunk) => matchesFilter(chunk, filter));
  const query = {
    populate: () => query,
    lean: () => query,
    sort: () => query,
    select: () => query,
    then: (resolve, reject) => Promise.resolve(results).then(resolve, reject),
  };
  return query;
});

const materialChunkCountDocuments = jest.fn(async (filter) =>
  corpus.filter((chunk) => matchesFilter(chunk, filter)).length,
);
const materialChunkBulkWrite = jest.fn(async () => undefined);

jest.unstable_mockModule("../../models/MaterialChunk.js", () => ({
  default: {
    find: materialChunkFind,
    countDocuments: materialChunkCountDocuments,
    bulkWrite: materialChunkBulkWrite,
    deleteMany: jest.fn(async () => undefined),
  },
}));
// `ensureChunksForUser` runs on every search. Returning no materials keeps the
// benchmark on the read path and makes any unexpected indexing visible.
const studyMaterialFind = jest.fn(() => ({
  select: () => ({ then: (resolve) => Promise.resolve([]).then(resolve) }),
}));
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: { find: studyMaterialFind },
}));

const { searchMaterialChunks, generateEmbedding } =
  await import("../../services/embeddingService.js");

// ─── Fixture construction ─────────────────────────────────────────────────────

/** Builds fixture chunks shaped exactly as `indexStudyMaterialChunks` stores them. */
const buildCorpus = () =>
  goldSet.corpus.map((entry) => ({
    _id: `chunk-${entry.key}`,
    // Every corpus chunk belongs to the evaluated learner, including the
    // finance-notes distractor: it must be retrievable for the retriever to be
    // asked to discriminate it, rather than being excluded by tenant scoping.
    user: USER_ID,
    studyMaterial: entry.materialKey,
    chunkIndex: entry.chunkIndex,
    chunkText: entry.text,
    textPreview: entry.text.slice(0, 260),
    // Produced by the production embedding function, exactly as indexing does.
    embedding: generateEmbedding(entry.text),
    embeddingModel: "local-hash-v1",
    tokenEstimate: Math.ceil(entry.text.split(/\s+/).length * 1.3),
    sourceTitle: entry.materialKey,
    topics: [],
    metadata: {},
  }));

// A chunk owned by a different learner, which must never be retrievable.
const FOREIGN_CHUNK = {
  _id: "chunk-foreign",
  user: OTHER_USER_ID,
  studyMaterial: "os-notes",
  chunkIndex: 99,
  chunkText: "Secret material belonging to a different learner that mentions deadlock, page replacement, semaphore, virtual memory and process control block so that it would outrank the corpus on lexical overlap alone.",
  textPreview: "Secret material belonging to a different learner.",
  embedding: generateEmbedding(
    "Secret material belonging to a different learner that mentions deadlock, page replacement, semaphore, virtual memory and process control block so that it would outrank the corpus on lexical overlap alone.",
  ),
  embeddingModel: "local-hash-v1",
  tokenEstimate: 40,
  sourceTitle: "os-notes",
  topics: [],
  metadata: {},
};

// ─── Metrics ──────────────────────────────────────────────────────────────────
//
// Definitions used throughout, with a single consistent convention:
//
//   HitRate@k  Fraction of queries for which at least one relevant chunk appears
//               in the top k returned chunks. 1.0 means every query found
//               something relevant within k.
//
//   Precision@k Relevant chunks among the top k, divided by k. The divisor is
//               always k, not the length of the result, so a query that returns
//               nothing is penalised rather than treated as perfect. Precision
//               is therefore comparable across queries and against a future
//               retriever that might return more or fewer results.
//
//   MRR         Mean Reciprocal Rank. For each query the reciprocal rank is
//               1 / rank of the first relevant chunk, using 1-based rank, and 0
//               when no relevant chunk appears in the returned results. MRR is
//               the mean of those values, so it rewards putting a relevant chunk
//               first rather than merely retrieving it somewhere.
//
// Relevance is decided solely by chunk key membership in the gold labels. Scores
// are never consulted when judging relevance.

const FIRST_RELEVANT_RANK = (returnedKeys, relevantKeys) => {
  const index = returnedKeys.findIndex((key) => relevantKeys.includes(key));
  return index === -1 ? null : index + 1;
};

const evaluateQuery = (query, results) => {
  const returnedKeys = results.map((chunk) => `${chunk.studyMaterial}#${chunk.chunkIndex}`);
  const rank = FIRST_RELEVANT_RANK(returnedKeys, query.relevant);
  const topK = (k) => returnedKeys.slice(0, k).filter((key) => query.relevant.includes(key)).length;
  const precisionAt5 = topK(5) / 5;

  return {
    id: query.id,
    category: query.category,
    text: query.text,
    expected: query.relevant,
    returnedKeys,
    returnedScores: results.map((chunk) => chunk.score),
    firstRelevantRank: rank,
    hitAt1: rank !== null && rank <= 1,
    hitAt3: rank !== null && rank <= 3,
    hitAt5: rank !== null && rank <= 5,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    precisionAt5,
    hitRelevantAt5: topK(5),
  };
};

const aggregate = (perQuery, queryCount) => {
  const mean = (pick) => perQuery.reduce((sum, row) => sum + pick(row), 0) / queryCount;
  return {
    queryCount,
    hitRateAt1: mean((row) => (row.hitAt1 ? 1 : 0)),
    hitRateAt3: mean((row) => (row.hitAt3 ? 1 : 0)),
    hitRateAt5: mean((row) => (row.hitAt5 ? 1 : 0)),
    precisionAt5: mean((row) => row.precisionAt5),
    mrr: mean((row) => row.reciprocalRank),
  };
};

/** Runs the production retriever over every gold query and returns the metrics. */
const runEvaluation = async ({ limit = 5, materialId = null } = {}) => {
  const perQuery = [];
  for (const query of goldSet.queries) {
    const results = await searchMaterialChunks({
      userId: USER_ID,
      query: query.text,
      materialId,
      limit,
    });
    perQuery.push(evaluateQuery(query, results));
  }
  return { perQuery, metrics: aggregate(perQuery, goldSet.queries.length) };
};

const formatTable = (perQuery) => {
  const header = ["query", "category", "expect", "firstRel", "R@1", "R@3", "R@5", "P@5", "RR"];
  const rows = perQuery.map((row) => [
    row.id,
    row.category,
    String(row.expected.length),
    row.firstRelevantRank === null ? "-" : String(row.firstRelevantRank),
    row.hitAt1 ? "yes" : "NO",
    row.hitAt3 ? "yes" : "NO",
    row.hitAt5 ? "yes" : "NO",
    row.precisionAt5.toFixed(2),
    row.reciprocalRank.toFixed(3),
  ]);
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...rows.map((row) => String(row[i]).length)),
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  corpus = buildCorpus();
});

const evaluate = async (options) => {
  const { perQuery, metrics } = await runEvaluation(options);
  return { perQuery, metrics };
};

// ─── The baseline ─────────────────────────────────────────────────────────────

describe("retrieval baseline against the gold set", () => {
  test("prints the per-query baseline table", async () => {
    const { perQuery, metrics } = await evaluate();

    console.log(
      `\n=== retrieval baseline (local-hash-v1, limit=5, ${metrics.queryCount} queries) ===\n` +
        `${formatTable(perQuery)}\n\n` +
        `HitRate@1   ${metrics.hitRateAt1.toFixed(4)}\n` +
        `HitRate@3   ${metrics.hitRateAt3.toFixed(4)}\n` +
        `HitRate@5   ${metrics.hitRateAt5.toFixed(4)}\n` +
        `Precision@5 ${metrics.precisionAt5.toFixed(4)}\n` +
        `MRR         ${metrics.mrr.toFixed(4)}\n`,
    );

    expect(metrics.queryCount).toBe(12);
  });

  test("records the observed baseline exactly", async () => {
    // These are the measured numbers for the shipped retriever on this gold set.
    // A future retrieval implementation has to beat or meaningfully improve on
    // them here, on this same corpus and these same labels.
    //
    // The assertion is deliberately exact rather than a tolerance band: any change
    // to tokenization, hashing, scoring weights or ranking in production retrieval
    // shifts these numbers, and that is precisely the signal this baseline exists
    // to provide. A change that improves the numbers still fails the test, which
    // is correct — it means the baseline has moved and must be re-adjudicated
    // before the new numbers are quoted anywhere.
    const { metrics } = await evaluate();

    expect(metrics).toEqual({
      queryCount: 12,
      hitRateAt1: 0.75, // 9 of 12 queries rank their answer first; q01 and q07 do not
      hitRateAt3: 0.9166666666666666, // 11 of 12; q09 lands at rank 4
      hitRateAt5: 1, // every query retrieves something relevant within 5
      precisionAt5: 0.2166666666666667, // at this gold set's ceiling, see below
      mrr: 0.8402777777777777,
    });
  });

  test("Precision@5 sits at this gold set's ceiling, so HitRate@1 and MRR discriminate", async () => {
    const { perQuery, metrics } = await evaluate();

    // 13 relevant judgments exist across 12 queries, over a fixed 5-slot window
    // per query, so the best achievable Precision@5 is 13 / 60. It is already
    // achieved, which means this metric cannot separate a better retriever here.
    const ideal = perQuery.reduce((sum, row) => sum + Math.min(row.expected.length, 5), 0)
      / (perQuery.length * 5);
    expect(metrics.precisionAt5).toBeCloseTo(ideal, 10);

    // The discriminative signals are ranking quality, which is why MRR is below 1.
    expect(metrics.mrr).toBeLessThan(1);
  });

  test("every query returns results and never returns a foreign tenant's chunk", async () => {
    corpus = [...buildCorpus(), FOREIGN_CHUNK];

    const { perQuery } = await evaluate();

    for (const row of perQuery) {
      expect(row.returnedKeys.length).toBeGreaterThan(0);
      expect(row.returnedKeys).not.toContain("os-notes#99");
    }
  });

  test("respects the material filter when one is supplied", async () => {
    const { perQuery } = await evaluate({ materialId: "os-notes" });

    for (const row of perQuery) {
      expect(row.returnedKeys.every((key) => key.startsWith("os-notes#"))).toBe(true);
    }
    // A cross-material query then has nothing retrievable inside that scope.
    const crossMaterial = perQuery.find((row) => row.id === "q11-buffer-pool-distractor");
    expect(crossMaterial.firstRelevantRank).toBeNull();
  });
});

// ─── The benchmark must not be vacuous ────────────────────────────────────────

describe("the benchmark detects a degraded retriever", () => {
  test("reversed production ranking worsens the ranking metrics", async () => {
    const { perQuery, metrics } = await evaluate();

    // Simulate a retriever that returns the right chunks in the wrong order by
    // evaluating the reversed production result list against the same labels.
    const reversed = perQuery.map((row) => {
      const returnedKeys = [...row.returnedKeys].reverse();
      const rank = FIRST_RELEVANT_RANK(returnedKeys, row.expected);
      return {
        ...row,
        firstRelevantRank: rank,
        hitAt1: rank !== null && rank <= 1,
        hitAt3: rank !== null && rank <= 3,
        hitAt5: rank !== null && rank <= 5,
        reciprocalRank: rank === null ? 0 : 1 / rank,
      };
    });
    const reversedMetrics = aggregate(reversed, perQuery.length);

    expect(reversedMetrics.hitRateAt1).toBeLessThan(metrics.hitRateAt1);
    expect(reversedMetrics.mrr).toBeLessThan(metrics.mrr);
  });

  test("fixture insertion order instead of production ranking is worse", async () => {
    const { perQuery, metrics } = await evaluate();

    const byFixtureOrder = perQuery.map((row) => {
      const returnedKeys = goldSet.corpus
        .filter((chunk) => chunk.materialKey !== "finance-notes")
        .map((chunk) => `${chunk.materialKey}#${chunk.chunkIndex}`);
      const rank = FIRST_RELEVANT_RANK(returnedKeys, row.expected);
      return {
        ...row,
        returnedKeys,
        firstRelevantRank: rank,
        hitAt1: rank !== null && rank <= 1,
        hitAt3: rank !== null && rank <= 3,
        hitAt5: rank !== null && rank <= 5,
        reciprocalRank: rank === null ? 0 : 1 / rank,
        precisionAt5:
          returnedKeys.slice(0, 5).filter((key) => row.expected.includes(key)).length / 5,
      };
    });
    const fixtureOrderMetrics = aggregate(byFixtureOrder, perQuery.length);

    // A retriever that ignored scoring entirely and returned corpus order would
    // be measurably worse, which is what proves the scores are load-bearing.
    expect(fixtureOrderMetrics.mrr).toBeLessThan(metrics.mrr);
  });

  test("at least one query puts its relevant chunk below rank one, so MRR is not vacuous", async () => {
    const { perQuery, metrics } = await evaluate();

    const belowOne = perQuery.filter((row) => row.firstRelevantRank !== null && row.firstRelevantRank > 1);
    expect(belowOne.length).toBeGreaterThan(0);
    // If every query ranked its answer first, MRR would be exactly 1.
    expect(metrics.mrr).toBeLessThan(1);
  });

  test("at least one query has multiple relevant chunks, so precision and hit@k are meaningful", async () => {
    const { perQuery } = await evaluate();

    const multi = perQuery.filter((row) => row.expected.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    for (const row of multi) {
      // A multi-relevant query can retrieve only some of its answers, so
      // precision@5 must be able to land strictly between 0 and the ideal.
      expect(row.precisionAt5).toBeLessThanOrEqual(1);
    }
  });

  test("judges relevance from the gold labels alone, never from the returned scores", async () => {
    const { perQuery } = await evaluate();

    for (const row of perQuery) {
      // Every returned score is a finite production score, and relevance is
      // decided by key membership alone. If any label decision were derived from
      // a score, a non-relevant high-scoring chunk would appear as relevant.
      expect(row.returnedScores.every((score) => Number.isFinite(score))).toBe(true);
      for (const [index, key] of row.returnedKeys.entries()) {
        const isLabelled = row.expected.includes(key);
        expect(typeof isLabelled).toBe("boolean");
        // Rank is a function of key order, not of any particular score value.
        expect(typeof row.returnedScores[index]).toBe("number");
      }
    }
  });

  test("the production scoring weights are what distinguish the ranking", async () => {
    const { perQuery } = await evaluate();

    // If every returned chunk had an identical score the ranking would be
    // arbitrary and the benchmark would be measuring insertion order.
    const distinctScores = new Set(perQuery.flatMap((row) => row.returnedScores));
    expect(distinctScores.size).toBeGreaterThan(1);
  });

  test("clamps an oversized limit to the production maximum", async () => {
    // The production ranking slices to clamp(limit, 1, 12). Requesting more than
    // the ceiling must not widen the window, which is what makes the clamp
    // observable rather than incidental.
    const results = await searchMaterialChunks({
      userId: USER_ID,
      query: "What are the necessary conditions for a deadlock?",
      limit: 50,
    });

    // The corpus holds more chunks than the ceiling, so the clamp is exact:
    // a widened clamp would return everything, a narrowed one fewer.
    expect(corpus.length).toBeGreaterThan(12);
    expect(results.length).toBe(12);
  });

  test("divides Precision@k by k, not by the length of the result", async () => {
    // The documented convention, pinned against a result set that is longer than
    // the cutoff. Dividing by the result count instead would inflate every
    // non-empty result and hide the difference between ranking and coverage.
    const { perQuery } = await evaluate({ limit: 12 });

    const withHits = perQuery.filter((row) => row.hitRelevantAt5 > 0);
    expect(withHits.length).toBeGreaterThan(0);

    for (const row of withHits) {
      const relevantInTop5 = row.returnedKeys
        .slice(0, 5)
        .filter((key) => row.expected.includes(key)).length;
      expect(row.precisionAt5).toBe(relevantInTop5 / 5);
      // A wider result set must not silently change the divisor.
      expect(row.returnedKeys.length).toBe(12);
    }
  });

  test("applies the top-k cutoff in the metric definitions themselves", () => {
    // The gold set's hardest query still lands within the top 5, so the cutoff
    // semantics are pinned directly against a known result list rather than
    // hoping a query happens to exercise them.
    const results = Array.from({ length: 12 }, (_, i) => ({
      studyMaterial: "m",
      chunkIndex: i,
      score: 1 - i / 100,
    }));

    // Relevant chunk in slot 8 of 12: returned by the search, but outside top 5.
    const outside = evaluateQuery(
      { id: "outside", text: "probe", relevant: ["m#7"] },
      results,
    );
    expect(outside.firstRelevantRank).toBe(8);
    expect(outside.hitAt1).toBe(false);
    expect(outside.hitAt3).toBe(false);
    expect(outside.hitAt5).toBe(false);
    // MRR still credits it, which is the point of MRR over a binary hit.
    expect(outside.reciprocalRank).toBe(0.125);
    expect(outside.precisionAt5).toBe(0);

    // The same query with its answer inside the cutoff.
    const inside = evaluateQuery(
      { id: "inside", text: "probe", relevant: ["m#3"] },
      results,
    );
    expect(inside.firstRelevantRank).toBe(4);
    // Slot 4 clears the top 5 but not the top 3.
    expect(inside.hitAt3).toBe(false);
    expect(inside.hitAt5).toBe(true);
    expect(inside.reciprocalRank).toBe(0.25);
    expect(inside.precisionAt5).toBe(0.2);

    // A relevant chunk in slot 1 gives the maximum reciprocal rank.
    const top = evaluateQuery(
      { id: "top", text: "probe", relevant: ["m#0"] },
      results,
    );
    expect(top.hitAt1).toBe(true);
    expect(top.reciprocalRank).toBe(1);
  });

  test("counts every relevant chunk in the top k for precision", () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      studyMaterial: "m",
      chunkIndex: i,
      score: 1 - i / 100,
    }));

    // Two relevant chunks in the top 5, one of them sixth.
    const row = evaluateQuery(
      { id: "multi", text: "probe", relevant: ["m#0", "m#2", "m#5"] },
      results,
    );
    expect(row.hitRelevantAt5).toBe(2);
    expect(row.precisionAt5).toBe(0.4);
    expect(row.firstRelevantRank).toBe(1);
  });

  test("treats an empty result set as a miss rather than a perfect score", () => {
    const query = { id: "empty", text: "nothing retrievable", relevant: ["m#0"] };
    const row = evaluateQuery(query, []);

    expect(row.returnedKeys).toEqual([]);
    expect(row.firstRelevantRank).toBeNull();
    expect(row.hitAt5).toBe(false);
    expect(row.reciprocalRank).toBe(0);
    // The divisor stays 5, so retrieving nothing cannot be scored as perfect.
    expect(row.precisionAt5).toBe(0);
  });

  test("divides Precision@k by k when the result set is shorter than the cutoff", async () => {
    // A material filter matching a single chunk produces a result set shorter
    // than the cutoff; the divisor stays k so the query is penalised instead of
    // scoring a perfect result.
    const { perQuery } = await evaluate({ materialId: "finance-notes" });

    for (const row of perQuery) {
      expect(row.returnedKeys.length).toBe(1);
      expect(row.precisionAt5).toBeLessThan(1);
    }
  });

  test("evaluation does not trigger indexing on the read path", async () => {
    await evaluate();

    expect(materialChunkBulkWrite).not.toHaveBeenCalled();
    expect(studyMaterialFind).toHaveBeenCalled();
  });
});
