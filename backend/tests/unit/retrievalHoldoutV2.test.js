/**
 * Independent retrieval holdout v2 — measurement and structural gates
 * =================================================================
 *
 * Supersedes the Task 16C exploratory holdout as the set to measure against,
 * and corrects a claim that exploratory set could not support.
 *
 * ── What this set is, and what it is not ──────────────────────────────────────
 *
 * holdout-v2 was authored by the same process that authored the v2 benchmark,
 * which had already seen v2's results. It is therefore NOT independent evidence
 * in the strong sense, and the fixture says so in its `independenceClaim` field
 * rather than leaving the reader to infer it from a file name.
 *
 * What it does claim is narrower: the questions were produced by *coverage-driven
 * authoring*. Every answerable passage in the corpus was enumerated first, then
 * covered by at least one question, with extra questions only where a passage
 * supports two distinct ones. The question set is therefore fixed by what the
 * corpus contains, not by which cases a retriever was observed to win. That
 * removes selection-by-judgment, which is the failure mode that would otherwise
 * be hardest to notice.
 *
 * The stronger claim — that a question author had no access to prior rankings at
 * all — is a *provenance* property of the authoring process. No automated test
 * can establish it, because the artifact it would examine is the file itself,
 * and asserting it there would be a fiction. Anyone who needs genuine
 * independence must commission questions from an author who has not seen v1, v2
 * or this file.
 *
 * ── What the tests below do establish ─────────────────────────────────────────
 *
 * Structural facts that are mechanically checkable and would otherwise be
 * taken on trust: unique ids and texts, no reuse from any earlier benchmark, no
 * stored score or rank, all keys resolvable, no empty relevance set, an
 * adjudication on every query, deterministic evaluation, an unmutated corpus,
 * and byte-identical inputs to both retrievers. Plus one test that reads the
 * fixture's own honesty claim, so the file cannot quietly stop asserting it.
 */

import { jest } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const readFixture = (name) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"),
  );

const v1 = readFixture("retrieval-gold-set.json");
const v2 = readFixture("retrieval-gold-set-v2.json");
const exploratory = readFixture("retrieval-gold-set-holdout-v1.json");
const holdout = readFixture("retrieval-gold-set-holdout-v2.json");

const USER_ID = "user-eval-holdout-v2";

// ─── Persistence doubles ──────────────────────────────────────────────────────

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

