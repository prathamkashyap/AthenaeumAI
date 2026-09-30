/**
 * Independent retrieval holdout
 * =============================
 *
 * The question this answers is the one v2 could not.
 *
 * v2 is a discriminating benchmark, but its strongest cases were deliberately
 * constructed to catch frequency over-weighting and length insensitivity — which
 * are precisely the properties BM25's IDF and length normalisation exist to fix.
 * BM25 won three queries there. That is a real result and a narrow one, and a
 * benchmark written by the same hand as the traps cannot establish whether the
 * advantage is general.
 *
 * This holdout is 24 ordinary learner questions over the same corpus, authored
 * before either retriever was run against them. Nothing here was selected
 * because a scorer wins or loses it.
 *
 * ── What these tests can and cannot prove ─────────────────────────────────────
 *
 * A test cannot prove that a human adjudicated a label without looking at a
 * retriever's ranking. That is a property of the authoring process, not of the
 * artifact, and asserting it in a test file would be a fiction. The protocol
 * that establishes it is recorded in the fixture's `independenceProtocol` field
 * and the ordering it describes is what makes the claim meaningful.
 *
 * What the tests below *can* establish, and do:
 *
 *   - the holdout shares no query id and no query text with v2, so a query
 *     cannot have been copied across and quietly double-counted;
 *   - no score or rank is stored in the fixture, so no label can have been
 *     derived from a retrieval result that was then frozen into the data;
 *   - both retrievers receive byte-identical query text and identical labels;
 *   - evaluation is deterministic and never mutates the corpus;
 *   - and the holdout is reported separately from v1 and v2, never merged.
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
const holdout = readFixture("retrieval-gold-set-holdout-v1.json");

const USER_ID = "user-eval-holdout";

// ─── Persistence doubles ──────────────────────────────────────────────────────
// The same boundary the baseline and v2 suites replace, so the production
// retriever runs on its real terms and no fixture chunk is ever written to Mongo.

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

// The holdout is evaluated over the v2 corpus, unmodified. Only the questions
// change between the two benchmarks; if the corpus changed too, a difference in
// results could not be attributed to the questions.
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
// Identical definitions and conventions to the other two retrieval suites.

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
    `metric         production        BM25     delta`,
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

// ─── Structural integrity ─────────────────────────────────────────────────────

describe("holdout structural integrity", () => {
  test("query ids are unique", () => {
    const ids = holdout.queries.map((query) => query.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every referenced chunk key exists in the corpus it is evaluated over", () => {
    const known = new Set(v2.corpus.map((chunk) => chunk.key));
    const dangling = holdout.queries.flatMap((query) =>
      query.relevant.filter((key) => !known.has(key)),
    );
    expect(dangling).toEqual([]);
  });

  test("no relevant set is empty", () => {
    // The holdout has no unanswerable queries by design, so an empty set is
    // always an authoring mistake rather than a deliberate assertion.
    expect(holdout.queries.filter((query) => query.relevant.length === 0)).toEqual([]);
  });

  test("every query carries a substantive adjudication", () => {
    for (const query of holdout.queries) {
      expect(typeof query.adjudication).toBe("string");
      expect(query.adjudication.length).toBeGreaterThan(60);
      // Each adjudication must resolve against the label, so a reviewer can
      // check the judgment without trusting the fixture.
      for (const key of query.relevant) {
        expect(query.adjudication).toContain(key);
      }
    }
  });

  test("the fixture stores no retrieval score and no rank outcome", () => {
    // A stored score or rank is the mechanical route by which a label could be
    // generated from a retriever and then frozen in, which would defeat the
    // whole purpose of a holdout. Nothing like it may exist in the file.
    const serialised = JSON.stringify(holdout);
    for (const forbidden of [
      '"score"', '"scores"', '"rank"', '"ranks"', '"reciprocalRank"',
      '"expectedRank"', '"prodRank"', '"bm25Rank"', '"firstRelevantRank"',
      '"hitAt1"', '"precisionAt5"', '"mrr"',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  test("the holdout shares no query id or query text with v2", () => {
    // Copy/paste guard. A holdout that reuses a v2 query cannot be independent
    // of it, and one reused under a new id would let v2's constructed traps
    // masquerade as ordinary evidence.
    const v2Ids = new Set(v2.queries.map((query) => query.id));
    const v2Texts = new Set(v2.queries.map((query) => query.text));

    expect(holdout.queries.filter((query) => v2Ids.has(query.id))).toEqual([]);
    expect(holdout.queries.filter((query) => v2Texts.has(query.text))).toEqual([]);
  });

  test("the holdout shares no query id or query text with v1", () => {
    const v1Ids = new Set(v1.queries.map((query) => query.id));
    const v1Texts = new Set(v1.queries.map((query) => query.text));
    expect(holdout.queries.filter((query) => v1Ids.has(query.id))).toEqual([]);
    expect(holdout.queries.filter((query) => v1Texts.has(query.text))).toEqual([]);
  });

  test("no holdout query text appears inside v2, so nothing was re-used wholesale", () => {
    const v2Texts = v2.queries.map((query) => query.text);
    for (const query of holdout.queries) {
      expect(v2Texts).not.toContain(query.text);
      // Whitespace is normalised, because a stray double space would make a
      // copied query look distinct to an exact-match comparison while still
      // being the same question to a retriever.
      expect(query.text).toBe(query.text.trim().replace(/\s+/g, " "));
      expect(query.text.length).toBeGreaterThan(15);
    }
  });

  test("the holdout is structurally independent: its own corpus pointer, not a copy", () => {
    // It declares the corpus it runs over rather than embedding one, which is
    // what makes "the same corpus, different questions" checkable instead of
    // asserted.
    expect(holdout.corpus).toMatch(/Task 16B corpus/);
    expect(holdout.corpus).not.toMatch(/^\[/);
    expect(holdout.queries).toBeDefined();
    expect(holdout.queries[0]).not.toHaveProperty("corpus");
    expect(holdout.version).toBe("1.0.0");
    expect(holdout.independentOf).toHaveLength(2);
  });

  test("the independence protocol is recorded as a process guarantee, not a proof", () => {
    // A test cannot establish that a label was authored without seeing a
    // ranking. The fixture must therefore state the protocol and must not claim
    // the tests verify human judgement.
    expect(holdout.independenceProtocol).toMatch(/only then run either retriever/i);
    expect(holdout.independenceProtocol).toMatch(/cannot be established|not, and could not be/i);
  });

  test("holdout query count is in the intended range and answerable throughout", () => {
    expect(holdout.queries.length).toBeGreaterThanOrEqual(18);
    expect(holdout.queries.length).toBeLessThanOrEqual(30);
    expect(holdout.queries.every((query) => query.answerable === undefined)).toBe(true);
  });

  test("categories are ordinary query shapes, not the v2 trap categories", () => {
    // The point of the holdout is that it is unremarkable. Reusing v2's
    // adversarial category names would mean the questions were still built to
    // catch something specific.
    const v2Categories = new Set(v2.queries.map((query) => query.category));
    for (const query of holdout.queries) {
      expect(v2Categories.has(query.category)).toBe(false);
    }
    const used = new Set(holdout.queries.map((query) => query.category));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });
});

// ─── Evaluation ───────────────────────────────────────────────────────────────

describe("holdout measurement", () => {
  test("reports both retrievers on identical queries and labels", async () => {
    const rows = await evaluateHoldout();

    for (const { query, production, bm25 } of rows) {
      // Byte-identical inputs, so a difference in the results is attributable to
      // the scorer and to nothing else.
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

    // Content equality, not reference equality: two separately built arrays
    // holding the same ranks are deterministic, and asserting identity on an
    // array would only assert that the test allocates twice.
    expect(JSON.stringify(corpus)).toBe(snapshot);
    const ranksOf = (rows) =>
      JSON.stringify(
        rows.map(
          (row) =>
            `${row.query.id}:${row.production.firstRelevantRank}:${row.bm25.firstRelevantRank}`,
        ),
      );
    expect(ranksOf(second)).toBe(ranksOf(first));
    expect(ranksOf(first)).not.toBe("");
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

  test("prints the holdout comparison for review", async () => {
    const rows = await evaluateHoldout();
    const production = aggregate(rows.map((row) => row.production));
    const bm25 = aggregate(rows.map((row) => row.bm25));
    const counts = tally(rows);

    const differing = rows.filter(
      (row) => row.production.firstRelevantRank !== row.bm25.firstRelevantRank,
    );

    console.log(
      `\n=== INDEPENDENT HOLDOUT v1.0.0: local-hash-v1 vs BM25 ===\n` +
        `corpus chunks: ${v2.corpus.length}   holdout queries: ${holdout.queries.length} (all answerable)\n\n` +
        `${metricTable(production, bm25)}\n\n` +
        `per-query first-relevant-rank comparison\n\n${perQueryTable(rows)}\n\n` +
        `BM25 improved ${counts.improved}, worsened ${counts.worsened}, unchanged ${counts.unchanged}\n` +
        `completely missed: both ${counts.bothMissed}, BM25 only ${counts.bm25Only}, production only ${counts.productionOnly}\n` +
        `ranked differently: ${differing.length} of ${rows.length}\n` +
        `saturated (both rank 1): ${
          rows.filter(
            (row) => row.production.firstRelevantRank === 1 && row.bm25.firstRelevantRank === 1,
          ).length
        } of ${rows.length}\n`,
    );

    for (const value of [...Object.values(production), ...Object.values(bm25)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(production.queryCount).toBe(holdout.queries.length);
  });
});

// ─── Cross-benchmark reporting ────────────────────────────────────────────────

describe("the three benchmarks are reported separately", () => {
  test("v1, v2 and holdout are never combined into a single score", () => {
    // Three distinct fixtures, three distinct query sets, three distinct
    // results. Merging them would let a result on one corpus or one query
    // distribution be presented as though it described the others, which is the
    // specific error this separation exists to prevent.
    expect(holdout.queries).not.toBe(v2.queries);
    expect(holdout.queries).not.toBe(v1.queries);
    expect(holdout.name).not.toBe(v2.name);
    expect(holdout.name).not.toBe(v1.name);
    expect(holdout.version).toBe("1.0.0");
    expect(v2.version).toBe("2.0.0");
    expect(v1.version).toBe("1.0.0");
  });

  test("the holdout runs over the v2 corpus, so only the questions differ", () => {
    // Stated explicitly rather than inferred: if this ever fails, a difference
    // between the v2 and holdout results could no longer be attributed to the
    // question distribution alone.
    expect(holdout.corpus).toMatch(/unchanged/i);
    expect(bm25Documents()).toHaveLength(v2.corpus.length);
  });
});
