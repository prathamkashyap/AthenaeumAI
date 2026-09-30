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
| Refusal threshold | **None.** Top-N is returned regardless of score, including when every score is 0. The tutor applies its own grounding gate downstream (`services/tutorGrounding.js`), which refuses only when *no* chunk carries a non-zero score. See `docs/KNOWN_LIMITATIONS.md`: no score threshold can separate correct from incorrect retrieval on this retriever, so no threshold is applied. |

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

## Gold set v2.0.0 — the discriminating benchmark (Task 16B)

`backend/tests/fixtures/retrieval-gold-set-v2.json`

**The v1 fixture and its baseline above remain frozen and reproducible.**
`retrievalBaseline.test.js` is unchanged and still asserts
`0.7500 / 0.9167 / 1.0000 / 0.2167 / 0.8403` at 18/18. v2 is a *new*
evaluation set in a *separate* file, so expanding the benchmark could not
silently move the historical numbers. All 12 v1 queries and all 17 v1 chunks are
carried into v2 byte-identically, in the same order, at the same keys.

### Why v2 exists

16A measured BM25 and found no separation, and the cause was structural rather
than a property of either scorer. Nine of v1's twelve queries were **saturated**:
both retrievers already ranked the answer first. Nine identical queries dilute
every aggregate delta roughly four to one, so a benchmark built mostly from them
cannot distinguish a good retriever from a bad one no matter how good it is. The
three unsaturated queries were the only source of signal.

v2 adds 19 queries and 23 chunks chosen so a scorer is expected to fail them for
**stated** reasons: raw term frequency, ignored document length, or an inability
to tell evidence from a keyword list.

| | v1 | v2 |
| --- | --- | --- |
| Corpus chunks | 17 | 40 |
| Queries | 12 | 31 (29 answerable, 2 unanswerable) |
| Saturated (both rank first) | 9 of 12 = **75%** | 20 of 29 = **69%** |

### Adjudication protocol

Every label was decided by reading the subject matter and asking which passage a
domain-literate reader would consult. **No label was derived from, adjusted
toward, or removed on the basis of what either retriever returned.** Queries were
authored from the subject matter first and the measurement was run afterwards.
Each added query carries an `adjudication` field naming the answering chunk, the
intended distractor, and the specific difficulty. `retrievalGoldSet.test.js`
asserts every one is present and resolves against the label.

One defect was found and fixed during this work, and it is worth recording
because it is the failure mode this protocol exists to catch. The first draft of
the distractor chunks carried their own rationale inside the chunk text —
phrases like *"on purpose"* and *"a retriever that rewards raw term frequency will
rank this page above…"*. That commentary is not corpus prose, and it is actively
harmful in a benchmark: it adds tokens to the document and changes the very
document length and term frequency the distractor exists to probe. An
anti-commentary test now rejects it. Rationale lives in query adjudications,
where a reviewer reads it and a retriever cannot match on it.

### Results — v2, local-hash-v1 against BM25

```
corpus chunks: 40   queries: 31 (answerable 29, unanswerable 2)

metric         production        BM25     delta
HitRate@1           0.7241      0.7931    +0.0690
HitRate@3           0.8276      0.8276     0.0000
HitRate@5           0.8276      0.8276     0.0000
Precision@5         0.1724      0.1724     0.0000
MRR                 0.7644      0.8103    +0.0460

BM25 improved 3, worsened 1, unchanged 20
both retrievers missed entirely: 5
```

Ranked differently by the two retrievers: **5 of 29** (up from 1 of 12 in v1).
Missed entirely by at least one: **5 of 29**.

### Reading the result

**The benchmark now discriminates, and BM25 measurably wins on it.** HitRate@1
+0.0690 and MRR +0.0460 are the two metrics this repository treats as
justifying a retrieval change. 16A produced −0.0042 MRR on v1; v2 produces
+0.0460. The difference is the benchmark, not the scorer — BM25 is byte-identical
to what 16A measured.

**But do not read this as "BM25 is now the right production retriever."** Three
reasons, in order of how much they should change the decision:

1. **The wins are on exactly three queries**, and two of them are the same
   failure. q22 and q24 both improve from rank 3 to rank 1; q03 improves from
   rank 2 to rank 1. Three queries out of 29 is a small sample, and the margin on
   each is one position.

2. **Both retrievers now miss 5 queries entirely**, and v1's HitRate@5 was 1.0.
   That is a direct consequence of adding 23 chunks: recall got harder, not
   easier. HitRate@5 fell from 1.0000 to 0.8276 for *both* retrievers. The
   expansion bought ranking sensitivity by spending recall headroom, and a
   retrieval change evaluated on v2 alone would not see the v1 recall baseline
   unless both are reported together.

3. **The three wins are the traps working as designed, not as a general
   advantage.** q22 is the lexical-maximal-evidential-empty case: a keyword list
   that says nothing outranks the passage that explains. q24 is the
   lexically-weak case. BM25's length normalization is exactly what defeats a
   frequency trap, so of course it wins the cases built to catch frequency
   over-weighting. That is a real property, and it is also the narrowest
   possible evidence.

**The single regression is q15** (thread shared/private, rank 1 → 2), the
multi-hop query. And the five mutual misses are the honest failures: q01, q07,
q09, q13, q23. For q23 in particular — "What does the term deadlock mean?" —
both retrievers rank the glossary stub above the passage that explains the
conditions, because the stub's short length carries no penalty under production
and its exact lexical match is high. That is a real weakness of the current
system, and it is the kind of thing a reranker could fix and neither lexical
scorer can.

### The discriminating cases and what they show

| Query | Difficulty | Outcome |
| --- | --- | --- |
| q22-deadlock-conditions-evidential | keyword list vs explanation | BM25 3→1 |
| q24-pipeline-dependency-stall | near-zero shared vocabulary | BM25 3→1 |
| q03-deadlock-conditions | evidence vs keyword list (v1 query) | production 2→1 |
| q15-thread-minimal-unit | multi-hop wording | production 1→2 (**BM25 regresses**) |
| q23-deadlock-glossary-trap | short stub vs explanation | **both miss** |
| q13-priority-scheduling-mechanism | synonym, no lexical anchor | **both miss** |
| q01, q07, q09 | v1 weak cases, now diluted by 23 more chunks | **both miss** |

The term-frequency, long-document, rare-term, cross-material-collision and
stopword cases all pass for **both** retrievers, which is itself a finding: those
are not traps either scorer falls into, and the benchmark should not be read as
proving they are easy. They are guards, and they held.

### Unanswerable queries

Two queries (`q30` Kubernetes GPU scheduling, `q31` JIT inlining) assert no chunk
answers them. They are **excluded from HitRate, Precision and MRR** — a query
with no relevant chunk has no meaningful reciprocal rank, and scoring it as a
miss would punish a retriever for the gold set's coverage rather than its
ranking. They are reported separately.

They expose a measured limitation: **both retrievers return a confident top-5 for
a question neither can answer**, because neither has a refusal threshold. This is
a property of the current system, unchanged by this work, and it is where a
future dense retriever, a reranker or a relevance threshold has the most
headroom of anything in this document.

### Reproducing

From `backend/`:

```bash
# v2 comparison: both retrievers, full table and per-query ranks
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest tests/unit/retrievalComparisonV2.test.js --runInBand

# v2 gold set structural gates
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest tests/unit/retrievalGoldSet.test.js --runInBand

# v1 frozen baseline, unchanged
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest tests/unit/retrievalBaseline.test.js --runInBand
```

`retrievalGoldSet.test.js` also prints, for every query, its relevant chunk text
and its strongest competing passage, so a label can be reviewed without looking
at a score first — looking at the score first is exactly how a label becomes
anchored to a retriever.

### Rule for work on v2

- **Report v1 and v2 together.** v1 measures the shipped retriever on the corpus
  users actually had; v2 measures discrimination. A retrieval change that improves
  v2 ranking while degrading v1 recall has traded one for the other, and quoting
  only v2 would hide that.
