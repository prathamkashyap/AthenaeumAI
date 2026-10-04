# Known Limitations

This document records the boundaries of the current AthenaeumAI platform: what it does not do yet, and where a deliberate design decision is carrying a known cost.

These are **limitations and deferred work, not defects in the shipped system**. Where something is deferred on purpose, the reasoning is given rather than implied. Where a claim was measured rather than assumed, the measurement is stated so it can be re-checked.

Everything below was verified against the code on `main` (`9bc6029`) during the documentation truth pass.

---

## Summary

| Area | Status |
| :--- | :--- |
| Retrieval semantics | Lexical baseline by design; semantic retrieval deferred pending evidence |
| Generation latency | Real user-visible wait; first roadmap item |
| Grounding gate | Detects absent evidence, not wrong evidence; measured, no viable threshold |
| Background scheduling | Committed before enqueued; truthful response, no automatic recovery |
| Attempt idempotency | No HTTP-level key; duplicate submission possible |
| Snooze durability | Preserved for failed questions, deliberately not for topic items |
| Review queue identity | `due_flashcard` ↔ `overdue_review` crossing can duplicate a card |
| Tutor memory | Interaction audit log only; no conversational context |
| Transactions | Require a replica set; probed and refused explicitly otherwise |
| Theme control | Public routes honour the stored theme but expose no toggle |
| Security / observability / performance | Post-launch contract work, not yet started |

---

## Retrieval is a lexical baseline

- **What ships**: `local-hash-v1`. Text is tokenised, stop words removed, each token hashed with FNV-1a into one of 384 dimensions with a sign bit, L2-normalised, and compared by cosine similarity. The result is blended with a lexical keyword-overlap score at `0.78 · vector + 0.22 · lexical`.
- **Limitation**: every component is lexical. There is no learned embedding model and no vector database, so semantically equivalent phrasings with low keyword overlap score near zero. A question about "process states" will not reliably retrieve a chunk that only says "PCB layout".
- **Why it is still here**: the baseline is measured before it is replaced. `docs/RETRIEVAL_EVALUATION.md` records the evaluation that justifies the current retriever, and `bm25Retriever.js` exists as a comparison arm — it is imported only by tests and is **not** the active retriever.
- **What would change it**: sentence-transformer embeddings plus a vector store, adopted on evidence that the lexical baseline has plateaued, not on the assumption that embeddings are better in general.

---

## Generation latency on the current reasoning model

- **What ships**: `POST /quiz/generate` is **synchronous**. It calls the provider inline and returns the finished quiz. It is not queued.
- **Limitation**: every model currently reachable on the configured Groq key is a reasoning model, so it spends part of its token budget reasoning before answering. Measured end to end, a five-question quiz takes **117–244s**. This is a real wait on the primary user action.
- **Scope of the timeout**: `AI_COMPLETION_TIMEOUT_MS` is `30_000` and is applied **per provider call**. Generation issues up to three sequential calls (first, middle and last chunk of the extracted text), so no single call trips the timeout while the total is minutes. The tutor is unaffected in practice (~7s).
- **What would change it**: streaming or partially-generated quizzes, so earlier questions are usable while later ones are still being written.

---

## The grounding gate detects absent evidence, not wrong evidence

- **What ships**: `tutorGrounding.js` makes an explicit grounding decision **before** the model is called, and refuses when retrieval produced no evidence at all — an empty result set, or one in which every score is exactly zero.
- **Limitation**: it cannot detect a *confidently retrieved wrong chunk*. A question about the wrong topic can still be answered, still cited, and still be wrong, and it passes this gate.
- **Why there is no numeric confidence threshold**: this was measured, not assumed. Across three independent query sets over the frozen evaluation corpus, the production retriever's top-1 score for a query whose answer was **not** retrieved falls entirely inside the range for a query whose answer **was** retrieved:

  | Top-1 combined score | Range |
  | --- | --- |
  | Correct answer retrieved | 0.168 – 0.611 |
  | Wrong answer retrieved | 0.136 – 0.507 |

  Sweeping every threshold from 0.00 to 0.65 in steps of 0.01, **no value both rejects every wrong case and keeps every correct one**. The highest threshold rejecting all wrong cases discards 20 of 37 correct ones. Lexical coverage and the top-1-minus-top-2 margin overlap the same way. A constant such as `0.35` would not be a calibration: it would reject most correctly-answered questions *and* still admit confidently-ranked wrong chunks, converting a visible failure into a silent one.
- **What the gate is worth**: it prevents the tutor claiming to be grounded when it retrieved nothing, in code rather than by asking the model to use judgement. It does not raise answer quality where retrieval returns a plausible-but-wrong chunk.
- **What would actually close it**: a retriever whose scores separate correct from incorrect retrieval, which this one demonstrably does not; or a verification step after generation.