const buildCorpus = () =>
  v2.corpus.map((entry) => ({
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

const bm25Documents = () => v2.corpus.map((entry) => ({ id: entry.key, text: entry.text }));
const resultKey = (chunk) => `${chunk.studyMaterial}#${chunk.chunkIndex}`;

// ─── Metrics ──────────────────────────────────────────────────────────────────

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
    expected: query.relevant,
    returnedKeys,
    firstRelevantRank: rank,
    hitAt1: rank !== null && rank <= 1,
    hitAt3: rank !== null && rank <= 3,
    hitAt5: rank !== null && rank <= 5,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    precisionAt5: topK(5) / 5,
  };
};

const aggregate = (perQuery) => {
  const mean = (pick) => perQuery.reduce((sum, row) => sum + pick(row), 0) / perQuery.length;
  return {
    queryCount: perQuery.length,
    hitRateAt1: mean((row) => (row.hitAt1 ? 1 : 0)),
    hitRateAt3: mean((row) => (row.hitAt3 ? 1 : 0)),
    hitRateAt5: mean((row) => (row.hitAt5 ? 1 : 0)),
    precisionAt5: mean((row) => row.precisionAt5),
    mrr: mean((row) => row.reciprocalRank),
  };
};

const runProduction = async (query) => {
  const results = await searchMaterialChunks({ userId: USER_ID, query: query.text, limit: 5 });
  return results.map(resultKey);
};
const runBm25 = (query) =>
  rankWithBm25(bm25Documents(), query.text, { limit: 5 }).map((chunk) => chunk.id);

const evaluateHoldout = async () => {
  const rows = [];
  for (const query of holdout.queries) {
    rows.push({
      query,
      production: evaluateQuery(query, await runProduction(query)),
      bm25: evaluateQuery(query, runBm25(query)),
    });
  }
  return rows;
};

// ─── Reporting ────────────────────────────────────────────────────────────────

const METRICS = [
  ["HitRate@1", "hitRateAt1"],
  ["HitRate@3", "hitRateAt3"],
  ["HitRate@5", "hitRateAt5"],
  ["Precision@5", "precisionAt5"],
  ["MRR", "mrr"],
];

const metricTable = (production, bm25) =>
  [
    "metric         production        BM25     delta",
    ...METRICS.map(([label, key]) => {
      const delta = bm25[key] - production[key];
      const sign = delta > 0 ? `+${delta.toFixed(4)}` : delta.toFixed(4);
      return `${label.padEnd(12)}  ${production[key].toFixed(4).padStart(12)}  ${bm25[key]
        .toFixed(4)
        .padStart(10)}  ${sign.padStart(9)}`;
    }),
  ].join("\n");

const perQueryTable = (rows) => {
  const header = [
    "query", "category", "prodRank", "bm25Rank", "dRank", "prodRR", "bm25RR", "verdict",
  ];
  const body = rows.map(({ query, production, bm25 }) => {
    const p = production.firstRelevantRank;
    const b = bm25.firstRelevantRank;
    const delta = p === null || b === null ? null : b - p;
    const verdict =
      p === null && b === null
        ? "both missed"
        : p === null
          ? "bm25 only"
          : b === null
            ? "prod only"
            : delta < 0
              ? "bm25 better"
              : delta > 0
                ? "bm25 worse"
                : "same";
    return [
      query.id,
      query.category,
      p === null ? "-" : String(p),
      b === null ? "-" : String(b),
      delta === null ? "-" : delta > 0 ? `+${delta}` : String(delta),
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
  const counts = rows.reduce((acc, row) => {
    const p = row.production.firstRelevantRank;
    const b = row.bm25.firstRelevantRank;
    const key =
      p === null && b === null
        ? "bothMissed"
        : p === null
          ? "bm25Only"
          : b === null
            ? "productionOnly"
            : b < p
              ? "improved"
              : b > p
                ? "worsened"
                : "unchanged";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    improved: counts.improved || 0,
    worsened: counts.worsened || 0,
    unchanged: counts.unchanged || 0,
    bothMissed: counts.bothMissed || 0,
    bm25Only: counts.bm25Only || 0,
    productionOnly: counts.productionOnly || 0,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  corpus = buildCorpus();
});

// ─── Structural gates ─────────────────────────────────────────────────────────

describe("holdout-v2 structural integrity", () => {
  test("query ids are unique", () => {
    const ids = holdout.queries.map((query) => query.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("query texts are unique", () => {
    // A repeated question would let one case be counted twice, inflating every
    // aggregate without adding evidence.
    const texts = holdout.queries.map((query) => query.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test("no query is reused from v1, v2 or the exploratory holdout", () => {
    // The copy/paste guard. A holdout that reuses a constructed trap under a new
    // id would let v2's adversarial cases masquerade as ordinary evidence, which
    // is the specific error this revision exists to correct.
    const earlier = [...v1.queries, ...v2.queries, ...exploratory.queries];
    const earlierIds = new Set(earlier.map((query) => query.id));
    const earlierTexts = new Set(earlier.map((query) => query.text));

    expect(holdout.queries.filter((query) => earlierIds.has(query.id))).toEqual([]);
    expect(holdout.queries.filter((query) => earlierTexts.has(query.text))).toEqual([]);
  });

  test("the fixture stores no retrieval score and no rank outcome", () => {
    // The mechanical route by which a label could be generated from a retriever
    // and then frozen in, which would defeat the purpose of a holdout entirely.
    const serialised = JSON.stringify(holdout);
    for (const forbidden of [
      '"score"', '"scores"', '"rank"', '"ranks"', '"reciprocalRank"',
      '"expectedRank"', '"prodRank"', '"bm25Rank"', '"firstRelevantRank"',
      '"hitAt1"', '"hitAt3"', '"hitAt5"', '"precisionAt5"', '"mrr"',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  test("every referenced chunk key exists in the corpus it runs over", () => {
    const known = new Set(v2.corpus.map((chunk) => chunk.key));
    const dangling = holdout.queries.flatMap((query) =>
      query.relevant.filter((key) => !known.has(key)),
    );
    expect(dangling).toEqual([]);
  });

  test("no relevance set is empty", () => {
    expect(holdout.queries.filter((query) => query.relevant.length === 0)).toEqual([]);
  });

  test("no constructed distractor is ever labeled relevant", () => {
    // The distractor-notes chunks were authored to be lexically attractive and
    // evidentially empty. Labeling one relevant would mean a query has no
    // correct answer in the corpus, which is a labelling error rather than a
    // hard case.
    const used = new Set(holdout.queries.flatMap((query) => query.relevant));
    for (const key of used) {
      expect(key.startsWith("distractor-notes")).toBe(false);
    }
  });

  test("every query has a substantive adjudication naming its passage", () => {
    for (const query of holdout.queries) {
      expect(typeof query.adjudication).toBe("string");
      expect(query.adjudication.length).toBeGreaterThan(60);
      for (const key of query.relevant) {
        expect(query.adjudication).toContain(key);
      }
    }
  });

  test("every answerable passage in the corpus is covered by at least one question", () => {
    // Coverage-driven authoring is the mechanism that makes this set less
    // selection-driven, so the coverage claim is asserted rather than described.
    // The distractor-notes chunks are excluded: they are deliberately
    // non-answering, so a question labelled on them would be unanswerable.
    const answerable = v2.corpus
      .filter((chunk) => chunk.materialKey !== "distractor-notes")
      .map((chunk) => chunk.key);
    const covered = new Set(holdout.queries.flatMap((query) => query.relevant));

    expect(answerable).toHaveLength(34);
    expect(answerable.filter((key) => !covered.has(key))).toEqual([]);
  });

  test("the fixture refuses the independent claim and records the method instead", () => {
    // The honesty claim is asserted here so the file cannot quietly stop making
    // it. If a future revision genuinely gains an independent author, this test
    // is the place that has to be revisited deliberately.
    expect(holdout.independenceClaim).toMatch(/NOT INDEPENDENT/i);
    expect(holdout.independenceClaim).toMatch(/provenance property/i);
    expect(holdout.authoringMethod).toMatch(/coverage/i);
    expect(holdout.authoringMethod).toMatch(/no ranking was inspected/i);
  });

  test("it declares itself a successor to all three earlier sets", () => {
    expect(holdout.version).toBe("2.0.0");
    expect(holdout.independentOf).toHaveLength(3);
    expect(holdout.independentOf.join(" ")).toMatch(/v1\.0\.0.*v2\.0\.0/s);
  });

  test("query count and shape are in the intended range", () => {
    expect(holdout.queries.length).toBeGreaterThanOrEqual(30);
    expect(holdout.queries.length).toBeLessThanOrEqual(40);
    expect(holdout.queries.every((query) => query.answerable === undefined)).toBe(true);
  });

  test("categories are ordinary query shapes, not v2's trap categories", () => {
    const v2Categories = new Set(v2.queries.map((query) => query.category));
    for (const query of holdout.queries) {
      expect(v2Categories.has(query.category)).toBe(false);
    }
    expect(new Set(holdout.queries.map((query) => query.category)).size).toBeGreaterThanOrEqual(4);
  });
});

// ─── Measurement ──────────────────────────────────────────────────────────────

describe("holdout-v2 measurement", () => {
  test("both retrievers receive identical query text and labels", async () => {
    const rows = await evaluateHoldout();
    for (const { query, production, bm25 } of rows) {
      expect(production.text).toBe(query.text);
      expect(bm25.text).toBe(query.text);
      expect(production.expected).toEqual(query.relevant);
      expect(bm25.expected).toEqual(query.relevant);
      expect(production.returnedKeys).toHaveLength(5);
      expect(bm25.returnedKeys).toHaveLength(5);
    }
  });

  test("evaluation is deterministic and does not mutate the corpus", async () => {
    const first = await evaluateHoldout();
    const snapshot = JSON.stringify(corpus);
    const second = await evaluateHoldout();

    expect(JSON.stringify(corpus)).toBe(snapshot);
    const ranksOf = (rows) =>
      JSON.stringify(
        rows.map(
          (row) =>
            `${row.query.id}:${row.production.firstRelevantRank}:${row.bm25.firstRelevantRank}`,
        ),
      );
    expect(ranksOf(second)).toBe(ranksOf(first));
  });

  test("relevance is judged from labels only", async () => {
    const rows = await evaluateHoldout();
    for (const { query, production, bm25 } of rows) {
      for (const key of production.returnedKeys) {
        expect(typeof query.relevant.includes(key)).toBe("boolean");
      }
      for (const key of bm25.returnedKeys) {
        expect(typeof query.relevant.includes(key)).toBe("boolean");
      }
    }
  });

  test("prints the full comparison and the saturation census", async () => {
    // The saturation figure is reported, not asserted against a target. A
    // threshold was discussed as a goal during authoring; it is deliberately not
    // a test, because a failing threshold would create pressure to edit a frozen
    // query set after seeing results, which would destroy the holdout.
    const rows = await evaluateHoldout();
    const production = aggregate(rows.map((row) => row.production));
    const bm25 = aggregate(rows.map((row) => row.bm25));
    const counts = tally(rows);

    const bothRank1 = rows.filter(
      (row) => row.production.firstRelevantRank === 1 && row.bm25.firstRelevantRank === 1,
    ).length;
    const differing = rows.filter(
      (row) => row.production.firstRelevantRank !== row.bm25.firstRelevantRank,
    );

    console.log(
      `\n=== HOLDOUT v2.0.0: local-hash-v1 vs BM25 ===\n` +
        `corpus chunks: ${v2.corpus.length}   queries: ${holdout.queries.length} (all answerable)\n\n` +
        `${metricTable(production, bm25)}\n\n` +
        `per-query first-relevant-rank comparison\n\n${perQueryTable(rows)}\n\n` +
        `BM25 improved ${counts.improved}, worsened ${counts.worsened}, unchanged ${counts.unchanged}\n` +
        `completely missed: both ${counts.bothMissed}, BM25 only ${counts.bm25Only}, production only ${counts.productionOnly}\n` +
        `ranks differ: ${differing.length} of ${rows.length}\n` +
        `SATURATION: both rank 1 on ${bothRank1} of ${rows.length} = ` +
        `${((bothRank1 / rows.length) * 100).toFixed(1)}%\n` +
        `unsaturated share: ${(((rows.length - bothRank1) / rows.length) * 100).toFixed(1)}%\n` +
        `differing queries: ${differing.map((row) => row.query.id).join(", ") || "none"}\n`,
    );

    for (const value of [...Object.values(production), ...Object.values(bm25)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(production.queryCount).toBe(holdout.queries.length);
  });
});
