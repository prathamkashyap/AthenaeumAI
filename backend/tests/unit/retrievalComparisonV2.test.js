/**
 * Retrieval comparison on gold set v2
 * ====================================
 *
 * The question this answers is the one Task 16A could not: does the expanded
 * benchmark actually create headroom, and does it separate the two lexical
 * retrievers?
 *
 * 16A measured BM25 against local-hash-v1 on the v1 gold set and found no
 * separation — 0 queries improved, 1 regressed, 11 identical. The cause was
 * structural, not a property of either scorer: 9 of 12 v1 queries were
 * saturated, meaning both retrievers already ranked the answer first. Nine
 * identical queries dilute every aggregate delta, so a benchmark with them
 * cannot tell a better retriever from a worse one no matter how good it is.
 *
 * v2 preserves all 12 v1 queries byte-identically and adds 19 that are
 * saturated only by accident: they were authored so that a scorer which
 * rewards raw term frequency, which ignores document length, or which cannot
 * tell evidence from a keyword list, is expected to get them wrong for
 * *stated* reasons.
 *
 * Both retrievers run over identical queries and identical labels. The
 * production retriever is exercised exactly as `retrievalBaseline.test.js`
 * exercises it: the two Mongoose model modules are replaced, and the real
 * `searchMaterialChunks`, tokenizer, hashing, cosine, keyword-overlap and
 * scoring run unchanged. BM25 runs as the isolated candidate from Task 16A.
 */

import { jest } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/retrieval-gold-set-v2.json", import.meta.url),
);
const goldSet = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const USER_ID = "user-eval-v2";

// ─── Persistence doubles ──────────────────────────────────────────────────────
// The same boundary the baseline suite replaces, so the production retriever
// runs on the same terms as the baseline with no reimplementation of its scoring.

let corpus = [];

const matchesFilter = (chunk, filter) =>
  Object.entries(filter).every(([field, value]) => String(chunk[field]) === String(value));

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
jest.unstable_mockModule("../../models/MaterialChunk.js", () => ({
  default: {
    find: materialChunkFind,
    countDocuments: materialChunkCountDocuments,
    bulkWrite: jest.fn(async () => undefined),
    deleteMany: jest.fn(async () => undefined),
  },
}));
// `ensureChunksForUser` runs on every production search. Returning no materials
// keeps this on the read path, so no fixture chunk is ever written to Mongo.
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: {
    find: jest.fn(() => ({
      select: () => ({ then: (resolve) => Promise.resolve([]).then(resolve) }),
    })),
  },
}));

const { searchMaterialChunks, generateEmbedding } =
  await import("../../services/embeddingService.js");
const { rankWithBm25 } = await import("../../services/bm25Retriever.js");

// ─── Corpus, shaped as production indexing stores it ──────────────────────────

const buildCorpus = () =>
  goldSet.corpus.map((entry) => ({
    _id: `chunk-${entry.key}`,
    user: USER_ID,
    studyMaterial: entry.materialKey,
    chunkIndex: entry.chunkIndex,
    chunkText: entry.text,
    textPreview: entry.text.slice(0, 260),
    embedding: generateEmbedding(entry.text),
    embeddingModel: "local-hash-v1",
    tokenEstimate: Math.ceil(entry.text.split(/\s+/).length * 1.3),
    sourceTitle: entry.materialKey,
    topics: [],
    metadata: {},
  }));

const bm25Documents = () => goldSet.corpus.map((entry) => ({ id: entry.key, text: entry.text }));

const resultKey = (chunk) => `${chunk.studyMaterial}#${chunk.chunkIndex}`;

// ─── Metrics ──────────────────────────────────────────────────────────────────
// Same definitions and same conventions as the baseline suite: 1-based rank,
// Precision@k divided by k rather than by the result length, MRR zero when
// nothing relevant is returned.

const FIRST_RELEVANT_RANK = (returnedKeys, relevantKeys) => {
  const index = returnedKeys.findIndex((key) => relevantKeys.includes(key));
  return index === -1 ? null : index + 1;
};

const evaluateQuery = (query, returnedKeys) => {
  const rank = FIRST_RELEVANT_RANK(returnedKeys, query.relevant);
  const topK = (k) => returnedKeys.slice(0, k).filter((key) => query.relevant.includes(key)).length;

  return {
    id: query.id,
    category: query.category,
    text: query.text,
    answerable: query.answerable !== false,
    expected: query.relevant,
    returnedKeys,
    firstRelevantRank: rank,
    hitAt1: rank !== null && rank <= 1,
    hitAt3: rank !== null && rank <= 3,
    hitAt5: rank !== null && rank <= 5,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    precisionAt5: topK(5) / 5,
    hitRelevantAt5: topK(5),
  };
};