---

## Background work can be committed to but unscheduled

- **What ships**: durable state is written and committed **before** its background job is scheduled. `POST /quiz/generate` commits material and quiz, then enqueues `INDEX_MATERIAL`; `POST /quiz/:id/attempt` writes the attempt, then enqueues `SYNC_ATTEMPT`.
- **Current behaviour**: a scheduling failure is no longer reported as a failure of the business operation. The endpoint returns **200** with its normal payload plus an additive field:

  ```json
  "backgroundProcessing": { "status": "not_scheduled", "task": "INDEX_MATERIAL" }
  ```

  The success path carries no such field. Genuine failures before the commit — a database write, a missing quiz, an unavailable database, or any non-queue fault while scheduling — are still reported as failures.
- **Limitation**: the response is truthful, but the background work genuinely has not run. `INDEX_MATERIAL` self-heals on read through `ensureChunksForUser`, and an unscheduled `SYNC_ATTEMPT` can be re-run on demand, but **neither happens automatically**: there is no transactional outbox, no automatic rescheduling, and no reconciliation pass.
- **Job status is tracked, terminal recovery is manual**: background work already asynchronous is recorded in a `BackgroundJob` document, readable at `GET /api/v1/jobs/:id` scoped to the authenticated learner, with states `pending → queued → running → completed | failed` plus `not_scheduled`. `POST /api/v1/jobs/:id/retry` re-runs a terminal `SYNC_ATTEMPT` for its owner, rebuilding the payload from the stored job and reusing the same durable claim, so a still-pending attempt applies exactly once and an already-applied attempt applies nothing further. The record is deliberately **not** created inside the business transaction and is not an outbox — a row written after the business row has committed cannot be rolled back with it. Retention is a 30-day TTL on `completedAt`, so an unresolved job is retained indefinitely rather than silently dropped, and a job that has aged out can no longer be retried by id.
- **A `BackgroundJob` describes background processing only.** It is never evidence that a `StudyMaterial`, `Quiz` or `QuizAttempt` exists, and it is not the correctness boundary for `SYNC_ATTEMPT` — the durable claim on `QuizAttempt.sync` inside the business transaction is.

---

## No HTTP-level idempotency on attempt submission

- **Limitation**: there is no idempotency key on `POST /quiz/:id/attempt`. A client that retries after a scheduling failure, a timeout or a double tap will create a **second** attempt.
- **What does protect against this**: `SYNC_ATTEMPT` is safe against duplicate *processing*. A durable claim on `QuizAttempt._id`, taken inside the business transaction, means a redelivered job applies learner effects exactly once.
- **Consequence**: duplicate *submission* is still possible. The guarantee is on processing, not on submission.
- **What would close it**: an explicit idempotency-key contract on the write endpoints, paired with the transactional outbox above. Not a change to the queue.

---

## Topic-item snoozes are reset by a review-queue rebuild

- **What ships**: `POST /api/v1/review-queue/:id/snooze` is a single atomic `findOneAndUpdate` — there is no read-then-write window.
- **Limitation**: durability differs by item type, deliberately. A `failed_question` item's `dueAt` is protected during a rebuild by `$max`/`$min` inside the same write, so the later date wins and a snooze survives a replay. A **topic** item's `dueAt` (`weak_topic`, `low_confidence_topic`) is recomputed from learner progress on every rebuild and **is overwritten**, so a topic snooze does not survive one.
- **Why**: a topic's due date is derived from current progress, so letting a stale snooze pin it would freeze a schedule that should track the learner. Only a failed question is snoozed by the learner and has no scheduler behind it.
- **What would change it**: a per-item snooze that survives recomputation — for example storing the snooze separately from the derived `dueAt` — if product behaviour ever requires topic snoozes to be durable.

---

## `due_flashcard` ↔ `overdue_review` can duplicate a flashcard

- **What ships**: on rebuild, a flashcard's `itemType` is computed from how overdue it is — `overdue_review` at one day or more, otherwise `due_flashcard`. `itemType` is part of both the upsert filter and the unique index.
- **Limitation**: when a card crosses the one-day boundary its computed `itemType` changes, so the rebuild's identifying lookup no longer matches the existing row and **inserts a second one**. The service contains no delete or cleanup of superseded rows, so the previously-inserted `due_flashcard` row remains. A single card can therefore appear twice in the review queue — once stale under the old type, once current under the new.
- **Scope**: affects the queue only. The card's own SM-2 schedule in `FlashcardSet` is unaffected, and the two rows refer to the same `source.flashcardId`.
- **What would close it**: derive the item type from something stable rather than from a moving threshold — for example keying the row on the card and storing "overdue" as a computed property — or reconciling superseded rows on rebuild.

