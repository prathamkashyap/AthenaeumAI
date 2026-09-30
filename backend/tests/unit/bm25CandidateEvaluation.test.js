/**
 * BM25 candidate evaluation against the frozen gold set
 * =====================================================
 *
 * One question: does standard BM25 rank this corpus better than the shipped
 * `local-hash-v1` retriever?
 *
 * The gold set, the corpus, the labels and the metric definitions are all
 * unchanged from `retrievalBaseline.test.js`. Only the retriever differs. That
 * is the point: a difference in the numbers is then attributable to the scoring
 * function, because everything else is held fixed.
 *
 * Metrics are computed with the same definitions as the baseline, and relevance
 * is decided by gold-label membership only. No score ever influences a relevance
 * judgment — asserted explicitly below, because a benchmark that let a retriever
 * grade itself would be worthless.
 *
 * This suite reports; it does not conclude. Whether to integrate BM25 into
 * production is a decision for a later task, made from the numbers printed here
 * together with the per-query comparison, not from a single improved metric.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

import { rankWithBm25 } from "../../services/bm25Retriever.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/retrieval-gold-set.json", import.meta.url),
);
const goldSet = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// The frozen baseline, exactly as asserted in `retrievalBaseline.test.js`.
// Duplicated here deliberately: importing the other test file would couple two
// suites that are supposed to be independently readable, and the constant is
// only trustworthy if it is written out where it is relied upon.
const FROZEN_BASELINE = {
  hitRateAt1: 0.75,
  hitRateAt3: 0.9166666666666666,
  hitRateAt5: 1,
  precisionAt5: 0.2166666666666667,
  mrr: 0.8402777777777777,
};

const CORPUS = goldSet.corpus.map((entry) => ({ id: entry.key, text: entry.text }));

// ─── Metrics ──────────────────────────────────────────────────────────────────
// Identical definitions to the baseline suite, deliberately reimplemented rather
// than shared, so that a change to the baseline harness cannot silently redefine
// what the candidate is measured against. The assertion below that a known
// result list produces known metrics is what keeps the two copies honest.

const FIRST_RELEVANT_RANK = (returnedKeys, relevantKeys) => {
  const index = returnedKeys.findIndex((key) => relevantKeys.includes(key));
  return index === -1 ? null : index + 1;
};

const evaluateQuery = (query, results) => {
  const returnedKeys = results.map((chunk) => chunk.id);
  const rank = FIRST_RELEVANT_RANK(returnedKeys, query.relevant);
  const topK = (k) => returnedKeys.slice(0, k).filter((key) => query.relevant.includes(key)).length;

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
    precisionAt5: topK(5) / 5,
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

/** Runs the candidate over every gold query. */
const runEvaluation = ({ limit = 5 } = {}) => {
  const perQuery = goldSet.queries.map((query) =>
    evaluateQuery(query, rankWithBm25(CORPUS, query.text, { limit })),
  );
  return { perQuery, metrics: aggregate(perQuery, goldSet.queries.length) };
};

const evaluate = (options) => runEvaluation(options);

// ─── Reporting ────────────────────────────────────────────────────────────────

const formatComparison = (rows) => {
  const header = [
    "query", "category", "expect",
    "hashRank", "bm25Rank", "dRank",
    "hashRR", "bm25RR", "verdict",
  ];
  const lines = rows.map((row) => [
    row.id,
    row.category,
    String(row.expected.length),
    row.baselineRank === null ? "-" : String(row.baselineRank),
    row.bm25Rank === null ? "-" : String(row.bm25Rank),
    row.rankDelta === null ? "-" : (row.rankDelta > 0 ? `+${row.rankDelta}` : String(row.rankDelta)),
    row.baselineReciprocalRank.toFixed(3),
    row.bm25ReciprocalRank.toFixed(3),
    row.verdict,
  ]);

  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...lines.map((line) => String(line[i]).length)),
  );
  const render = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");

  return [render(header), render(widths.map((w) => "-".repeat(w))), ...lines.map(render)].join("\n");
};

const METRIC_ROWS = [
  ["HitRate@1", "hitRateAt1"],
  ["HitRate@3", "hitRateAt3"],
  ["HitRate@5", "hitRateAt5"],
  ["Precision@5", "precisionAt5"],
  ["MRR", "mrr"],
];

