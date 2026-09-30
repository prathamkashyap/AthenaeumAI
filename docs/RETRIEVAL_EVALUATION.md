# Retrieval Evaluation

A labeled gold set and a reproducible offline evaluation of AthenaeumAI's
**current production retriever**, so that any future retrieval change can be
judged against measured numbers instead of an assumption that a different
technique would be better.

This document describes measurement only. Nothing in the retrieval algorithm was
changed to produce these results.

---

## What is being measured

`searchMaterialChunks` in `backend/services/embeddingService.js` — the single
production retrieval entry point, called by `gatherTutorContext`
(`backend/services/tutorService.js:93`) with `limit: 6`.

| Aspect | Current production behaviour |
| --- | --- |
| Model identifier | `local-hash-v1` (`embeddingService.js:7`) |
| Dimensionality | 384 (`embeddingService.js:4`) |
| Tokenizer | lowercase → strip to `[a-z0-9\s-]` → whitespace split → drop length ≤ 2 → drop 24 stop words (`embeddingService.js:9-20`) |
| Construction | Signed hashing trick; FNV-1a 32-bit hash, bucket `hash % 384`, sign `+1`/`-1` by hash parity, positional weight `1 + max(0, 1 - pos/n) × 0.08`, L2-normalised to 6 dp (`embeddingService.js:22-49`) |
| Similarity | Dot product of normalised vectors; empty or mismatched length → `0` (`embeddingService.js:51-56`) |
| Lexical score | Size of the set intersection of query tokens and chunk tokens, divided by the query token count, same tokenizer (`embeddingService.js:162-171`) |
| Combined score | `0.78 × vectorScore + 0.22 × lexicalScore`, rounded to 4 dp (`embeddingService.js:196`) |
| Ranking | Descending combined score, then `slice(0, clamp(limit, 1, 12))` (`embeddingService.js:199-200`) |
| Corpus scope | Always `{ user: userId }`, optional `studyMaterial` filter (`embeddingService.js:181-182`) |
| Query mechanism | Whole scoped corpus loaded into Node and ranked there. No ANN, no vector index (`embeddingService.js:184-200`) |
| Indexing | Both eager (the `INDEX_MATERIAL` background job) and lazily re-checked on **every** search via `ensureChunksForUser` (`embeddingService.js:179`) |
| Refusal threshold | **None.** Top-N is returned regardless of score, including when every score is 0. |

**This retriever is lexical.** It produces a numeric similarity score, but a
non-zero score requires either a shared exact token or an accidental hash-bucket
collision. It has no semantic understanding, and nothing in this benchmark
should be read as evidence that it has.

---

## Gold set

`backend/tests/fixtures/retrieval-gold-set.json`

- **16 chunks** across 4 materials, hand-authored.
- **12 labeled queries.**
- Chunk keys are `${materialKey}#${chunkIndex}`, stable across runs. No Mongo
  `_id`, timestamp, or other ephemeral value is used.
- Fixture chunks carry embeddings produced by the production
  `generateEmbedding`, exactly as `indexStudyMaterialChunks` does when indexing,
  so the vector a query is compared against is built by production code.

### Label semantics

A chunk is relevant to a query when it is the passage a reader would consult to
answer the question. Topical overlap alone is not sufficient.

**The labels are authored from the subject matter, not from any retriever
output.** The retriever is the system under evaluation, and no label was
generated, adjusted or removed on the basis of what it returned. Relevance is
decided solely by chunk-key membership; returned scores are never consulted.

### Query categories

| Category | Queries | Purpose |
| --- | --- | --- |
| `exact-terminology` | q01, q02, q03, q04, q05, q12 | Vocabulary that appears almost verbatim in the answer |
| `relevant-chunk-late-in-corpus` | q06 | The answer sits near the end of the corpus |
| `multiple-relevant` | q07 | Two chunks are both required, so precision is not trivially 1/k |
| `lexical-overlap-distractor` | q08 | A `finance-notes` chunk shares the algorithm name and allocation vocabulary but answers a different question |
| `paraphrase-expected-to-struggle` | q09, q10 | Deliberately worded away from the source vocabulary |
| `cross-material` | q11 | The answer lives in a different material |