- **The three-query margin is not a mandate.** Before integrating anything,
  re-measure and check whether the advantage survives on queries not written by
  the same hand as the traps.
- **Do not add queries to move a number.** The saturation rate is now 69%; a
  further expansion that reduced it by diluting with saturated queries would be
  worse than no expansion, and the gate test on category concentration is there
  to make that visible.

---

## Holdout v1.0.0 — Task 16C exploratory (superseded, retained for the record)

`backend/tests/fixtures/retrieval-gold-set-holdout-v1.json`

> **This set is retained unchanged as an exploratory result. It is NOT
> independent evidence and must not be cited as such.** See "Why it was
> withdrawn" below.

### What it showed

Frozen before scoring, 24 ordinary learner questions over the same 40-chunk
corpus:

| Metric | local-hash-v1 | BM25 | Delta |
| --- | --- | --- | --- |
| HitRate@1 | 0.9167 | 0.9583 | +0.0417 |
| HitRate@3 | 1.0000 | 1.0000 | 0.0000 |
| HitRate@5 | 1.0000 | 1.0000 | 0.0000 |
| Precision@5 | 0.2083 | 0.2083 | 0.0000 |
| MRR | 0.9583 | 0.9792 | +0.0208 |

BM25: 2 improved, 1 worsened, 21 unchanged, nothing missed by either retriever.
**Saturation 21/24 = 87.5%.**

### Why it was withdrawn

1. **It was authored by the same process that authored v2**, which had already
   seen v2's results. It demonstrated independence from *retriever outputs* — the
   fixture was frozen before scoring — but not independence from the *benchmark
   author's construction choices*.
2. **Two queries visibly reused prior patterns.** `h21`'s own adjudication
   describes itself as "the v1 q08 distractor pattern recurring", and
   `h02` reproduced the length-normalisation phenomenon v2 was built around.
3. **87.5% saturation.** Three changed queries cannot support a claim about
   effect size.

It remains on disk because deleting a measurement because it was inconclusive
would be worse than recording why. Its +0.0417 / +0.0208 figures are
**supporting, not independent**, evidence.

---

## Holdout v2.0.0 — coverage-driven, and still not independent (Task 16C-R)

`backend/tests/fixtures/retrieval-gold-set-holdout-v2.json`

### The claim being made, precisely

**This set is not independent.** It was authored by the same process that
authored v2 and had seen v2's results. The fixture says this in its
`independenceClaim` field, and a test asserts the field still says it, so the
file cannot quietly stop making the admission.

What changed is the *authoring method*, which is a partial mitigation and is
worth stating precisely rather than generously:

> **Coverage-driven authoring.** Every answerable passage in the corpus was
> enumerated first, then covered by at least one question, with a second question
> only where a passage supports two distinct ones. The question set is fixed by
> what the corpus contains, not by which cases a retriever was seen to win.

All 34 answerable passages are covered (asserted by test), the 6 constructed
`distractor-notes` passages are never labeled relevant (asserted by test), and no
question reuses an id or text from v1, v2 or the exploratory holdout (asserted
by test).

This removes *selection-by-judgment*, which is the failure mode hardest to
notice. It does **not** produce provenance independence, and no automated test
can: the artifact such a test would examine is the file itself, so asserting it
there would be a fiction. Genuine independence requires an author who has not
seen v1, v2 or this file. That has not happened.

### Results

40 chunks, 38 queries, all answerable.

| Metric | local-hash-v1 | BM25 | Delta |
| --- | --- | --- | --- |
| HitRate@1 | 0.9211 | 0.9211 | **0.0000** |
| HitRate@3 | 1.0000 | 1.0000 | 0.0000 |
| HitRate@5 | 1.0000 | 1.0000 | 0.0000 |
| Precision@5 | 0.2000 | 0.2053 | +0.0053 |
| MRR | 0.9474 | 0.9518 | +0.0044 |