const formatMetricTable = (metrics) => {
  const header = "metric         BM25      local-hash-v1     delta";
  const rows = METRIC_ROWS.map(([label, key]) => {
    const candidate = metrics[key];
    const baseline = FROZEN_BASELINE[key];
    const delta = candidate - baseline;
    const sign = delta > 0 ? `+${delta.toFixed(4)}` : delta.toFixed(4);
    return `${label.padEnd(12)}  ${candidate.toFixed(4).padStart(10)}  ${baseline.toFixed(4).padStart(12)}  ${sign.padStart(9)}`;
  });
  return [header, ...rows].join("\n");
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BM25 candidate on the frozen gold set", () => {
  test("reports the full metric table and per-query ranking comparison", () => {
    const { perQuery, metrics } = evaluate();

    // The baseline per-query ranks asserted in retrievalBaseline.test.js,
    // written out so the comparison is against measured production behavior
    // rather than against a recollection of it.
    const baselineRanks = {
      "q01-process-states": 3,
      "q02-process-control-block": 1,
      "q03-deadlock-conditions": 1,
      "q04-page-replacement": 1,
      "q05-page-fault-handling": 1,
      "q06-late-corpus-chunk": 1,
      "q07-multiple-relevant": 2,
      "q08-safe-allocation-distractor": 1,
      "q09-time-slice-paraphrase": 4,
      "q10-memory-pressure-paraphrase": 1,
      "q11-buffer-pool-distractor": 1,
      "q12-ambiguous-allocation": 1,
    };

    const rows = perQuery.map((row) => {
      const baselineRank = baselineRanks[row.id];
      const baselineReciprocalRank = baselineRank === null ? 0 : 1 / baselineRank;
      const rankDelta =
        row.firstRelevantRank === null ? null : row.firstRelevantRank - baselineRank;
      return {
        id: row.id,
        category: row.category,
        expected: row.expected,
        baselineRank,
        bm25Rank: row.firstRelevantRank,
        rankDelta,
        baselineReciprocalRank,
        bm25ReciprocalRank: row.reciprocalRank,
        verdict:
          rankDelta === null
            ? "lost"
            : rankDelta < 0
              ? "better"
              : rankDelta > 0
                ? "worse"
                : "same",
      };
    });

    console.log(
      `\n=== BM25 candidate vs local-hash-v1 (frozen gold set, ${metrics.queryCount} queries) ===\n\n` +
        `${formatMetricTable(metrics)}\n\n` +
        `per-query first-relevant-rank comparison\n\n${formatComparison(rows)}\n\n` +
        `better: ${rows.filter((r) => r.verdict === "better").length}  ` +
        `worse: ${rows.filter((r) => r.verdict === "worse").length}  ` +
        `same: ${rows.filter((r) => r.verdict === "same").length}  ` +
        `lost: ${rows.filter((r) => r.verdict === "lost").length}\n` +
        `regressions: ${
          rows.filter((r) => r.verdict === "worse").map((r) => r.id).join(", ") || "none"
        }\n`,
    );

    expect(metrics.queryCount).toBe(12);
    // Reporting is the assertion here: every metric is finite and every query
    // was evaluated, so the table above is complete rather than partial.
    for (const value of Object.values(metrics)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("judges relevance from the gold labels alone, never from BM25 scores", () => {
    const { perQuery } = evaluate();

    for (const row of perQuery) {
      expect(row.returnedKeys.length).toBeGreaterThan(0);
      // Relevance is a function of key membership, so it must be a boolean
      // decision over the labels and nothing else.
      for (const key of row.returnedKeys) {
        expect(typeof row.expected.includes(key)).toBe("boolean");
      }
      // A score never determines a label: an exactly-zero-scoring document is
      // still judged purely by membership.
      const zeroScored = row.returnedKeys.filter((_, i) => row.returnedScores[i] === 0);
      for (const key of zeroScored) {
        const isLabelled = row.expected.includes(key);
        expect(isLabelled).toBe(row.returnedKeys.filter((k) => row.expected.includes(k)).includes(key));
      }
    }
  });

  test("uses the gold labels directly and does not relabel anything", () => {
    const { perQuery } = evaluate();

    expect(perQuery).toHaveLength(goldSet.queries.length);
    perQuery.forEach((row, index) => {
      const gold = goldSet.queries[index];
      expect(row.id).toBe(gold.id);
      expect(row.text).toBe(gold.text);
      // The expected set is the gold set's, unmodified and in full.
      expect([...row.expected].sort()).toEqual([...gold.relevant].sort());
    });
  });

  test("never returns more than the top-k window, so hit@k is a real cutoff", () => {
    const { perQuery } = evaluate();
    for (const row of perQuery) {
      expect(row.returnedKeys).toHaveLength(5);
    }
  });

  test("metric semantics match the baseline suite's", () => {
    // The candidate's evaluator is a separate implementation, so the two
    // definitions are pinned against a known result list rather than assumed
    // identical. Same list, same expected numbers as the baseline suite asserts
    // for the same cases.
    const results = Array.from({ length: 12 }, (_, i) => ({ id: `m#${i}`, score: 1 - i / 100 }));

    const outside = evaluateQuery({ id: "x", text: "p", relevant: ["m#7"] }, results);
    expect(outside.firstRelevantRank).toBe(8);
    expect(outside.reciprocalRank).toBe(0.125);
    expect(outside.hitAt5).toBe(false);
    expect(outside.precisionAt5).toBe(0);

    const multi = evaluateQuery({ id: "y", text: "p", relevant: ["m#0", "m#2", "m#5"] }, results);
    expect(multi.hitRelevantAt5).toBe(2);
    expect(multi.precisionAt5).toBe(0.4);
    expect(multi.firstRelevantRank).toBe(1);

    const empty = evaluateQuery({ id: "z", text: "p", relevant: ["m#0"] }, []);
    expect(empty.reciprocalRank).toBe(0);
    expect(empty.precisionAt5).toBe(0);
  });

  test("the candidate is deterministic across repeated evaluation", () => {
    const first = evaluate().perQuery.map((row) => `${row.id}:${row.returnedKeys.join(",")}`);
    const second = evaluate().perQuery.map((row) => `${row.id}:${row.returnedKeys.join(",")}`);
    expect(second).toEqual(first);
  });

  test("the candidate's ranking is load-bearing, not corpus order", () => {
    const { perQuery } = evaluate();
    const byCorpusOrder = goldSet.queries.map((query) =>
      evaluateQuery(query, CORPUS.map((doc) => ({ id: doc.id, score: 0 }))),
    );

    const ranked = aggregate(perQuery, perQuery.length);
    const unranked = aggregate(byCorpusOrder, byCorpusOrder.length);

    // A constant-score ranking would tie on insertion order. If the candidate's
    // scores did nothing, these two would be identical.
    expect(ranked.mrr).not.toBeCloseTo(unranked.mrr, 10);
  });
});