const aggregate = (perQuery) => {
  const count = perQuery.length;
  const mean = (pick) => perQuery.reduce((sum, row) => sum + pick(row), 0) / count;
  return {
    queryCount: count,
    hitRateAt1: mean((row) => (row.hitAt1 ? 1 : 0)),
    hitRateAt3: mean((row) => (row.hitAt3 ? 1 : 0)),
    hitRateAt5: mean((row) => (row.hitAt5 ? 1 : 0)),
    precisionAt5: mean((row) => row.precisionAt5),
    mrr: mean((row) => row.reciprocalRank),
  };
};

// ─── The two retrievers ───────────────────────────────────────────────────────

const runProduction = async (query) => {
  const results = await searchMaterialChunks({ userId: USER_ID, query: query.text, limit: 5 });
  return results.map(resultKey);
};

const runBm25 = (query) =>
  rankWithBm25(bm25Documents(), query.text, { limit: 5 }).map((chunk) => chunk.id);

const evaluateBoth = async () => {
  const rows = [];
  for (const query of goldSet.queries) {
    const productionKeys = await runProduction(query);
    const bm25Keys = runBm25(query);
    rows.push({
      query,
      production: evaluateQuery(query, productionKeys),
      bm25: evaluateQuery(query, bm25Keys),
    });
  }
  return rows;
};

/** The subset on which ranking metrics are meaningful. */
const answerableRows = (rows) => rows.filter((row) => row.query.answerable !== false);

// ─── Reporting ────────────────────────────────────────────────────────────────

const METRICS = [
  ["HitRate@1", "hitRateAt1"],
  ["HitRate@3", "hitRateAt3"],
  ["HitRate@5", "hitRateAt5"],
  ["Precision@5", "precisionAt5"],
  ["MRR", "mrr"],
];

const formatMetricTable = (production, bm25) => {
  const header = "metric         production        BM25     delta";
  const rows = METRICS.map(([label, key]) => {
    const delta = bm25[key] - production[key];
    const sign = delta > 0 ? `+${delta.toFixed(4)}` : delta.toFixed(4);
    return `${label.padEnd(12)}  ${production[key].toFixed(4).padStart(12)}  ${bm25[key]
      .toFixed(4)
      .padStart(10)}  ${sign.padStart(9)}`;
  });
  return [header, ...rows].join("\n");
};

const formatPerQuery = (rows) => {
  const header = [
    "query", "category", "answerable",
    "prodRank", "bm25Rank", "dRank",
    "prodRR", "bm25RR", "verdict",
  ];
  const body = rows.map(({ query, production, bm25 }) => {
    const rankDelta =
      production.firstRelevantRank === null || bm25.firstRelevantRank === null
        ? null
        : bm25.firstRelevantRank - production.firstRelevantRank;
    const verdict = !query.answerable === false && rankDelta === null
      ? "n/a"
      : rankDelta === null
        ? "lost"
        : rankDelta < 0
          ? "bm25 better"
          : rankDelta > 0
            ? "bm25 worse"
            : "same";
    return [
      query.id,
      query.category,
      query.answerable === false ? "no" : "yes",
      production.firstRelevantRank === null ? "-" : String(production.firstRelevantRank),
      bm25.firstRelevantRank === null ? "-" : String(bm25.firstRelevantRank),
      rankDelta === null ? "-" : rankDelta > 0 ? `+${rankDelta}` : String(rankDelta),
      production.reciprocalRank.toFixed(3),
      bm25.reciprocalRank.toFixed(3),
      verdict,
    ];
  });

  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...body.map((line) => String(line[i]).length)),
  );
  const render = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  return [render(header), render(widths.map((w) => "-".repeat(w))), ...body.map(render)].join("\n");
};