BM25: **1 improved, 1 worsened, 36 unchanged. Nothing missed by either
retriever.** Ranks differ on **2 of 38**.

**Saturation: 34 of 38 = 89.5%. Unsaturated share 10.5%.**

### The result, stated honestly

**The BM25 advantage essentially disappears.** HitRate@1 is *identical* at
0.9211. MRR moves +0.0044, which is one query out of 38.

This is a materially weaker result than the exploratory holdout reported
(+0.0417 / +0.0208), and the difference is the finding, not a discrepancy:

| Set | Queries | Method | HitRate@1 Δ | MRR Δ | Saturated |
| --- | --- | --- | --- | --- | --- |
| v2 | 29 answerable | constructed traps | +0.0690 | +0.0460 | 69% |
| holdout-v1 | 24 | hand-picked ordinary | +0.0417 | +0.0208 | 87.5% |
| **holdout-v2** | **38** | **coverage-driven** | **0.0000** | **+0.0044** | **89.5%** |

The effect shrinks monotonically as the queries become less hand-selected:
+0.0690 → +0.0417 → 0.0000. **The most defensible reading is that BM25's
advantage on this corpus is concentrated in cases that are hard for a
frequency-and-length-sensitive scorer, and that on ordinary questions over this
corpus the two retrievers are very nearly equivalent.**

### The two queries that move

- **r11-semaphore-wakeup** (production 3 → BM25 1). Production ranks the
  producer-consumer passage first, whose "signals that the buffer is not full"
  shares the verb; BM25 ranks the semaphore passage, which actually describes
  signal incrementing a counter and waking a blocked process. BM25's IDF
  discounts the more common token. A genuine and realistic win.
- **r06-page-replacement-cheap** (production 1 → BM25 2). The exact mirror. The
  question asks which policy is *cheapest*, BM25's length normalisation penalises
  the long passage that discusses four algorithms, and the short fragment about
  first-in-first-out wins. The same mechanism that earns r11 costs r06.

**One improved, one worsened.** That is not a trend; it is noise at this sample
size.

### Saturation: the target was missed and is reported, not fixed

A ≥25% unsaturated share was discussed as an authoring goal. **The frozen set
came out at 10.5%**, which misses it badly.

It is reported rather than corrected on purpose. A saturation *threshold* as a
passing test would create standing pressure to edit a frozen query set after
seeing results — the exact failure mode that destroys a holdout's value. The
census is printed by the measurement test and is not asserted against a target.

The honest conclusion is that **38 coverage-driven questions over a 40-chunk
corpus are simply not hard enough**. Ordinary questions about a passage that
directly contains the answer are easy for any lexical scorer, and writing them
without deliberately making them hard produces a saturated set. Reaching 25%
unsaturated would require either a much larger corpus, or questions with real
ambiguity — and authoring those is a different task from this one.

### Benchmark-quality problems found

1. **The holdout is more saturated than the set it replaced** (89.5% vs 87.5%),
   and far from the 25% target.
2. **Two queries, one win and one loss.** No effect size is measurable at this
   saturation.
3. **Both retrievers miss nothing and place nothing below rank 3**, so the set
   cannot probe recall or deep ranking failure at all.
4. **The independence gap is structural, not fixable in this process.** Three
   successive sets authored by the same process that has seen v2's results
   cannot become independent by being larger or differently worded.

### Reproducing

```bash
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest tests/unit/retrievalHoldoutV2.test.js --runInBand
```

No API key, network, Redis, MongoDB, or external service required.

### Where this leaves the retrieval question

Across four measurements now:

| Benchmark | Purpose | Verdict on BM25 |
| --- | --- | --- |
| v1 (frozen) | historical baseline | no difference (0 / 1 / 11) |
| v2 | constructed adversarial | +0.0690 H@1, +0.0460 MRR |
| holdout-v1 (exploratory) | hand-picked ordinary | +0.0417 H@1, +0.0208 MRR |
| holdout-v2 (coverage-driven) | systematic ordinary | **0.0000 H@1, +0.0044 MRR** |