---

## Tutor has no conversational memory

- **What ships**: each tutor query retrieves fresh and answers from retrieved context alone. `tutorService.js` holds no message history and no turn window.
- **`GET /api/v1/tutor/history` is not session memory.** It reconstructs an audit log from `LearningEvent` records with `eventType: "ai_tutoring_interaction"`, returning topic, question, result and timestamp. It records what was asked; the model cannot recall it. Follow-up questions do not inherit earlier turns.
- **Limitation**: a learner must restate context that a conversational product would carry forward.
- **What would change it**: persisting turns and injecting a bounded window, if the product value justifies the storage and the grounding cost of a longer prompt.

---

## Transactions require a replica set or sharded cluster

- **Limitation**: multi-document transactions need a replica set or a sharded cluster. A standalone `mongod` cannot run them whatever the connection string says.
- **Why it is mandatory**: `POST /quiz/generate` writes `StudyMaterial` and its `Quiz` in one transaction, and `SYNC_ATTEMPT` claims the attempt and applies learner effects in one transaction so the durable claim and its effects commit together or not at all. Those guarantees do not survive being written without the transaction, so there is deliberately no fallback path.
- **Detection**: the connected deployment is asked what it is, at `connectDB` time, by running `hello` and reading `setName` or `msg: "isdbgrid"`. The answer is never inferred from the URI, because a URI can carry `?replicaSet=rs0` while the server behind it is standalone. It is reported as `supported`, `unsupported` or `unknown`; `unknown` means unprobed, not incapable, so an inconclusive probe never disables transaction paths.
- **Behaviour on a standalone deployment**: transaction-backed operations refuse with a `503` `DatabaseError` before a session is opened, and `GET /api/v1/health` reports `degraded` with `database.transactions: "unsupported"`. `GET /api/v1/health/ready` still returns `200 ready`, because every path that does not need a transaction stays usable and the worker depends on that endpoint; the capability is disclosed alongside `ready` so the two are not confused.
- **Satisfied by**: the Compose stack runs MongoDB as a single-node replica set (`rs0`), and production uses Atlas M0, which supports transactions.

---

## Theme control is not exposed on public routes

- **What ships**: the persisted theme preference is applied at application boot, before the first render, on **every** route — the landing page, `/auth` and `/dashboard` all honour `athenaeum-theme`. The value, storage key, cycle order and normalisation of a stale stored value are unchanged, and this is centralised in one module rather than duplicated.
- **Limitation**: the landing page and auth screen expose **no theme toggle**. Switching remains available in the authenticated shell. A visitor who arrives on a public route with no prior preference stays on the default until they sign in.
- **This is not an initialisation defect.** Theme initialisation on public routes was fixed; the remaining gap is only the absence of a control on those two surfaces.
- **Why it is minor**: the public routes are a marketing and entry surface, the preference is honoured wherever the user has expressed one, and adding a second toggle control is a design decision rather than a correctness fix.

---

## Single-instance MongoDB dependency

- **Limitation**: system operations assume a single-instance MongoDB connection.
- **Impact**: if MongoDB is unavailable, signup, login, dashboard retrieval and attempt saving degrade together. There is no partial-availability design, because the transaction-dependent paths have no non-transactional fallback by intent.

---

## Security, observability and performance are not yet a contract

- **Status**: post-launch roadmap work, **not implemented**. Stated here so it is not mistaken for a completed capability.
- **Not yet in place**: per-route rate-limit and payload budgets as a documented contract; structured audit logging beyond Winston request logs; latency and error instrumentation with dashboards; load testing and capacity limits; alerting.
- **What does exist today**: rate limiting on auth and AI routes, Zod validation on request bodies and params, Helmet-style security headers, a CORS allowlist that is required in production, hashed refresh tokens with rotation and reuse detection, and job status scoped to the authenticated owner.
- **What would change it**: agreeing and writing down the contract first, then implementing against it.

---

## Not limitations — deliberate decisions, recorded so they are not mistaken for gaps

- **`REBUILD_REVIEW_QUEUE` has no route trigger.** The worker handles it and it is exercised in tests, but no controller currently enqueues it. The review queue is otherwise built and read synchronously on demand.
- **Mistake analysis runs inline.** It is part of the attempt request, not a background job, and is not slow enough to need queueing.
- **Achievements are rule-based.** They unlock from recorded events rather than being inferred, so the profile can show a truthful empty state instead of a flattering score.
- **`BM25` is implemented but inactive.** It exists as an evaluation arm for a future retrieval decision and is imported only by tests.