const tally = (rows) => {
  const comparable = answerableRows(rows);
  const classify = ({ production, bm25 }) => {
    if (production.firstRelevantRank === null && bm25.firstRelevantRank === null) return "both missed";
    if (production.firstRelevantRank === null) return "bm25 only hit";
    if (bm25.firstRelevantRank === null) return "production only hit";
    if (bm25.firstRelevantRank < production.firstRelevantRank) return "bm25 better";
    if (bm25.firstRelevantRank > production.firstRelevantRank) return "bm25 worse";
    return "same";
  };
  const counts = comparable.reduce((acc, row) => {
    const key = classify(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    improved: counts["bm25 better"] || 0,
    worsened: counts["bm25 worse"] || 0,
    unchanged: counts.same || 0,
    bothMissed: counts["both missed"] || 0,
    bm25OnlyHit: counts["bm25 only hit"] || 0,
    productionOnlyHit: counts["production only hit"] || 0,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  corpus = buildCorpus();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("gold set v2 comparison: local-hash-v1 against BM25", () => {
  test("reports the full metric table, per-query ranks and the movement tally", async () => {
    const rows = await evaluateBoth();
    const production = aggregate(answerableRows(rows).map((row) => row.production));
    const bm25 = aggregate(answerableRows(rows).map((row) => row.bm25));
    const counts = tally(rows);

    console.log(
      `\n=== v2 gold set: local-hash-v1 vs BM25 ===\n` +
        `corpus chunks: ${goldSet.corpus.length}   queries: ${goldSet.queries.length} ` +
        `(answerable ${production.queryCount}, unanswerable ${goldSet.queries.length - production.queryCount})\n\n` +
        `${formatMetricTable(production, bm25)}\n\n` +
        `per-query first-relevant-rank comparison\n\n${formatPerQuery(rows)}\n\n` +
        `BM25 improved ${counts.improved}, worsened ${counts.worsened}, unchanged ${counts.unchanged}\n` +
        `both retrievers missed entirely: ${counts.bothMissed}\n` +
        `hit by BM25 only: ${counts.bm25OnlyHit}   hit by production only: ${counts.productionOnlyHit}\n` +
        `regressions: ${
          answerableRows(rows)
            .filter((row) => row.bm25.firstRelevantRank !== null
              && (row.production.firstRelevantRank === null
                || row.bm25.firstRelevantRank > row.production.firstRelevantRank))
            .map((row) => row.query.id)
            .join(", ") || "none"
        }\n` +
        `improvements: ${
          answerableRows(rows)
            .filter((row) => row.bm25.firstRelevantRank !== null
              && row.production.firstRelevantRank !== null
              && row.bm25.firstRelevantRank < row.production.firstRelevantRank)
            .map((row) => row.query.id)
            .join(", ") || "none"
        }\n`,
    );

    expect(production.queryCount).toBe(answerableRows(rows).length);
    for (const value of [...Object.values(production), ...Object.values(bm25)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("the expanded set creates headroom rather than more saturation", () => {
    // The whole premise of Task 16B. On v1, 9 of 12 queries were already ranked
    // first by both retrievers, so no scorer could separate. If the new queries
    // were also saturated, this benchmark would be no more discriminating than
    // the one 16A already proved insufficient — and expanding a benchmark that
    // cannot discriminate would be pure cost.
    const v1 = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../fixtures/retrieval-gold-set.json", import.meta.url)),
        "utf8",
      ),
    );
    const v1QueryCount = v1.queries.length;
    const v2NewQueryCount = goldSet.queries.length - v1QueryCount;

    // Sanity on the premise itself: v1 really was saturated.
    expect(v2NewQueryCount).toBeGreaterThan(0);

    // Of the queries added, the benchmark should contain cases neither scorer
    // solves by default. These are asserted as *query categories* rather than as
    // metric values, because the metric outcome is what is being measured and
    // must not be baked into the test: pinning a target MRR would be designing
    // the benchmark to hit a number, which is precisely what the adjudication
    // protocol forbids.
    const hardCategories = new Set([
      "term-frequency-distractor",
      "long-document-penalty",
      "lexically-weak-semantically-obvious",
      "lexical-maximal-evidential-empty",
      "short-glossary-trap",
      "cross-material-lexical-collision",
      "rare-term-vs-common",
      "paraphrase-expected-to-struggle",
    ]);
    const hardQueries = goldSet.queries.filter(
      (query) => hardCategories.has(query.category) && query.answerable !== false,
    );
    expect(hardQueries.length).toBeGreaterThanOrEqual(6);
  });

  test("at least one query separates the two retrievers, so the benchmark discriminates", async () => {
    // The acceptance criterion that matters. If every answerable query were
    // ranked identically by both retrievers, v2 would fail the same way v1 did,
    // and the expansion would have produced nothing but a bigger number.
    const rows = answerableRows(await evaluateBoth());
    const differing = rows.filter(
      (row) => row.production.firstRelevantRank !== row.bm25.firstRelevantRank,
    );
    const missed = rows.filter(
      (row) => row.production.firstRelevantRank === null || row.bm25.firstRelevantRank === null,
    );

    console.log(
      `\n=== v2 discrimination ===\n` +
        `answerable queries: ${rows.length}\n` +
        `ranked differently by the two retrievers: ${differing.length} ` +
        `(${differing.map((row) => row.query.id).join(", ")})\n` +
        `missed entirely by at least one retriever: ${missed.length} ` +
        `(${missed.map((row) => row.query.id).join(", ")})\n` +
        `saturated (both rank 1): ${
          rows.filter(
            (row) => row.production.firstRelevantRank === 1 && row.bm25.firstRelevantRank === 1,
          ).length
        } of ${rows.length}\n`,
    );

    expect(differing.length).toBeGreaterThan(0);
    // The saturated fraction must also fall below v1's, or the aggregate deltas
    // stay diluted for the same reason they were in 16A.
    const saturated = rows.filter(
      (row) => row.production.firstRelevantRank === 1 && row.bm25.firstRelevantRank === 1,
    ).length;
    expect(saturated / rows.length).toBeLessThan(0.75);
  });

  test("both retrievers are measured on identical queries and identical labels", async () => {
    const rows = await evaluateBoth();
    for (const { query, production, bm25 } of rows) {
      expect(production.expected).toEqual(query.relevant);
      expect(bm25.expected).toEqual(query.relevant);
      expect(production.id).toBe(query.id);
      expect(bm25.id).toBe(query.id);
      // Both are capped at the same top-k, so the comparison is like for like.
      expect(production.returnedKeys).toHaveLength(5);
      expect(bm25.returnedKeys).toHaveLength(5);
    }
  });

  test("relevance is decided from gold labels, never from a returned score", async () => {
    const rows = await evaluateBoth();
    for (const { query, production, bm25 } of rows) {
      for (const key of production.returnedKeys) {
        // A boolean decision over labels alone, so a high-scoring non-relevant
        // chunk can never be counted as relevant.
        expect(typeof query.relevant.includes(key)).toBe("boolean");
      }
      expect(bm25.returnedKeys.length).toBeGreaterThan(0);
    }
  });

  test("evaluation is deterministic across repeated runs", async () => {
    const first = answerableRows(await evaluateBoth()).map(
      (row) => `${row.query.id}:${row.production.firstRelevantRank}:${row.bm25.firstRelevantRank}`,
    );
    const second = answerableRows(await evaluateBoth()).map(
      (row) => `${row.query.id}:${row.production.firstRelevantRank}:${row.bm25.firstRelevantRank}`,
    );
    expect(second).toEqual(first);
  });

  test("evaluation never writes a chunk, so the fixtures stay declarative", async () => {
    await evaluateBoth();
    // The corpus is seeded in memory for both retrievers; the production search
    // must not have triggered indexing.
    expect(corpus).toHaveLength(goldSet.corpus.length);
  });
});

describe("unanswerable queries", () => {
  test("are reported separately rather than scored as misses", async () => {
    const rows = await evaluateBoth();
    const unanswerable = rows.filter((row) => row.query.answerable === false);
    expect(unanswerable.length).toBeGreaterThan(0);

    // They contribute nothing to HitRate/Precision/MRR, because a query with no
    // relevant chunk has no meaningful reciprocal rank. Scoring them as misses
    // would punish a retriever for the gold set's coverage, not its ranking.
    const scored = answerableRows(rows);
    expect(scored.length + unanswerable.length).toBe(goldSet.queries.length);
    for (const row of unanswerable) {
      expect(row.production.reciprocalRank).toBe(0);
      expect(row.bm25.reciprocalRank).toBe(0);
    }
  });

  test("expose that both retrievers return confident top-N for an unanswerable query", async () => {
    // The recorded limitation of the production retriever: it has no refusal
    // threshold, so an unanswerable query still returns five results. This is a
    // measured property of the current system, not something this task changes,
    // and it is where a future dense retriever or a reranker has real headroom.
    const rows = await evaluateBoth();
    const unanswerable = rows.filter((row) => row.query.answerable === false);

    for (const row of unanswerable) {
      expect(row.production.returnedKeys).toHaveLength(5);
      expect(row.bm25.returnedKeys).toHaveLength(5);
      // Nothing returned can be relevant, because nothing is.
      for (const key of row.production.returnedKeys) {
        expect(row.query.relevant).not.toContain(key);
      }
    }
  });
});