**BM25 has not been shown to be better on ordinary retrieval over this corpus.
The only set where it clearly wins is the one built to catch the failure mode it
fixes.** That is a coherent and unsurprising result, and it is not a mandate to
integrate anything.

Two things would actually move this question, and neither is more questions from
this process:

- **A question author with no access to v1, v2, or these results.** That is the
  only thing that makes the next holdout genuinely independent.
- **A larger or more ambiguous corpus**, since 40 chunks over a single subject
  makes almost every reasonable question easy.

### Methodological note

A claim that labels are "independent of retriever output" is a *process*
property, not a testable property of an artifact. The tests here verify what is
mechanically checkable — no stored score or rank, unique ids, resolvable keys,
no query reuse, deterministic evaluation, identical inputs to both retrievers,
and the fixture's own non-independence disclaimer — and they deliberately do not
claim to verify the judgement behind a label. Saying otherwise in a test file
would be a fiction that future readers would rely on.

---

### Why this exists

v2's three BM25 wins are not independent evidence. They sit in cases that were
deliberately constructed to catch frequency over-weighting and length
insensitivity — the exact two properties BM25's IDF and length normalisation
exist to fix. A benchmark written by the same hand as the traps cannot establish
whether an advantage is general, and this repository's own rule for future
retrieval work demands a comparison that is reported rather than asserted.

So: 24 ordinary learner questions over the **same corpus**, authored from the
subject matter, frozen, and only then measured. Only the questions differ
between v2 and the holdout, which is what makes a difference in results
attributable to the question distribution.

**Independence protocol.** Read the frozen corpus → wrote the questions a
learner revising these notes would plausibly ask → adjudicated each label from
the subject matter → froze the fixture → *then* ran either retriever. No
ranking was inspected while choosing labels, no query was added or removed
because of a score, no parameter was tuned, the corpus was not modified.

**A test cannot prove a human adjudicated a label without seeing a ranking.**
That is a property of the authoring process, not of the artifact, and asserting
it in a test file would be fiction. What the tests *do* establish: the holdout
shares no query id and no query text with v1 or v2, no score or rank is stored
in the fixture, both retrievers receive byte-identical inputs, evaluation is
deterministic and does not mutate the corpus, and the three benchmarks are
reported separately rather than merged.

---

## Independent holdout — separately authored (Task 16C-B)

`backend/tests/fixtures/retrieval-gold-set-holdout-independent-v2.json`

**This is the only benchmark in this document whose questions were not written
by the process that built v2.** It is reported on its own, and its numbers are
never merged with any other set.

### Provenance: single clean claim

All 40 questions carry one provenance: authored from corpus-only material before
any retrieval evaluation, by a process that reports it was not given prior
retrieval rankings, BM25 results, local-hash results, previous benchmark
outcomes, the retrieval tests, the retrieval documentation, or any prior query
set. 36 came from the original authoring pass; the four covering `os-notes#1`,
`os-notes#9`, `os-notes#12` and `ds-notes#0` came from a **separate clean
authoring pass** given only `corpus-v2-only.json`, with no access to this file, to
any other benchmark, or to any retrieval result.

The fixture's question text, relevance labels and categories for those four are
reproduced **verbatim**; the only edit is a leading passage reference inside each
adjudication so each label is auditable against its passage. A test asserts that
wording, so it cannot be quietly "improved" for retrieval performance.

`provenanceNote` records that a process claim is not a verified fact: no test can
establish who saw what before authoring, because the only artifact available for
inspection is the file itself. The suite verifies structure only.

The set references the corpus **by version** (`corpusVersion: 2.0.0`) rather than
embedding a copy, so it is measured over exactly the 40 chunks v2 and the
Task 16C-R holdout used. All three are like for like.

### Structural audit — all checks pass

| Check | Result |
| --- | --- |
| Exactly 40 queries | PASS |
| 40 unique ids | PASS |
| 40 unique question texts | PASS |
| All relevance keys resolve against corpus v2 | PASS |
| No empty relevance sets | PASS |
| No `distractor-notes` passage labeled relevant | PASS |
| No stored score, rank or metric | PASS |
| All 34 answerable passages covered | PASS (34/34) |

