# Claim status

What this system actually does, verified against branch `improve/athenaeum-foundation` at commit
`ddb2bba`. Each claim below names the code that backs it. Claims we cannot back are listed under
**Not implemented** or **Known limitations** rather than softened.

Measured test and coverage figures live in [`TESTING_INVENTORY.md`](./TESTING_INVENTORY.md).

## The learning loop

```
quiz submission
      ↓
LearningEvent rows          backend/services/learningEventService.js
      ↓
mastery / weakness          backend/services/progressService.js
      ↓
priority                    backend/services/reviewQueueService.js
      ↓
review queue items          backend/models/ReviewQueue.js
      ↓
scheduled flashcards         backend/services/flashcardService.js
```

**Implemented.** Attempt submission writes learning events and recomputes progress. Weak topics and
failed questions become open review-queue items with a priority. Flashcards are scheduled with
SM-2 spacing and re-enter the review queue when they fall due.

Review-queue identity is per question, not per attempt. `ReviewQueue.questionIndex` is a nullable
top-level field, and the open-item unique index covers `(user, itemType, topic, source.quiz,
source.attempt, source.flashcardSet, source.flashcardId, questionIndex)` with
`partialFilterExpression: { status: "open" }`. One missed question is one review item. The field is
deliberately nullable rather than defaulting to `0`, because a `0` default would let topic and
flashcard items collide on a fabricated question zero.

`failed_question` items require `source.attempt` and are rejected with a 422 if it is missing,
rather than being allowed to collapse to `null` in the index.

Replaying an attempt is safe. Upserts are keyed on the fields the item actually owns, so a replay
cannot erase a `source.flashcardSet` link added later. Rows written before `questionIndex` existed
are adopted by matching on `metadata.questionIndex` instead of being duplicated.

Snoozing survives replay: `dueAt` and `priority` ride in `$max`/`$min` for attempt-scoped items
rather than `$set`.

## Reliability

**Implemented.**

- **Durable attempt processing.** `backend/worker.js` claims an attempt inside
  `runInTransaction` before applying progress writes, so a partial failure rolls the claim back
  with the work. A redelivery whose claim already committed reapplies nothing.
- **Idempotent replay.** Every queue write is an upsert. Re-running converges rather than
  duplicating.
- **Terminal retry semantics.** Background jobs retry on a bounded exponential backoff and then
  land in a terminal state that a learner can observe and retry, rather than vanishing.
- **Honest failure.** A failed attempt save surfaces the error and blocks navigation to a result
  that does not exist.
- **Offline AI seam.** `backend/services/aiProvider.js` owns the `{ complete, stream }` interface
  and the timeouts; `setAIProvider` / `getAIProvider` / `resetAIProvider` allow injection.
  `backend/services/groqProvider.js` is the only module that imports `groq-sdk`. Nine unit suites
  inject `backend/tests/mocks/mockAIProvider.js` through it, so AI code is exercised with no
  credential and no network.

**Not implemented.** No distributed tracing, no dead-letter queue with manual replay tooling, no
metrics export. Jobs are retried and retained as failed records; there is no admin surface for
replaying them.

## Grounded AI

**Implemented.**

`backend/services/tutorGrounding.js` decides whether to answer *before* the model is consulted, on
both the streaming and non-streaming tutor paths. It refuses when retrieval returned nothing
(`no_context`) or when every returned score is exactly `0` (`no_lexical_evidence`). Any non-zero
score counts as evidence. A refusal is returned without calling the model, recorded as
`insufficient_context` on the learning event, and emitted as a single JSON frame on the SSE path so
the streaming contract does not change.

Refusal telemetry is wrapped so an analytics failure cannot turn a correct refusal into a 500.

There is deliberately **no numeric confidence threshold**. Measured score distributions do not
support one: correct top-1 scores span `0.168–0.611` and wrong top-1 scores span `0.136–0.507`, so
no threshold in `0.00–0.65` rejects the wrong cases without discarding roughly half the correct
ones. The gate separates *no evidence* from *some evidence*; it does not separate *right* evidence
from *wrong* evidence.

## Retrieval

**Implemented, lexical, and measured.**

`local-hash-v1` in `backend/services/embeddingService.js` is the only retrieval path in production.
It is evaluated against six labelled fixtures by seven unit suites. On three independent holdout
sets it reaches HitRate@1 `0.9167–0.9250` with HitRate@3 and HitRate@5 at `1.0000` and MRR
`0.9474–0.9583`. Full tables and methodology are in
[`TESTING_INVENTORY.md`](./TESTING_INVENTORY.md#measured-retrieval).

`backend/services/bm25Retriever.js` is an independently implemented BM25 scorer kept strictly as an
evaluation candidate — no production module imports it. It currently scores **higher** than
production on HitRate@1 and MRR. That is recorded, not adopted.

**Not implemented.** There is no semantic or vector retrieval, and no embedding model. The name
`generateEmbedding` in the service refers to a lexical hashing embedding, not a neural one. Adding
semantic retrieval needs a measured justification against this baseline, which is exactly what the
gold-set harness exists to provide.

Latency is not measured.

## Database migrations

`backend/scripts/syncIndexes.js`, run as `npm run indexes:sync`, reconciles the open-item unique
index. Any deployment whose database predates `questionIndex` must run it once; Mongoose's default
`autoIndex` will not widen an existing index, and a stale coarse index will reject the per-question
rows the new code writes.

## Known limitations

Recorded so they are not discovered in production.

1. **A flashcard can hold two open review items across the overdue boundary.**
   `due_flashcard` and `overdue_review` are two distinct `itemType` values
   (`backend/models/ReviewQueue.js:13`), chosen at `reviewQueueService.js:257` by whether the card
   is at least one day past due. Because `itemType` participates in the open-item unique index, a
   card that crosses that boundary while its first item is still open yields **two** open rows for
   one card. They are separate items in Today's Review rather than one.

   The obvious fix — dropping `itemType` from flashcard identity — is not a local change. It
   affects topic transitions, the migration of existing rows, and the duplicate-collapse semantics
   of the legacy-adoption path, and it has no agreed product answer for how a card that is both due
   and overdue should be represented. Deliberately deferred.

2. **Topic-item snooze uses read-before-write, so it is not atomic.**
   `rebuildReviewQueueForUser` reads the stored row to decide whether it is snoozed, then writes. A
   snooze landing in that narrow interval is overwritten by the rebuild. The current learner UI only
   snoozes failed questions, which take the `$max`/`$min` path and are unaffected. Exposed only if
   topic snoozing is shipped.

3. **No latency budget** is enforced for retrieval or for background jobs.

4. **`recommendationService.js` has no direct test** — 0 of 15 functions covered.

5. **Lint is not a CI gate.** It is clean locally; nothing stops it regressing.

6. **The tutor chat flow has no browser-level spec.** Component suites cover the UI and the
   refusal contract, but a grounded answer against real indexed material is verified by the
   post-deployment smoke test.

## Documentation map

| Document | What it holds |
|---|---|
| [`TESTING_INVENTORY.md`](./TESTING_INVENTORY.md) | Measured suites, coverage, retrieval metrics, CI behaviour, gaps |
| [`RETRIEVAL_EVALUATION.md`](./RETRIEVAL_EVALUATION.md) | Retrieval protocol and per-query evaluation |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System structure |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release history |