Four chunks (`net-notes#0/1`, `ds-notes#0/1`) are labeled **filler distractors**:
unrelated material that is never relevant to any query and exists to make
ranking harder and to exercise the top-k ceiling.

---

## Metric definitions

Implemented in `backend/tests/unit/retrievalBaseline.test.js`. One consistent
convention is used across all queries.

- **HitRate@k** — fraction of queries for which at least one relevant chunk
  appears in the top `k` returned chunks. `1.0` means every query found
  something relevant within `k`.
- **Precision@k** — relevant chunks among the top `k`, divided by **`k`**, not by
  the length of the result. A query that returns nothing therefore scores `0`
  rather than a perfect `1`. This keeps the metric comparable across queries and
  against any future retriever that returns a different number of results.
- **MRR (Mean Reciprocal Rank)** — for each query the reciprocal rank is `1 / rank`
  of the first relevant chunk, with **1-based** rank, and `0` when no relevant
  chunk appears. MRR is the mean of those values, so it rewards putting a
  relevant chunk *first* rather than merely retrieving it somewhere.

Evaluation runs with `limit: 5` unless a test states otherwise.

---

## Baseline results

Measured against the production retriever, commit `c188429` (Task 9), with no
production retrieval change.

| Metric | Value |
| --- | --- |
| Query count | 12 |
| **HitRate@1** | **0.7500** |
| **HitRate@3** | **0.9167** |
| **HitRate@5** | **1.0000** |
| **Precision@5** | **0.2167** |
| **MRR** | **0.8403** |

### Per-query table

```
query                           category                         expect  firstRel  R@1  R@3  R@5  P@5   RR
------------------------------  -------------------------------  ------  --------  ---  ---  ---  ----  -----
q01-process-states              exact-terminology                1       3         NO   yes  yes  0.20  0.333
q02-process-control-block       exact-terminology                1       1         yes  yes  yes  0.20  1.000
q03-deadlock-conditions         exact-terminology                1       1         yes  yes  yes  0.20  1.000
q04-page-replacement            exact-terminology                1       1         yes  yes  yes  0.20  1.000
q05-page-fault-handling         exact-terminology                1       1         yes  yes  yes  0.20  1.000
q06-late-corpus-chunk           relevant-chunk-late-in-corpus    1       1         yes  yes  yes  0.20  1.000
q07-multiple-relevant           multiple-relevant                2       2         NO   yes  yes  0.40  0.500
q08-safe-allocation-distractor  lexical-overlap-distractor       1       1         yes  yes  yes  0.20  1.000
q09-time-slice-paraphrase       paraphrase-expected-to-struggle  1       4         NO   NO   yes  0.20  0.250
q10-memory-pressure-paraphrase  paraphrase-expected-to-struggle  1       1         yes  yes  yes  0.20  1.000
q11-buffer-pool-distractor      cross-material                   1       1         yes  yes  yes  0.20  1.000
q12-ambiguous-allocation        exact-terminology                1       1         yes  yes  yes  0.20  1.000
```

### Reading the numbers

**HitRate@5 is 1.0.** Every query retrieves something relevant within five
results. On this corpus, *recall is not the retriever's weakness*.

**HitRate@1 is 0.75 and MRR is 0.84.** *Ranking is the weakness.* The failure
mode is putting the right passage second, third or fourth behind a
lexically-adjacent distractor, not failing to retrieve it at all.

**Precision@5 of 0.2167 is at this gold set's ceiling, not a defect.** The
corpus has 13 relevant judgments across 12 queries over a fixed 5-slot window,
so the best achievable value is `13 / 60 = 0.2167`, and that is what was
observed. Precision@5 therefore **cannot discriminate** a better retriever on
this gold set. The discriminative metrics here are **HitRate@1 and MRR**. A
future gold set intended to measure precision should either return fewer
results or carry more relevant judgments per query.

---

## Observed failure patterns

