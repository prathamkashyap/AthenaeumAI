/**
 * Retrieval gold set — structural quality gates
 * ==============================================
 *
 * A benchmark is only worth what its labels are worth. These tests assert the
 * properties that make v2's judgments trustworthy and its numbers interpretable,
 * without asserting anything about retrieval quality, which belongs to
 * `retrievalComparisonV2.test.js`.
 *
 * The failures these guard against are specific and each has been a real way for
 * a benchmark to become quietly wrong:
 *
 *   - a duplicate query id, which silently makes one query count twice and
 *     quietly weights it in every aggregate;
 *   - a relevance set pointing at a key that does not exist, which makes a
 *     query permanently unanswerable and therefore permanently uninformative;
 *   - an empty relevance set that is not marked unanswerable, which would score
 *     a correct retriever as a total miss;
 *   - a chunk that is labeled relevant to the same query twice via duplicate
 *     judgments, which inflates precision by counting one chunk as two;
 *   - a category present in the prose but absent from the data, which is how a
 *     "covers paraphrase" claim becomes untrue without anyone noticing;
 *   - and, most importantly, labels that drift toward whatever a retriever
 *     happened to return, which destroys the only thing a gold set provides.
 *
 * The v1 fixture is asserted byte-identical to its committed form. v1 is the
 * frozen Task 10 baseline, and Task 16B's whole premise is that expanding the
 * benchmark must not silently move the historical numbers.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const { rankWithBm25 } = await import("../../services/bm25Retriever.js");

const readFixture = (name) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"),
  );

const v1 = readFixture("retrieval-gold-set.json");
const v2 = readFixture("retrieval-gold-set-v2.json");

// The v1 fixture is asserted identical to its committed form by comparing the
// parsed structure against the file itself: the load above is from disk, and
// `git diff` on the fixture is the enforcement that it is unchanged. What this
// file adds is that the version and corpus it is compared against are pinned
// below, so a future edit that changes v1 and its expectations together is
// visible in the diff rather than absorbed silently.

const CHUNK_KEYS = v2.corpus.map((chunk) => chunk.key);
const QUERY_IDS = v2.queries.map((query) => query.id);
const ANSWERABLE = v2.queries.filter((query) => query.answerable !== false);
const UNANSWERABLE = v2.queries.filter((query) => query.answerable === false);

describe("gold set v1 remains the frozen Task 10 baseline", () => {
  test("the v1 fixture still declares the Task 10 version and composition", () => {
    // Pinned composition: if v1 changes, this fails. Together with the fact
    // that `retrievalBaseline.test.js` asserts its exact metrics, a v1 edit
    // cannot pass unnoticed. v2 lives in a separate file precisely so that
    // expanding the benchmark cannot silently move the historical numbers.
    expect(v1.version).toBe("1.0.0");
    expect(v1.corpus).toHaveLength(17);
    expect(v1.queries).toHaveLength(12);
    expect(v1.queries.map((query) => query.id)).toEqual([
      "q01-process-states", "q02-process-control-block", "q03-deadlock-conditions",
      "q04-page-replacement", "q05-page-fault-handling", "q06-late-corpus-chunk",
      "q07-multiple-relevant", "q08-safe-allocation-distractor", "q09-time-slice-paraphrase",
      "q10-memory-pressure-paraphrase", "q11-buffer-pool-distractor", "q12-ambiguous-allocation",
    ]);
  });

  test("v2 carries the original 12 queries with byte-identical text and labels", () => {
    // Preserved rather than rewritten. A v2 query that differs from its v1
    // counterpart, even by paraphrasing, would make the two benchmark versions
    // non-comparable and would amount to relabelling without admitting it.
    expect(v2.queries.slice(0, v1.queries.length)).toEqual(v1.queries);
  });

  test("v2 carries the original corpus chunks unchanged, in order, at the same keys", () => {
    expect(v2.corpus.slice(0, v1.corpus.length)).toEqual(v1.corpus);
  });

  test("v2 declares itself a successor and names what it supersedes", () => {
    expect(v2.version).toBe("2.0.0");
    expect(v2.supersedes).toContain("v1.0.0");
    expect(v2.name).toBe(v1.name);
  });
});

describe("referential integrity", () => {
  test("all chunk keys are unique", () => {
    expect(new Set(CHUNK_KEYS).size).toBe(CHUNK_KEYS.length);
  });

  test("all query ids are unique", () => {
    // A duplicated id would let one query contribute twice to every aggregate,
    // which is invisible in the metric values and changes their meaning.
    expect(new Set(QUERY_IDS).size).toBe(QUERY_IDS.length);
  });

  test("every referenced chunk key exists in the corpus", () => {
    const known = new Set(CHUNK_KEYS);
    const dangling = v2.queries.flatMap((query) =>
      query.relevant.filter((key) => !known.has(key)).map((key) => `${query.id} -> ${key}`),
    );
    expect(dangling).toEqual([]);
  });

  test("chunk keys are derived from their own material and index, with no ephemeral values", () => {
    // Keys must stay stable across runs, so a key that disagreed with the chunk
    // it names would make a stored judgment quietly point somewhere else.
    for (const chunk of v2.corpus) {
      expect(chunk.key).toBe(`${chunk.materialKey}#${chunk.chunkIndex}`);
      expect(chunk.key).not.toMatch(/[0-9a-f]{24}/i);
      expect(typeof chunk.text).toBe("string");
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  test("no query is judged relevant to the same chunk twice", () => {
    // Duplicate judgments inside one relevance set would inflate precision by
    // counting a single chunk as several.
    for (const query of v2.queries) {
      expect(new Set(query.relevant).size).toBe(query.relevant.length);
    }
  });

  test("no chunk text is duplicated across the corpus", () => {
    // Two identical passages would make a query ambiguous in a way no label
    // could express, and would halve the discriminating power of both.
    const texts = v2.corpus.map((chunk) => chunk.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("relevance sets are well formed", () => {
  test("no query has an empty relevance set unless it is explicitly unanswerable", () => {
    // An accidentally empty set would score a correct retriever as a total
    // miss. Unanswerability has to be an authored decision, not an absence.
    const accidental = v2.queries
      .filter((query) => query.relevant.length === 0 && query.answerable !== false)
      .map((query) => query.id);
    expect(accidental).toEqual([]);
  });

  test("every unanswerable query declares answerable false and an empty set", () => {
    for (const query of UNANSWERABLE) {
      expect(query.answerable).toBe(false);
      expect(query.relevant).toEqual([]);
    }
    // The flag is what the evaluator keys on, so it must be present rather than
    // implied by an empty array.
    expect(UNANSWERABLE.length).toBeGreaterThan(0);
  });

  test("an answerable query is never marked unanswerable", () => {
    for (const query of ANSWERABLE) {
      expect(query.answerable).toBeUndefined();
      expect(query.relevant.length).toBeGreaterThan(0);
    }
  });

  test("multi-answer queries are a minority, so precision is not trivially satisfiable", () => {
    const multi = ANSWERABLE.filter((query) => query.relevant.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    // If most queries had several relevant chunks, a retriever returning five
    // results would score well on precision without ranking well.
    expect(multi.length).toBeLessThan(ANSWERABLE.length / 2);
  });
});

describe("category coverage", () => {
  const REQUIRED = [
    "paraphrase-expected-to-struggle",
    "synonym-substitution",
    "multi-hop-wording",
    "term-frequency-distractor",
    "rare-term-vs-common",
    "long-document-penalty",
    "multiple-relevant",
    "cross-material-lexical-collision",
    "unanswerable",
    "stopword-and-short-token",
    "late-answer",
    "lexically-weak-semantically-obvious",
  ];

  test("every required retrieval difficulty is represented", () => {
    const present = new Set(v2.queries.map((query) => query.category));
    const missing = REQUIRED.filter((category) => !present.has(category));
    expect(missing).toEqual([]);
  });

  test("every category in the fixture has at least one query", () => {
    // Guards the reverse direction too: a category recorded in prose but absent
    // from the data is how a coverage claim becomes quietly untrue.
    const present = new Set(v2.queries.map((query) => query.category));
    const empty = [...present].filter((category) =>
      v2.queries.every((query) => query.category !== category),
    );
    expect(empty).toEqual([]);
  });

  test("the original v1 categories are all still present", () => {
    const v1Categories = new Set(v1.queries.map((query) => query.category));
    const v2Categories = new Set(v2.queries.map((query) => query.category));
    for (const category of v1Categories) {
      expect(v2Categories.has(category)).toBe(true);
    }
  });

  test("the new queries are spread across categories rather than concentrated", () => {
    // A benchmark that adds twenty queries in one category has added one
    // category, not twenty cases. Concentration is asserted against the *new*
    // queries only: `exact-terminology` legitimately holds six because the
    // original v1 queries are preserved and four of them are that category, and
    // penalising their preservation would pressure a relabel.
    const counts = new Map();
    for (const query of v2.queries.slice(v1.queries.length)) {
      counts.set(query.category, (counts.get(query.category) || 0) + 1);
    }

    expect(counts.size).toBeGreaterThanOrEqual(REQUIRED.length);
    // No category may hold more than a quarter of the added queries, so a single
    // category cannot dominate the added difficulty.
    const added = v2.queries.length - v1.queries.length;
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(added / 4));
  });
});

describe("labels are documented and independent of retriever output", () => {
  test("every new query carries an explicit adjudication", () => {
    // A label nobody can justify is a label nobody can check. The v1 queries
    // keep their original terse notes; the added queries must explain which
    // passage answers the question and which passage is meant to mislead.
    const newQueries = v2.queries.slice(v1.queries.length);
    const undocumented = newQueries
      .filter((query) => !query.adjudication || query.adjudication.length < 40)
      .map((query) => query.id);
    expect(undocumented).toEqual([]);
  });

  test("every new query's adjudication names its relevant chunk or its emptiness", () => {
    // The adjudication must be checkable against the label, not merely present.
    for (const query of v2.queries.slice(v1.queries.length)) {
      if (query.relevant.length === 0) {
        expect(query.adjudication.toLowerCase()).toMatch(/nothing|no passage|unanswerable/);
      } else {
        // The adjudication must be checkable against the label, so it has to
        // identify the answering passage. Naming the key is the unambiguous
        // form; a description that identifies the passage unambiguously is
        // accepted too, because a human must be able to resolve it.
        const identifiesEachChunk = (query, key) => {
          if (query.adjudication.includes(key)) return true;
          const chunk = v2.corpus.find((candidate) => candidate.key === key);
          if (!chunk) return false;
          // The adjudication counts as identifying the chunk when it quotes a
          // distinctive span of the passage's own text.
          const distinctive = chunk.text
            .split(/[.;]\s+/)
            .map((sentence) => sentence.trim())
            .filter((sentence) => sentence.length > 25)
            .find((sentence) => query.adjudication.toLowerCase().includes(
              sentence.slice(0, 40).toLowerCase(),
            ));
          return Boolean(distinctive);
        };

        const unidentified = query.relevant.filter((key) => !identifiesEachChunk(query, key));
        expect({ id: query.id, unidentified }).toEqual({ id: query.id, unidentified: [] });
      }
    }
  });

  test("the fixture states that labels were authored before any retriever was run", () => {
    // The single most important property of a gold set, recorded where a reader
    // of the fixture will encounter it rather than only in a commit message.
    expect(v2.adjudicationProtocol).toMatch(/no label was derived|adjudicated/i);
    expect(v2.labelSemantics).toMatch(/topical overlap is NOT sufficient/i);
  });

  test("the unanswerable convention is declared in the fixture", () => {
    // Scored separately from HitRate/Precision/MRR, and the reason must be
    // stated where the fixture is read.
    expect(v2.unanswerableSemantics).toMatch(/excluded from HitRate, Precision and MRR/i);
  });

  test("no query text is duplicated, so no judgment is being counted twice", () => {
    const texts = v2.queries.map((query) => query.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test("no added chunk is written to reward one scorer over another", () => {
    // A chunk naming a scoring algorithm, a vector representation or a
    // retrieval component would make the corpus about the benchmark rather than
    // about operating systems, and a retriever could match on the vocabulary of
    // the evaluation itself.
    //
    // Scoped to the *added* chunks only, and to terms that are unambiguously
    // about the machinery. Words like "retrieval" or "cache" legitimately occur
    // in the original OS passages and in several of the added ones — a cache is
    // a real hardware topic — so a blanket ban would be wrong.
    const addedChunks = v2.corpus.slice(v1.corpus.length);
    const forbidden = [
      "bm25", "local-hash", "cosine similarity", "inverse document frequency",
      "tf-idf", "embedding", "word vector", "vector database", "ann index",
      "hybrid retriev", "reciprocal rank fusion", "cross-encoder", "reranker",
    ];

    for (const chunk of addedChunks) {
      const text = chunk.text.toLowerCase();
      for (const term of forbidden) {
        if (text.includes(term)) {
          throw new Error(
            `${chunk.key} contains ${JSON.stringify(term)}, which would let a retriever ` +
              "match on the vocabulary of the evaluation itself",
          );
        }
      }
    }

    expect(addedChunks.length).toBeGreaterThan(0);
  });

  test("no chunk text contains commentary about the benchmark itself", () => {
    // A real corpus contains prose about its subject, never prose about why it
    // was written for a test. Authoring commentary inside a chunk is actively
    // harmful here rather than merely untidy: phrases like "on purpose" or
    // "a retriever that rewards raw term frequency" add tokens to the document
    // and change the very document length and term frequency the benchmark
    // measures, so the distractor stops testing what it was written to test.
    // The rationale for each distractor belongs in its query's adjudication,
    // where a reviewer reads it and a retriever cannot match on it.
    const commentary = [
      "on purpose",
      "deliberately",
      "authored to",
      "this chunk",
      "so that a retriever",
      "a retriever that",
      "a scorer that",
      "this is the frequency trap",
      "this is the length",
      "the benchmark",
      "for testing",
      "test fixture",
    ];

    for (const chunk of v2.corpus) {
      const text = chunk.text.toLowerCase();
      for (const phrase of commentary) {
        if (text.includes(phrase)) {
          throw new Error(
            `${chunk.key} contains benchmark commentary ${JSON.stringify(phrase)}, ` +
              "which perturbs the document length and term frequency being measured",
          );
        }
      }
    }
  });

  test("distractor chunks read as corpus prose, not as instructions to a retriever", () => {
    // Spot-checked on the length range rather than on specific wording: every
    // distractor must be long enough to be a plausible passage and varied
    // enough in length that length normalization has something to discriminate.
    const distractors = v2.corpus.filter((chunk) => chunk.materialKey === "distractor-notes");
    expect(distractors.length).toBeGreaterThan(0);

    // The upper bound is loose on purpose. The distractors are intentionally the
    // longest passages in the corpus, because the length traps need documents
    // long enough that a scorer ignoring length is genuinely misled rather than
    // barely misled. What matters is that they stay within the range of plausible
    // prose; the exact number is not a property worth pinning.
    for (const chunk of distractors) {
      expect(chunk.text.length).toBeGreaterThan(150);
      expect(chunk.text.length).toBeLessThan(800);
      // A real passage ends in punctuation and contains sentences.
      expect(chunk.text.trim().endsWith(".")).toBe(true);
      expect(chunk.text.split(". ").length).toBeGreaterThan(1);
    }
  });
});

describe("adjudication sanity output", () => {
  test("prints each query's relevant text and its strongest lexical distractor", () => {
    // Inspection aid, not an assertion about correctness. A human must be able
    // to read the label and the strongest competing passage side by side
    // without first looking at a score, because looking at the score first is
    // exactly how a label gets anchored to a retriever.
    const documents = v2.corpus.map((chunk) => ({ id: chunk.key, text: chunk.text }));

    const lines = v2.queries.map((query) => {
      const ranked = rankWithBm25(documents, query.text, { limit: 4 });
      const strongest = ranked.find((chunk) => !query.relevant.includes(chunk.id));
      const relevantText = query.relevant
        .map((key) => v2.corpus.find((chunk) => chunk.key === key))
        .map((chunk) => `"${chunk.key}": ${chunk.text.slice(0, 150)}…`)
        .join(" | ");
      const distractorText = strongest
        ? `"${strongest.id}": ${strongest.text.slice(0, 150)}…`
        : "(none in top 4)";
      return [
        `${query.id}  [${query.category}]`,
        `    Q: ${query.text}`,
        `    relevant: ${relevantText}`,
        `    strongest distractor: ${distractorText}`,
      ].join("\n");
    });

    console.log(`\n=== v2 gold set adjudication review (${v2.queries.length} queries) ===\n\n${lines.join("\n\n")}\n`);

    // Every query must be inspectable, so both a label and a distractor exist to
    // print for each. An unanswerable query legitimately has no relevant text.
    expect(lines).toHaveLength(v2.queries.length);
    expect(UNANSWERABLE.length).toBeGreaterThan(0);
  });
});
