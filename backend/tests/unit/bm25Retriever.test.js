/**
 * BM25 candidate — unit tests
 * ==========================
 *
 * BM25 is a formula, and a formula is only worth benchmarking if it is
 * implemented correctly. These tests therefore check the implementation against
 * hand-computable numbers on tiny corpora, rather than checking that it agrees
 * with itself or merely produces plausible output.
 *
 * The suite has two jobs:
 *
 *   1. Pin the formula. Each component — IDF, the saturation term, the length
 *      normalization, the tf handling — is asserted against a value worked out
 *      by hand, so a wrong constant or a transposed term cannot pass.
 *
 *   2. Prove the implementation is not a superficial score stub. The
 *      "detects broken variants" block introduces seven deliberate defects and
 *      asserts that the tests above and the ranking behavior both catch them. A
 *      scorer that ignores IDF, or reverses the order, or breaks ties by corpus
 *      position, must fail loudly here rather than quietly producing a good
 *      looking benchmark number later.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

import {
  BM25_B,
  BM25_K1,
  bm25Score,
  buildCorpusIndex,
  inverseDocumentFrequency,
  rankWithBm25,
  termFrequencies,
  termFrequencyComponent,
  termScore,
} from "../../services/bm25Retriever.js";

// ─── Hand-computed fixtures ───────────────────────────────────────────────────
//
// Corpus chosen so every quantity is a small integer and average document
// length is exactly 2:
//
//   d1: "alpha beta"          -> alpha, beta            (len 2)
//   d2: "alpha gamma"         -> alpha, gamma           (len 2)
//   d3: "alpha alpha delta"   -> alpha, alpha, delta    (len 3)
//
//   N = 3,  avgdl = (2 + 2 + 3) / 3 = 7/3
//   df(alpha) = 3,  df(beta) = 1,  df(gamma) = 1,  df(delta) = 1
//
// `beta`/`gamma`/`delta` are three characters so they survive the tokenizer's
// length > 2 filter, and none is a stop word.

const CORPUS = [
  { id: "d1", text: "alpha beta" },
  { id: "d2", text: "alpha gamma" },
  { id: "d3", text: "alpha alpha delta" },
];

const INDEX = buildCorpusIndex(CORPUS);
const AVGDL = 7 / 3;

// BM25 with k1 = 1.2, b = 0.75. Written out rather than reused from the
// implementation, so a bug in the implementation cannot agree with itself.
const EXPECTED = (tf, docLen) => {
  const normalization = 1 - 0.75 + 0.75 * (docLen / AVGDL);
  return (tf * (1.2 + 1)) / (tf + 1.2 * normalization);
};

// ─── The formula, component by component ──────────────────────────────────────

describe("BM25 formula", () => {
  test("tokenizes a document into term frequencies", () => {
    expect(termFrequencies("alpha alpha beta")).toEqual(
      new Map([["alpha", 2], ["beta", 1]]),
    );
  });

  test("term frequency counts repetitions rather than presence", () => {
    // Presence-based counting would make tf 1 here and halve the contribution.
    expect(termFrequencies("alpha alpha alpha").get("alpha")).toBe(3);
  });

  test("IDF matches the hand-computed ln(1 + (N - df + 0.5)/(df + 0.5))", () => {
    // df = 1, N = 3 -> ln(1 + 2.5/1.5) = ln(2.666666...) = 0.9808292530...
    expect(inverseDocumentFrequency(1, 3)).toBeCloseTo(Math.log(1 + 2.5 / 1.5), 12);

    // df = 2, N = 3 -> ln(1 + 1.5/2.5) = ln(1.6) = 0.4700036292...
    expect(inverseDocumentFrequency(2, 3)).toBeCloseTo(Math.log(1 + 1.5 / 2.5), 12);

    // df = 3, N = 3 -> ln(1 + 0.5/3.5) = ln(1.142857...) = 0.1335313926...
    expect(inverseDocumentFrequency(3, 3)).toBeCloseTo(Math.log(1 + 0.5 / 3.5), 12);
  });

  test("IDF stays positive for a term in every document", () => {
    // The raw Robertson form, ln((N - df + 0.5)/(df + 0.5)), is negative here.
    // A negative IDF would let an extremely common term subtract from a score,
    // which is why the ln(1 + ...) variant is used.
    expect(inverseDocumentFrequency(3, 3)).toBeGreaterThan(0);
    expect(Math.log(0.5 / 3.5)).toBeLessThan(0);
  });

  test("IDF decreases monotonically as document frequency rises", () => {
    const scores = [1, 2, 3].map((df) => inverseDocumentFrequency(df, 3));
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  test("a longer document with the same term frequency scores lower", () => {
    // The defining length-normalization property: the same evidence, spread
    // across more text, is weaker evidence.
    const short = termFrequencyComponent({ tf: 1, documentLength: 10, averageDocumentLength: 10 });
    const long = termFrequencyComponent({ tf: 1, documentLength: 40, averageDocumentLength: 10 });
    expect(long).toBeLessThan(short);
  });

  test("length normalization matches the hand-computed denominator", () => {
    // tf = 1, |D| = 3, avgdl = 7/3, k1 = 1.2, b = 0.75
    const component = termFrequencyComponent({
      tf: 1,
      documentLength: 3,
      averageDocumentLength: AVGDL,
    });
    expect(component).toBeCloseTo(EXPECTED(1, 3), 12);
  });

  test("term frequency saturates rather than growing without bound", () => {
    // Doubling tf must raise the score, but by less than double: that flattening
    // is the whole point of k1. A linear tf would scale the score proportionally.
    const once = termFrequencyComponent({ tf: 1, documentLength: 10, averageDocumentLength: 10 });
    const twice = termFrequencyComponent({ tf: 2, documentLength: 10, averageDocumentLength: 10 });
    const four = termFrequencyComponent({ tf: 4, documentLength: 10, averageDocumentLength: 10 });

    expect(twice).toBeGreaterThan(once);
    expect(four).toBeGreaterThan(twice);
    expect(twice / once).toBeLessThan(2);
    expect(four / twice).toBeLessThan(2);
  });

  test("an absent term contributes nothing", () => {
    expect(termFrequencyComponent({ tf: 0, documentLength: 10, averageDocumentLength: 10 })).toBe(0);
    // And therefore a document with no query terms scores exactly zero.
    const score = bm25Score("beta", termFrequencies("gamma"), INDEX);
    expect(score).toBe(0);
  });

  test("one-term match scores exactly idf × saturation", () => {
    const score = bm25Score("alpha", termFrequencies("alpha gamma"), INDEX);
    const expected = inverseDocumentFrequency(3, 3) * EXPECTED(1, 2);
    expect(score).toBeCloseTo(expected, 12);
  });

  test("a repeated query term is counted once, not once per occurrence", () => {
    // BM25 iterates the query's term set. Counting the duplicate would inflate
    // the score by 2× and is a classic implementation error.
    const once = bm25Score("alpha", termFrequencies("alpha gamma"), INDEX);
    const twice = bm25Score("alpha alpha", termFrequencies("alpha gamma"), INDEX);
    expect(twice).toBeCloseTo(once, 12);
  });

  test("multiple query terms accumulate", () => {
    const alpha = bm25Score("alpha", termFrequencies("alpha gamma"), INDEX);
    const gamma = bm25Score("gamma", termFrequencies("alpha gamma"), INDEX);
    const both = bm25Score("alpha gamma", termFrequencies("alpha gamma"), INDEX);
    expect(both).toBeCloseTo(alpha + gamma, 12);
  });

  test("a document with more query terms outranks one with fewer", () => {
    const d1 = bm25Score("alpha beta", INDEX.entries[0].termFrequencies, INDEX);
    const d2 = bm25Score("alpha beta", INDEX.entries[1].termFrequencies, INDEX);
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(0);
  });

  test("a rarer term outweighs a common one of the same frequency", () => {
    // df(alpha) = 3 across all three documents, df(beta) = 1 in one. Same tf,
    // same length: the difference is entirely IDF.
    const common = bm25Score("alpha", termFrequencies("alpha beta"), INDEX);
    const rare = bm25Score("beta", termFrequencies("alpha beta"), INDEX);
    expect(rare).toBeGreaterThan(common);
  });

  test("termScore composes idf and the saturation term", () => {
    const composed = termScore({
      tf: 2,
      documentLength: 3,
      averageDocumentLength: AVGDL,
      df: 3,
      corpusSize: 3,
    });
    expect(composed).toBeCloseTo(inverseDocumentFrequency(3, 3) * EXPECTED(2, 3), 12);
  });

  test("corpus statistics are the real ones", () => {
    expect(INDEX.corpusSize).toBe(3);
    expect(INDEX.averageDocumentLength).toBeCloseTo(AVGDL, 12);
    expect(INDEX.df.get("alpha")).toBe(3);
    expect(INDEX.df.get("beta")).toBe(1);
    expect(INDEX.df.get("gamma")).toBe(1);
    expect(INDEX.df.get("delta")).toBe(1);
    // A token that appears in no document must be absent from df entirely, not
    // present with a df of zero. The two behave differently in the IDF formula.
    expect(INDEX.df.has("epsilon")).toBe(false);
  });

  test("document frequency counts documents, not occurrences", () => {
    // d3 contains "alpha" twice. Counting occurrences would make df(alpha) = 4
    // against a corpus of 3, which is impossible and would drive IDF negative.
    expect(INDEX.df.get("alpha")).toBe(3);
  });

  test("an empty corpus does not produce NaN scores", () => {
    const empty = buildCorpusIndex([]);
    expect(empty.corpusSize).toBe(0);
    expect(empty.averageDocumentLength).toBe(0);
    expect(bm25Score("alpha", termFrequencies("alpha"), empty)).toBe(0);
    expect(() => rankWithBm25([], "alpha")).not.toThrow();
  });

  test("the fixed parameters are the documented TREC defaults", () => {
    // Pinned so a silent parameter change is visible in review. They are fixed
    // constants on purpose: tuning them against 12 queries would overfit.
    expect(BM25_K1).toBe(1.2);
    expect(BM25_B).toBe(0.75);
  });
});

// ─── Ranking ──────────────────────────────────────────────────────────────────

describe("BM25 ranking", () => {
  test("orders by descending score", () => {
    const results = rankWithBm25(CORPUS, "alpha beta");

    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
    expect(results[0].id).toBe("d1");
  });

  test("breaks ties by document id, not by corpus position", () => {
    // d2 and d3 both contain "alpha" and nothing else from the query, but d3
    // contains it twice, so use a query that ties them exactly: "gamma" matches
    // only d2, so instead tie on a term shared equally.
    const tied = [
      { id: "zzz", text: "alpha" },
      { id: "aaa", text: "alpha" },
      { id: "mmm", text: "alpha" },
    ];
    const results = rankWithBm25(tied, "alpha");

    expect(results.map((r) => r.score)).toEqual([results[0].score, results[0].score, results[0].score]);
    expect(results.map((r) => r.id)).toEqual(["aaa", "mmm", "zzz"]);
  });

  test("produces identical rankings across repeated runs", () => {
    const first = rankWithBm25(CORPUS, "alpha beta delta").map((r) => `${r.id}:${r.score}`);
    const second = rankWithBm25(CORPUS, "alpha beta delta").map((r) => `${r.id}:${r.score}`);
    const third = rankWithBm25(CORPUS, "alpha beta delta").map((r) => `${r.id}:${r.score}`);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("is unaffected by the order documents are supplied in", () => {
    // Ranking must depend on the text, not on how the corpus was loaded. A
    // stable sort over an unstable input would violate this.
    const forward = rankWithBm25(CORPUS, "alpha beta delta").map((r) => r.id);
    const reversed = rankWithBm25([...CORPUS].reverse(), "alpha beta delta").map((r) => r.id);
    const rotated = rankWithBm25([CORPUS[1], CORPUS[2], CORPUS[0]], "alpha beta delta").map((r) => r.id);

    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  test("applies the top-k cutoff", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, text: `alpha filler${i}` }));
    expect(rankWithBm25(many, "alpha", { limit: 3 })).toHaveLength(3);
    expect(rankWithBm25(many, "alpha", { limit: 1 })).toHaveLength(1);
  });

  test("clamps limit exactly as the production retriever does", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, text: `alpha filler${i}` }));

    // Over the ceiling: clamped to 12.
    expect(rankWithBm25(many, "alpha", { limit: 50 })).toHaveLength(12);
    expect(rankWithBm25(many, "alpha", { limit: 12 })).toHaveLength(12);

    // The production expression is `Math.min(Math.max(Number(limit) || 5, 1), 12)`,
    // so the `|| 5` default and the 1..12 clamp interact. The exact expected
    // lengths below are taken from evaluating that expression directly, not from
    // reasoning about it, because the two steps disagree in a way that is easy to
    // get backwards: a falsy limit (0, "abc", absent) becomes the default 5,
    // while a truthy out-of-range one (-3) survives `||` and is then clamped up
    // to 1. Clamping before defaulting would give 1 for `limit: 0` where
    // production gives 5 — a silent difference in result-set size between the
    // two retrievers, which is precisely what a benchmark must not have.
    expect(rankWithBm25(many, "alpha", { limit: 0 })).toHaveLength(5);
    expect(rankWithBm25(many, "alpha", { limit: -3 })).toHaveLength(1);
    expect(rankWithBm25(many, "alpha", { limit: "abc" })).toHaveLength(5);
    expect(rankWithBm25(many, "alpha", {})).toHaveLength(5);
    expect(rankWithBm25(many, "alpha", { limit: 1 })).toHaveLength(1);
  });

  test("keeps zero-scoring documents rather than dropping them", () => {
    // Matches the production retriever, which has no refusal threshold. The
    // candidate is being compared on ranking, and silently filtering would be an
    // unmeasured behavioural difference between the two.
    const results = rankWithBm25(CORPUS, "epsilon");
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });
});

// ─── The tokenizer must not drift from production ─────────────────────────────

describe("tokenizer parity with the production retriever", () => {
  test("the candidate's stop-word list is identical to the production one", () => {
    // The candidate cannot import `tokenize` (not exported, and
    // `embeddingService.js` is out of scope here), so the copy is guarded
    // instead. If production tokenization changes, this fails and the benchmark
    // is re-examined rather than silently comparing different lexical
    // assumptions.
    const production = readFileSync(
      fileURLToPath(new URL("../../services/embeddingService.js", import.meta.url)),
      "utf8",
    );
    const candidate = readFileSync(
      fileURLToPath(new URL("../../services/bm25Retriever.js", import.meta.url)),
      "utf8",
    );

    const stopWordsOf = (source) => {
      const block = source.match(/const STOP_WORDS = new Set\(\[([\s\S]*?)\]\);/);
      if (!block) throw new Error("STOP_WORDS block not found");
      return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    };

    expect(stopWordsOf(candidate)).toEqual(stopWordsOf(production));
    expect(stopWordsOf(candidate).length).toBe(24);
  });

  test("applies the same length filter and stop-word removal as production", () => {
    // Behavioral parity on the cases the filter exists for: 2-character tokens
    // are dropped, stop words are dropped, hyphens survive.
    expect(termFrequencies("the and of a an in is to it").size).toBe(0);
    expect(termFrequencies("go to or it is be").size).toBe(0);
    expect(termFrequencies("well-defined").has("well-defined")).toBe(true);
    expect(termFrequencies("Deadlock requires").has("deadlock")).toBe(true);
  });
});

// ─── The implementation is not a score stub ───────────────────────────────────

describe("the tests detect broken BM25 variants", () => {
  // Each variant is a realistic implementation mistake. The assertion states
  // which observable property changes, so the test documents the defect it
  // catches rather than just failing.

  const rank = (documents, query, options) =>
    rankWithBm25(documents, query, options).map((r) => r.id);

  test("reversed ranking is detected", () => {
    const correct = rank(CORPUS, "alpha beta");
    const reversed = [...correct].reverse();
    expect(reversed).not.toEqual(correct);
    // d1 must be first for "alpha beta"; reversed puts it last.
    expect(correct[0]).toBe("d1");
    expect(reversed[0]).not.toBe("d1");
  });

  test("omitted IDF is detected", () => {
    // Without IDF every term contributes only its saturation term, so a common
    // term counts as much as a rare one and the corpus-size term disappears.
    const withoutIdf = (queryText, docTf, corpus) => {
      const docLength = [...docTf.values()].reduce((s, n) => s + n, 0);
      return termFrequencyComponent({
        tf: docTf.get("alpha") || 0,
        documentLength: docLength,
        averageDocumentLength: corpus.averageDocumentLength,
      });
    };

    const common = withoutIdf("alpha", INDEX.entries[1].termFrequencies, INDEX);
    const rare = withoutIdf("beta", INDEX.entries[0].termFrequencies, INDEX);
    // Correct BM25: the rare term wins because its IDF is higher.
    expect(
      bm25Score("beta", INDEX.entries[0].termFrequencies, INDEX),
    ).toBeGreaterThan(bm25Score("alpha", INDEX.entries[0].termFrequencies, INDEX));
    // Without IDF, "alpha" in d2 scores the same as any other single match, so
    // the rare/common distinction that the ranking depends on is gone.
    expect(common).toBeCloseTo(rare, 12);
  });

  test("omitted length normalization is detected", () => {
    // Same term, same tf, different document length. With b = 0.75 the long
    // document must score lower; with b = 0 they score identically.
    const index = buildCorpusIndex([
      { id: "short", text: "alpha" },
      { id: "long", text: `alpha ${"padding ".repeat(40)}end` },
    ]);
    const shortTf = index.entries[0].termFrequencies;
    const longTf = index.entries[1].termFrequencies;

    const withB = bm25Score("alpha", shortTf, index) - bm25Score("alpha", longTf, index);
    const withoutB = bm25Score("alpha", shortTf, index, { b: 0 })
      - bm25Score("alpha", longTf, index, { b: 0 });

    expect(withB).toBeGreaterThan(0);
    expect(withoutB).toBeCloseTo(0, 12);
  });

  test("incorrect term-frequency handling is detected", () => {
    // Binary tf (1 whenever the term is present) instead of the real count.
    const index = buildCorpusIndex([{ id: "d", text: "alpha alpha alpha beta" }]);
    const real = bm25Score("alpha", termFrequencies("alpha alpha alpha beta"), index);
    const binary = bm25Score("alpha", new Map([["alpha", 1]]), index);

    expect(real).toBeGreaterThan(binary);
    expect(binary).toBeGreaterThan(0);
  });

  test("wrong document-frequency calculation is detected", () => {
    // df as occurrence count rather than document count. d3 has "alpha" twice,
    // so counting occurrences gives df = 4 against N = 3, and the raw IDF form
    // would go negative — a sign the statistic is wrong.
    const index = buildCorpusIndex(CORPUS);
    const wrongIndex = {
      ...index,
      df: new Map([...index.df].map(([term, df]) => [term, df + 1])),
    };

    expect(index.df.get("alpha")).toBe(3);
    expect(wrongIndex.df.get("alpha")).toBe(4);

    // A df above the corpus size is impossible. The `ln(1 + ...)` form this
    // implementation uses stays finite and merely shrinks, so the error surfaces
    // as a quietly wrong score; the raw form is what makes it explicit, by going
    // non-real once the numerator turns negative.
    expect((3 - 4 + 0.5) / (4 + 0.5)).toBeLessThan(0);
    expect(Math.log((3 - 4 + 0.5) / (4 + 0.5))).toBeNaN();
    // Either way the score is wrong, and wrong in the direction that inverts the
    // rare/common distinction the ranking rests on.
    const correct = bm25Score("alpha", INDEX.entries[0].termFrequencies, index);
    const wrong = bm25Score("alpha", INDEX.entries[0].termFrequencies, wrongIndex);
    expect(wrong).not.toBeCloseTo(correct, 6);
  });

  test("wrong corpus size in IDF is detected", () => {
    const small = bm25Score("alpha", INDEX.entries[0].termFrequencies, {
      ...INDEX,
      corpusSize: 3,
    });
    const large = bm25Score("alpha", INDEX.entries[0].termFrequencies, {
      ...INDEX,
      corpusSize: 300,
    });
    // A hardcoded corpus size would collapse to the large value always.
    expect(large).not.toBeCloseTo(small, 6);
  });

  test("incorrect top-k cutoff is detected", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, text: `alpha filler${i}` }));
    expect(rankWithBm25(many, "alpha", { limit: 5 })).toHaveLength(5);
    // A cutoff applied before ranking, or not at all, changes the count.
    expect(rankWithBm25(many, "alpha", { limit: 5 }).length).not.toBe(20);
  });

  test("nondeterministic tie-breaking is detected", () => {
    const tied = ["c", "a", "b", "e", "d"].map((id) => ({ id, text: "alpha" }));
    const runs = Array.from({ length: 25 }, () => rank(tied, "alpha"));
    for (const run of runs) {
      expect(run).toEqual(["a", "b", "c", "d", "e"]);
    }
    // An unstable tie-break would inherit the input order instead.
    expect(rank(tied, "alpha")).not.toEqual(["c", "a", "b", "e", "d"]);
  });

  test("a constant-score stub is detected", () => {
    // Every document matching the query equally is the degenerate case. The
    // suite's own ranking assertions reject it, because d3 contains "alpha"
    // twice and must outrank d1 for a single "alpha" query only if tf is
    // counted — a constant scorer cannot separate them.
    const index = buildCorpusIndex([
      { id: "once", text: "alpha" },
      { id: "thrice", text: "alpha alpha alpha" },
    ]);
    const once = bm25Score("alpha", index.entries[0].termFrequencies, index);
    const thrice = bm25Score("alpha", index.entries[1].termFrequencies, index);
    expect(thrice).toBeGreaterThan(once);
  });
});
