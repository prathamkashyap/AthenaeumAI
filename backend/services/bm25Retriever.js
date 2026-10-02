/**
 * BM25 lexical retriever — candidate for evaluation only.
 *
 * This module exists to answer one measured question: does standard BM25 rank
 * AthenaeumAI's labeled retrieval corpus better than the shipped `local-hash-v1`
 * retriever? It is deliberately NOT wired into production. `searchMaterialChunks`
 * in `embeddingService.js` remains the only production retrieval path, and nothing
 * in the application imports this file.
 *
 * It is kept as a standalone, dependency-free scoring function so that a later
 * comparison of local-hash-v1 / BM25 / hybrid-RRF can share one scoring
 * implementation rather than three divergent copies.
 *
 * The formula is Robertson & Zaragoza's 2009 variant with the standard
 * IDF floor:
 *
 *   score(D, Q) = Σ  IDF(q) · (tf · (k1 + 1))
 *                      ─────────────────────────────
 *                      tf + k1 · (1 - b + b · |D|/avgdl)
 *
 *   IDF(q) = ln(1 + (N - df + 0.5) / (df + 0.5))
 *
 * The `ln(1 + ...)` form is used rather than the raw `ln((N - df + 0.5)/(df + 0.5))`
 * because the raw form goes negative for terms appearing in more than half the
 * corpus, which would let a common term actively subtract from a document's
 * score. The `1 +` variant is the standard fix and is what most production
 * implementations ship.
 *
 * Why `k1 = 1.2` and `b = 0.75`: these are the values Robertson & Zaragoza
 * measured as best on TREC, and they are the near-universal defaults. They are
 * fixed constants here, not tuned. Tuning them against this 12-query gold set
 * would overfit a corpus far too small to support 2-parameter search, and would
 * make the result say nothing about the technique.
 */

/** Term-frequency saturation. The TREC default; see the module comment. */
export const BM25_K1 = 1.2;

/** Length normalization strength. The TREC default; see the module comment. */
export const BM25_B = 0.75;

/**
 * The production retriever's own tokenizer, used verbatim.
 *
 * Reusing `tokenize` from `embeddingService.js` rather than writing a second one
 * is deliberate and load-bearing. BM25 is compared against the baseline on
 * identical lexical assumptions, so any measured difference is attributable to
 * the scoring function instead of to a different notion of what a word is.
 * Writing a local tokenizer here — even a nearly identical one — would confound
 * the exact comparison the benchmark exists to make, and the divergence would be
 * invisible in the results.
 *
 * The import direction is deliberate too: BM25 depends on the tokenizer, and the
 * tokenizer does not know BM25 exists. Nothing in `embeddingService.js` imports
 * this module, so this stays a leaf that no request path reaches.
 */
/**
 * A verbatim copy of the production retriever's tokenizer.
 *
 * It is duplicated rather than imported for one reason: `tokenize` is not
 * exported from `embeddingService.js`, and that file is out of scope for this
 * evaluation slice. Exporting it purely to serve a benchmark would be a change
 * to the module the benchmark is supposed to be measuring, which is the exact
 * thing this task forbids.
 *
 * Duplication of a tokenizer is normally a defect, so it is guarded rather than
 * left to discipline: `tests/unit/bm25Retriever.test.js` reads
 * `embeddingService.js` from disk and fails if this copy and the production one
 * have diverged. If production tokenization is ever changed, that test fails and
 * the benchmark is re-examined instead of silently comparing two different
 * lexical assumptions.
 *
 * Keep this in sync with `embeddingService.js:9-20` and nothing else.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

/**
 * Term frequencies for one document.
 *
 * @returns {Map<string, number>} token -> occurrences within the document.
 */
export const termFrequencies = (text) => {
  const frequencies = new Map();
  for (const token of tokenize(text)) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
};

/**
 * Inverse document frequency for one term.
 *
 * `N` is the corpus size and `df` the number of documents containing the term.
 * A term in every document gets a small positive score rather than a negative
 * one, which is the property that distinguishes this IDF from the raw form.
 */
export const inverseDocumentFrequency = (df, corpusSize, { k1 = BM25_K1 } = {}) => {
  if (corpusSize <= 0) return 0;
  // The parameter is carried so the signature mirrors the scoring function and
  // so a caller can pass it explicitly; IDF itself does not depend on k1.
  void k1;
  return Math.log(1 + (corpusSize - df + 0.5) / (df + 0.5));
};