**Exact text overlap: none.** Zero overlap against v1, v2, the exploratory
holdout, and the coverage holdout.

### Semantic convergence — the important caveat

Exact overlap is zero, but **convergence is high**, and this must not be read as
four new cases. Measured against the nearest earlier question in any benchmark:

| Clean question | Nearest earlier question | Content overlap | Same passage? |
| --- | --- | --- | --- |
| q042 PCB contents | v1/v2 `q02-process-control-block` | ~0.83 | yes |
| q043 counting semaphore | v1/v2 `q06-late-corpus-chunk` | ~0.50 | yes |
| q044 trap vs interrupt | v2 `q14-trap-vs-interrupt` | **~1.00** | yes |
| q045 hash collisions | coverage holdout `r35-hash-collisions` | ~0.31 | yes |

**q044 is effectively a re-run of v2's `q14`.** Its content words are identical
to that question; the only difference is a trailing clause, "in terms of what
causes them". q042 differs from v1 q02 by two words. q043 adds a genuinely new
angle by naming the wait and signal operations. q045 is the loosest at ~0.31.

This is **convergent reproduction, not contamination** — the clean author never
saw any of these. But it is also the most useful thing in this section: it
measures a fact about the corpus. Four passages, chosen only because they needed
coverage, each have essentially one obvious learner question, and an author given
only the text finds that same question. **A benchmark over this corpus cannot
manufacture many genuinely distinct questions per passage.**

So: the four questions carry clean provenance, and three of them add little new
retrieval evidence. They are kept because they are the honest outcome of the
process, not because they widen the measurement.

### Results

40 chunks, 40 queries, all answerable, limit 5.

| Metric | local-hash-v1 | BM25 | Delta |
| --- | --- | --- | --- |
| HitRate@1 | 0.9250 | 0.9750 | **+0.0500** |
| HitRate@3 | 1.0000 | 1.0000 | 0.0000 |
| HitRate@5 | 1.0000 | 1.0000 | 0.0000 |
| Precision@5 | 0.2000 | 0.2000 | 0.0000 |
| MRR | 0.9583 | 0.9875 | **+0.0292** |

| Census | Value |
| --- | --- |
| BM25 improved | 3 |
| BM25 worsened | **1** |
| Unchanged | 36 |
| Missed by both | 0 |
| Missed by BM25 only | 0 |
| Missed by local-hash only | 0 |
| Rank disagreements | 4 of 40 |
| Both rank 1 | 36 of 40 = 90.0% |

The figures are unchanged from the pre-repair measurement (+0.0500 / +0.0292, 3
wins, 1 loss), which is the expected outcome: the contaminated four and the clean
four ask semantically near-identical questions about the same four passages.
**What changed is the quality of the evidence, not the numbers** — the single
regression is now attributable to a question whose author had seen nothing, and
so it is a finding rather than an artifact.

### The four queries that move

| Query | local-hash | BM25 | Provenance |
| --- | ---: | ---: | --- |
| q003 four conditions for a deadlock | 2 | 1 | corpus-only |
| q016 Belady's anomaly and when it occurs | 3 | 1 | corpus-only |
| q025 why training/validation/test sets are separated | 2 | 1 | corpus-only |
| q044 trap vs interrupt, by cause | 1 | 2 | **clean pass** |

The three wins are all the same failure mode: the production retriever placing a
lexically adjacent, evidentially poorer passage first. That failure mode is
consistent across every benchmark in this document where BM25 gains anything.

**The q044 regression is a real, mechanistically explainable weakness in BM25.**
It ranks `distractor-notes#1` first at 8.396 against 7.306 for the correct
passage. That passage is the shortest index stub in the corpus — a bare list of
deadlock vocabulary with no explanation — and BM25's length normalisation
*rewards* it for being short, while its high IDF across many mid-frequency terms
lifts it above the passage that actually explains the distinction. The production
retriever gets this query right.