1. **q09 — paraphrase with almost no shared vocabulary (rank 4, fails @3).**
   "How do the jobs take turns on the machine when their allotted interval runs
   out?" against a passage about round-robin scheduling that says *process*,
   *processor* and *time slice*. The only recoverable signal is incidental
   hash-bucket collision, and it is not enough. This is the clearest measured
   limitation of a purely lexical retriever, and it is present by design so that
   the weakness stays visible.

2. **q01 — right answer, wrong rank (rank 3).** "What are the five states of a
   process?" ranks the process control block chunk first. The control block
   passage repeats *process* more often, and the signed hashing rewards raw
   token frequency over topical fit. A longer, more repeated term outranks a
   precise match on two of three query terms.

3. **q07 — multi-answer query, partially crowded (rank 2).** "What causes a
   deadlock, and how can it be avoided?" needs both the conditions and the
   banker's algorithm. Both were retrieved (P@5 = 0.40) but the conditions
   passage lost first place, which is why HitRate@1 drops.

4. **q10 — a paraphrase that *succeeds*, for a known reason.** "What happens
   when the program needs more working memory than the machine physically has?"
   ranks its answer first, because both the query and the virtual memory passage
   contain the token *memory*. It passes on incidental lexical overlap rather
   than understanding. Recorded so the gold set is not read as uniformly
   adversarial to paraphrase.

5. **No refusal threshold.** A query with no lexical relationship to any chunk
   still returns five results, including zero-scoring ones. The tutor therefore
   receives context that may be entirely irrelevant, and nothing in the
   current system signals that.

---

## How to rerun

From `backend/`:

```bash
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest \
  tests/unit/retrievalBaseline.test.js \
  --runInBand
```

The first test prints the per-query table and the aggregate metrics.

The benchmark runs inside Jest because the persistence boundary is replaced with
`jest.unstable_mockModule`, the repository's existing ESM mocking mechanism.
There is no plain-Node entry point for that reason. **No API key, no network, no
Redis, no MongoDB instance, and no external vector service are required.**

---

## Why the benchmark is trustworthy

The evaluation chain is:

```
gold-set labels
    -> production searchMaterialChunks   (unchanged)
    -> production tokenize / hash / cosine / keyword overlap (unchanged)
    -> production scoring and ranking    (unchanged)
    -> metrics
```

Only the two Mongoose model modules are replaced, which is the persistence
boundary. The hashing, tokenization, cosine calculation and keyword-overlap
formula are **never** reimplemented in the harness.

`backend/tests/unit/retrievalBaseline.test.js` additionally proves the benchmark
is not vacuous:

- Reversing the production ranking strictly worsens HitRate@1 and MRR.
- Returning fixture insertion order instead of production ranking strictly
  worsens MRR, so the production score is load-bearing.
- At least one query ranks its answer below first place, and MRR is below 1.
- At least one query has multiple relevant chunks, so precision and hit@k are
  meaningful.
- Relevance is computed from gold labels alone, never from returned scores.
- A chunk owned by a different learner is present in the corpus and provably
  cannot appear in any result, including when the material filter is applied.
- Metric cutoff semantics, the precision divisor, the 1-based rank convention and
  the empty-result case are pinned directly against known result lists.

### Mutation results

All 18 targeted mutations are detected, including reversed ranking, ignored
tenant filter, ignored material filter, insertion order instead of ranking, a
constant score, each scoring weight dropped, the weights swapped, both directions
of the top-k clamp change, stop words retained, short tokens retained, changed
bucket count, ignored top-k cutoff in the evaluator, a fabricated reciprocal
rank, precision divided by result count, ignored labels, and a 0-based rank.

---

## Candidate evaluation: BM25 (Task 16A)

An evaluation slice, not a migration. `backend/services/bm25Retriever.js` implements
standard BM25 as a **candidate**. Nothing imports it, no endpoint uses it, and
`searchMaterialChunks` remains the only production retrieval path. The purpose is
to answer one question with measurements rather than assumption: does BM25 rank
this corpus better than the shipped retriever?