/**
 * The saturation and length-normalization factor for one query term in one
 * document, before IDF is applied.
 *
 * Exposed separately so the denominator can be asserted directly in tests:
 * omitting length normalization entirely is otherwise invisible to a score-only
 * assertion, because a corpus of similar-length documents barely changes rank.
 */
export const termFrequencyComponent = ({
  tf,
  documentLength,
  averageDocumentLength,
  k1 = BM25_K1,
  b = BM25_B,
}) => {
  if (tf <= 0) return 0;
  const average = averageDocumentLength > 0 ? averageDocumentLength : documentLength;
  const normalization = 1 - b + b * (documentLength / average);
  return (tf * (k1 + 1)) / (tf + k1 * normalization);
};

/** BM25 contribution of a single query term to a single document. */
export const termScore = ({
  tf,
  documentLength,
  averageDocumentLength,
  df,
  corpusSize,
  k1 = BM25_K1,
  b = BM25_B,
}) =>
  inverseDocumentFrequency(df, corpusSize) *
  termFrequencyComponent({ tf, documentLength, averageDocumentLength, k1, b });

/**
 * BM25 score of one document against a query.
 *
 * @param {string} queryText
 * @param {Map<string, number>} documentTermFrequencies
 * @param {{ df: Map<string, number>, corpusSize: number, averageDocumentLength: number }} corpus
 */
export const bm25Score = (queryText, documentTermFrequencies, corpus, options = {}) => {
  const { df, corpusSize, averageDocumentLength } = corpus;
  const documentLength = documentTermFrequencies.size > 0
    ? Array.from(documentTermFrequencies.values()).reduce((sum, n) => sum + n, 0)
    : 0;

  let score = 0;
  const seen = new Set();
  for (const token of tokenize(queryText)) {
    // Query-side duplicates must not double-count. Standard BM25 iterates over
    // the query's *term set*, not its token list, so a repeated query word
    // contributes once. `seen` enforces that.
    if (seen.has(token)) continue;
    seen.add(token);

    const tf = documentTermFrequencies.get(token) || 0;
    if (tf === 0) continue;

    score += termScore({
      tf,
      documentLength,
      averageDocumentLength,
      df: df.get(token) || 0,
      corpusSize,
      ...options,
    });
  }
  return score;
};

/**
 * Builds the corpus-level statistics BM25 needs.
 *
 * Document frequency, corpus size and average document length are properties of
 * the corpus, not of a single document, so they are computed once and reused
 * across every query. A retriever that recomputed df per query, or divided by a
 * constant instead of the real corpus size, would still produce plausible
 * numbers on a small corpus while being wrong in general.
 */
export const buildCorpusIndex = (documents) => {
  const entries = documents.map((doc) => ({
    id: doc.id,
    termFrequencies: termFrequencies(doc.text),
  }));

  const df = new Map();
  for (const entry of entries) {
    for (const token of entry.termFrequencies.keys()) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const totalLength = entries.reduce(
    (sum, entry) => sum + Array.from(entry.termFrequencies.values()).reduce((s, n) => s + n, 0),
    0,
  );

  return {
    df,
    corpusSize: entries.length,
    averageDocumentLength: entries.length > 0 ? totalLength / entries.length : 0,
    entries,
  };
};

/**
 * Ranks documents by BM25, deterministically.
 *
 * Ordering is by descending score, with the document id as a total-order
 * tie-break. The tie-break is not cosmetic: without it, two documents with equal
 * scores inherit corpus order, so results depend on how the corpus happened to
 * be loaded. That is the difference between a ranking and a traversal.
 *
 * @param {{ id: string, text: string }[]} documents
 * @param {string} query
 * @param {number} limit
 */
export const rankWithBm25 = (documents, query, { limit = 5, k1 = BM25_K1, b = BM25_B } = {}) => {
  const index = buildCorpusIndex(documents);
  // Mirrors the production clamp `clamp(limit, 1, 12)`, including its treatment
  // of a non-numeric or zero limit as the default. `|| 5` is applied *before* the
  // clamp, not after, so an explicit 0 becomes 5 exactly as production does,
  // and a genuine out-of-range value like 50 is clamped rather than defaulted.
  const requested = Number(limit) || 5;
  const capped = Math.min(Math.max(requested, 1), 12);

  const scored = documents.map((doc) => {
    const entry = index.entries.find((candidate) => candidate.id === doc.id);
    return {
      ...doc,
      score: bm25Score(query, entry.termFrequencies, index, { k1, b }),
    };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, capped);
};