This is the second benchmark in a row where a short keyword-list stub outranks a
substantive passage, and it is the mirror image of the gains: **BM25's length
normalisation fixes frequency traps and creates short-stub traps.** Neither
retriever is free of the failure mode; they have opposite ones.

### What this does and does not show

It shows a repeatable ranking correction, on a benchmark whose questions were
largely authored by a process that had not seen any retrieval result, with no
production change and no semantic infrastructure.

It does not show BM25 is universally superior. The corpus is 40 chunks on one
subject area, so every set measured against it is saturated; the gains are three
queries; and no benchmark here measures the paraphrased, semantically-weak
questions that both retrievers still fail entirely. No production change is
authorized here and none is made.

### The result across all four benchmarks, reported separately

Never combined. Each is a different question about a different corpus or query
distribution.

| Benchmark | Author of its questions | Corpus | Queries | H@1 Δ | MRR Δ | Saturation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A. v1 (frozen) | same process, pre-v2 | 17 | 12 | 0.0000 | −0.0042 | 75% |
| B. v2 (constructed) | same process, post-hoc | 40 | 29 | +0.0690 | +0.0460 | 69% |
| C. holdout-v1 (exploratory) | same process, post-hoc | 40 | 24 | +0.0417 | +0.0208 | 87.5% |
| D. Task 16C-R holdout | same process, post-hoc | 40 | 38 | 0.0000 | +0.0044 | 89.5% |
| **E. independent holdout (final)** | **separate clean process** | **40** | **40** | **+0.0500** | **+0.0292** | **90.0%** |

**BM25 is better on four of the five sets and slightly worse on one.** On v1 it
regressed: MRR 0.8403 → 0.8361, with q09 falling from rank 4 to rank 5 and no
query improving. That is the one measurement in this document where BM25 loses,
and it is recorded here rather than smoothed over. The pattern across the rest
is consistent — v2 +0.0460 MRR, exploratory holdout +0.0208, coverage holdout
+0.0044, independent holdout +0.0292 — but v1's −0.0042 belongs in the same
summary as any other row.

The independent holdout went through a repair and re-freeze before this
measurement, and two things are worth recording about that process rather than
about BM25.

First, the repair made the result **weaker**, not stronger: an earlier version
showed +0.0417 MRR with 3 wins and no losses, and removing a duplicated question
plus three verbatim restatements of earlier benchmarks cost some of the apparent
advantage. That is what should happen when cases that were not new evidence are
removed.

Second, the four replacement questions were first authored by a process that had
already seen every retrieval result, which made the set mixed-provenance and
unusable as independent evidence. They were re-authored in a clean pass given only
the corpus. **Those four questions turned out to be semantically near-identical
to the questions they replaced** — most of them to questions v1 and v2 already
asked. The clean pass fixed the provenance and left the numbers unchanged, which
is the clearest evidence available that a good provenance claim and genuinely new
evidence are two different things.

**The consistency across sets is the strongest evidence in this document, and it
is still not a mandate to integrate.** Every set showing a gain is saturated or
nearly so, every gain is a handful of queries, and the pattern in all of them is
one specific failure mode. The honest summary:

> BM25 corrects a real and repeatedly observed weakness in the current retriever
> — its tendency to prefer a lexically adjacent, evidentially poor chunk over the
> passage that actually answers the question. On a corpus this small and this
> uniform, the two retrievers are otherwise close to equivalent, and no benchmark
> here measures whether that holds at realistic corpus size or on the paraphrased,
> semantically-weak queries that both still fail entirely.

Integration is not authorized by this, and no production recommendation is made
here. The blocking gaps are unchanged: the corpus is too small and too uniform to
discriminate, and a genuinely hard paraphrase set still has not been written by
anyone.

### Reproducing

```bash
env -u GROQ_API_KEY node --experimental-vm-modules \
  node_modules/.bin/jest tests/unit/retrievalIndependentHoldout.test.js --runInBand
```

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