### Method

Identical gold set, identical corpus, identical labels, identical metric
definitions. Only the scorer differs, so a difference in the numbers is
attributable to the scoring function.

| | |
| --- | --- |
| Formula | Robertson & Zaragoza (2009), `IDF(q) = ln(1 + (N - df + 0.5)/(df + 0.5))` |
| Parameters | `k1 = 1.2`, `b = 0.75` — fixed TREC defaults, **not tuned** |
| Tokenizer | Verbatim copy of the production tokenizer (`embeddingService.js:9-20`) |
| Ranking | Descending score, then ascending document id as a total-order tie-break |
| Top-k | `clamp(limit, 1, 12)`, matching production including its `Number(limit) \|\| 5` defaulting |
| Dependencies | None. No Elasticsearch, Qdrant, Lucene, or scoring library. |
| Network | None. |

`tokenize` is not exported from `embeddingService.js`, and that file is out of
scope for an evaluation, so the tokenizer is duplicated and **guarded**: a test
reads both source files and fails if the stop-word lists diverge. A different
tokenizer would confound the comparison; a silently drifted one would corrupt it.

`k1` and `b` are deliberately untuned. Fitting two parameters against 12 queries
would overfit a corpus far too small to support the search, and the result would
say nothing about the technique.

### Results — BM25 vs local-hash-v1

```
metric         BM25      local-hash-v1     delta
HitRate@1         0.7500        0.7500     0.0000
HitRate@3         0.9167        0.9167     0.0000
HitRate@5         1.0000        1.0000     0.0000
Precision@5       0.2167        0.2167     0.0000
MRR               0.8361        0.8403    -0.0042
```

Per-query first-relevant rank:

```
query                           category                         expect  hashRank  bm25Rank  dRank  hashRR  bm25RR  verdict
------------------------------  -------------------------------  ------  --------  --------  -----  ------  ------  -------
q01-process-states              exact-terminology                1       3         3         0      0.333   0.333   same
q02-process-control-block       exact-terminology                1       1         1         0      1.000   1.000   same
q03-deadlock-conditions         exact-terminology                1       1         1         0      1.000   1.000   same
q04-page-replacement            exact-terminology                1       1         1         0      1.000   1.000   same
q05-page-fault-handling         exact-terminology                1       1         1         0      1.000   1.000   same
q06-late-corpus-chunk           relevant-chunk-late-in-corpus    1       1         1         0      1.000   1.000   same
q07-multiple-relevant           multiple-relevant                2       2         2         0      0.500   0.500   same
q08-safe-allocation-distractor  lexical-overlap-distractor       1       1         1         0      1.000   1.000   same
q09-time-slice-paraphrase       paraphrase-expected-to-struggle  1       4         5         +1     0.250   0.200   worse
q10-memory-pressure-paraphrase  paraphrase-expected-to-struggle  1       1         1         0      1.000   1.000   same
q11-buffer-pool-distractor      cross-material                   1       1         1         0      1.000   1.000   same
q12-ambiguous-allocation        exact-terminology                1       1         1         0      1.000   1.000   same

better: 0  worse: 1  same: 11  lost: 0
```

**BM25 does not improve this gold set. It regresses it very slightly.**

Against the rule stated below — a change is justified only by improving HitRate@1
or MRR — BM25 is not justified. HitRate@1 is unchanged, and MRR falls by 0.0042.
No query improved, and one regressed.

### Why BM25 does not help here, and what that implies

The important question is not "BM25 is bad" but "this gold set cannot separate
the two scorers". Two measurements explain it.

**1. Nine of twelve queries are already ranked first, by both retrievers.**
There is no headroom to recover. The identical top-1 set is q02–q06, q08, q10,
q11, q12, and both place q01 third and q07 second.

**2. The two scorers agree wherever the answer is unambiguous.** Both are
lexical. On `exact-terminology` queries the relevant chunk contains the query
terms more densely than any distractor, so raw frequency, hashed frequency, IDF
and length normalization all reach the same conclusion. They differ only on the
three hardest queries, where the signal is thin.

**The q09 regression is the clearest evidence.** That query is a paraphrase with
almost no shared vocabulary — *jobs, machine, interval* against a passage saying
*process, processor, time slice*. What little overlap it has is the token
`turns`/`turn`. Inspecting the scores:

```
os-notes#4   3.2611   page replacement
os-notes#0   1.7540
os-notes#8   0.9679   round robin  <- the correct answer, 5th
```

`os-notes#4` scores **3.5× higher than the correct answer**. Both retrievers
fail here, for the same underlying reason: there is no lexical evidence to rank
on, so what is left is incidental token overlap with an unrelated chunk. BM25's
IDF and length normalization sharpen the scoring of whatever tokens *do* match,
which makes a spurious match on an unrelated passage rank *higher*, not lower.

This is the substantive finding: **BM25 is a better lexical ranker, and on a
query with no lexical signal, better lexical ranking is not better retrieval.**
A query of this kind needs semantic matching or an embedding model. Neither is
in scope here, and neither would be justified by this gold set alone.

**3. q01 and q07 do not move, and the reason is the tokenizer.** q01's query
reduces to a single content token after stop-word removal and the length filter:

```
"What are the five states of a process?"  ->  [ "what", "process" ]
```

Note *states* is dropped: it is 6 characters, so it survives, but the raw query
passes through the filter and only *what* and *process* remain as matchable
terms — the discriminating term barely exists. The relevant chunk has
`tf(process) = 3`; the outranking control-block chunk has `tf(process) = 4`.
BM25's length normalization penalizes the *longer* document, but not enough to
close a 3-vs-4 frequency gap, and *states* appears in neither. This is a
**tokenization/recall** limitation, not a ranking one, and no change to the
scoring function can fix it. It is the strongest argument for a later
tokenization study, and the clearest argument against more scoring work.

### What this benchmark can and cannot decide

This gold set was built to measure ranking quality, and it has done its job: it
produced a defensible **negative** result. Twelve queries, of which nine are
saturated, cannot separate two retrievers that agree on all of them. That is a
property of the gold set, and it means:

- A negative result here means **"not demonstrated on 12 queries"**, not
  "proven worse on a real corpus". BM25 is standard and would likely scale
  better than a 384-dim hash on a large corpus; this benchmark cannot see that.
- If the next retrieval decision needs a discriminating measurement, the gold
  set needs more hard queries first — the fix is a better benchmark, not a
  different scorer.
- Precision@5 remains at ceiling (13/60) and still cannot discriminate anything.

### Reproducing

From `backend/`:

```bash
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest \
  tests/unit/bm25CandidateEvaluation.test.js \
  --runInBand
```

No API key, network, Redis, MongoDB, or external service required. The unit
suite is `tests/unit/bm25Retriever.test.js` (37 tests), which pins the formula
against hand-computed values and introduces seven deliberate defects —
reversed ranking, omitted IDF, omitted length normalization, binary term
frequency, wrong document frequency, wrong corpus size, and nondeterministic
tie-breaking — asserting each one is caught.

---

## Rule for future retrieval work

Any change to retrieval — BM25, semantic embeddings, a vector store, an ANN
index, a hybrid reranker, or a different tokenizer — **must be evaluated on this
same gold set and must beat or meaningfully improve on the baseline above**, with
the comparison reported rather than asserted.

Specifically:

- A change that does not improve **HitRate@1 or MRR** is not justified by this
  benchmark, regardless of what it does to Precision@5 (which is already at
  ceiling) or to latency.
- The current weakness is **ranking**, not recall. A change should be expected to
  move HitRate@1 and MRR, and should be required to.
- A change that alters results is expected to **break** the exact-value
  assertion in `retrievalBaseline.test.js`. That failure is the signal that the
  baseline moved. Re-adjudicate the gold set, re-measure, and update this
  document before quoting new numbers.
- Do not relabel the gold set in response to a retriever change. The labels
  describe the subject matter, and changing them to match a new system would
  destroy the only thing this benchmark provides.
