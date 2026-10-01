# Known Limitations

This document lists the architectural limitations of the current AthenaeumAI platform. These items serve as key triggers for downstream sprints.

---

## 🔍 Local Hash Vector Representation
- **Limitation**: The current embedding pipeline (`local-hash-v1`) relies on deterministic lexical hashes.
- **Impact**: It lacks semantic understanding (e.g., matching "process states" to "PCB layout" if wording is dissimilar). RAG results may exclude relevant chunks if there is zero keyword overlap.

---

## ⚡ Synchronous Document Indexing
- **Limitation**: PDF text parsing, chunking, hashing, and database writes execute synchronously within the Express route lifecycle.
- **Impact**: Heavy PDF uploads can cause HTTP request timeouts (e.g. if the PDF is 50+ pages) and degrade performance for concurrent users.

---

## ⚙️ Lack of Background Task Runners
- **Limitation**: Tasks like rebuilding the review queue, updating streaks, and calculating recommendation snapshots run in-process on Express routes.
- **Impact**: Server execution paths are blocked, leading to performance variance. There is no job retry or crash-handling queue.

---

## 🧠 Limited Tutor Context Memory
- **Limitation**: The RAG tutoring pipeline only injects prior misconceptions and immediate material chunks.
- **Impact**: There is no long-term chat session window memory. Subsequent user queries do not inherit conversational history.

---

## 🛡️ The Tutor Grounding Gate Detects Absent Evidence, Not Wrong Evidence
- **Limitation**: `tutorGrounding.js` makes an explicit grounding decision before the model is called, and refuses when retrieval produced **no evidence at all** — an empty result set, or a set in which every score is exactly zero. It cannot detect a *confidently retrieved wrong chunk*.
- **Why there is no numeric confidence threshold**: this was measured rather than assumed. Across three independent query sets over the frozen evaluation corpus, the production retriever's top-1 score for a query whose answer was **not** retrieved falls **entirely inside** the range of the top-1 score for a query whose answer **was** retrieved:

  | Top-1 combined score | Range |
  | --- | --- |
  | Correct answer retrieved | 0.168 – 0.611 |
  | Wrong answer retrieved | 0.136 – 0.507 |

  Sweeping every threshold from 0.00 to 0.65 in steps of 0.01, **no value both rejects every wrong case and keeps every correct one**. The highest threshold that rejects all wrong cases discards 20 of 37 correct ones. Lexical coverage and the top-1-minus-top-2 margin overlap the same way. A constant such as `0.35` would not be a calibration: it would reject most correctly-answered questions *and* still admit confidently-ranked wrong chunks, converting a visible failure into a silent one.
- **Impact**: the gate prevents the tutor from claiming to be grounded when it retrieved nothing, and it does so in code rather than by asking the model to use judgement. It does **not** raise answer quality on questions where retrieval returns a plausible-looking but wrong chunk. A question about the wrong topic can still be answered, still cited, and still be wrong — and it will pass this gate.
- **What would actually close it**: a retriever whose scores separate correct from incorrect retrieval, which the current one demonstrably does not; or a verification step after generation. The retrieval evaluation is the evidence for both claims.

---

## 📬 Background Work Can Be Committed To But Unscheduled
- **Limitation**: Durable application state is written and committed *before* its background job is scheduled. `POST /quiz/generate` commits the material and quiz, then enqueues `INDEX_MATERIAL`; `POST /quiz/:id/attempt` writes the attempt, then enqueues `SYNC_ATTEMPT`. If Redis is unavailable at that point, the commit has already succeeded and cannot be undone.
- **Current behaviour**: Since `829a226`/`Make queue failures truthful after commit`, a scheduling failure is no longer reported as a failure of the business operation. The endpoint returns **200** with its normal success payload plus an additive field:
  ```json
  "backgroundProcessing": { "status": "not_scheduled", "task": "INDEX_MATERIAL" }
  ```
  The success path is unchanged and carries no such field. Genuine failures before the commit — a database write, a missing quiz, an unavailable database, or any non-queue fault while scheduling — are still reported as failures.
- **Impact**: The response is truthful, but the background work genuinely has not run. Material indexing for an unscheduled job still recovers on read, and an unscheduled `SYNC_ATTEMPT` can now be re-run on demand by its owner (see the next section), but **neither happens automatically**: there is no transactional outbox, no automatic rescheduling, no reconciliation pass, and no HTTP idempotency key.
- **Known residual risk**: because there is no request-level idempotency, a client that retries after a scheduling failure will create a *second* quiz or a *second* attempt. `SYNC_ATTEMPT` remains safe against duplicate *processing* (`829a226` durable claim on `QuizAttempt._id`), but it cannot prevent duplicate *submission*. Closing this needs the explicit job-status/idempotency contract, not a change to the queue.

---

## 🔎 Background Job Status Is Tracked; Terminal Recovery Is Manual
- **What now exists**: background work that was already asynchronous (`INDEX_MATERIAL`, `SYNC_ATTEMPT`) is recorded in a `BackgroundJob` document and readable at `GET /api/v1/jobs/:id`, scoped to the authenticated learner. States are `pending → queued → running → completed | failed`, plus `not_scheduled` when the queue refused the work. A client can therefore tell the difference between work that is genuinely running and work that never started.
- **Ordering**: the job record is created *after* the business record is committed and *before* the enqueue is attempted, so a job is never reported as `queued` when Redis refused it. The record is deliberately **not** created inside the business transaction and **is not** a transactional outbox. The reason is this ordering, not a deployment limitation: both provisioned topologies are transaction-capable (`docker-compose.yml` runs `mongod --replSet rs0`, and CI initializes a single-node `rs0`), but a record written after the business row has committed cannot be rolled back with it.
- **Separation of state**: a `BackgroundJob` describes background processing only. It is never evidence that a `StudyMaterial`, `Quiz` or `QuizAttempt` exists, and it is not the correctness boundary for `SYNC_ATTEMPT` — the durable claim on `QuizAttempt.sync` inside the business transaction remains that boundary.
- **Retry added**: the record is no longer only visible. `POST /api/v1/jobs/:id/retry` re-runs a terminal `SYNC_ATTEMPT` for its owner. It is scoped by user, accepts no resource identifiers from the caller (the payload is rebuilt from the stored job), and retries the *existing* `BackgroundJob` record rather than creating a second tracking row. The retry reuses the same durable claim, so re-running a still-pending attempt applies it exactly once and re-running an already-applied attempt applies nothing further. The result page offers this as a primary action for `failed` and `not_scheduled`.
- **Still missing**: recovery is **user-triggered, not automatic**. Nothing re-enqueues a terminal job on its own, there is no reconciliation pass, and no outbox would recover a job whose process died between the commit and the enqueue. `INDEX_MATERIAL` is deliberately not retryable here — it self-heals on read through `ensureChunksForUser` — and `REBUILD_REVIEW_QUEUE` is recomputable and carries no `BackgroundJob` record at all. Retention is a 30-day TTL on `completedAt`, so a job that never resolves is retained indefinitely rather than silently dropped, and a job that has already aged out can no longer be retried by id.
- **Residual risk unchanged**: client-driven duplicate submission is still possible, because there is no HTTP idempotency key.

---

## 🧱 Transaction-Capable MongoDB Is Required
- **Limitation**: multi-document transactions need a replica set or a sharded cluster. A plain standalone `mongod` cannot run them, whatever the connection string says.
- **Why it is mandatory**: `POST /api/v1/quiz/generate` writes the `StudyMaterial` and its `Quiz` inside one transaction, and `SYNC_ATTEMPT` claims the attempt and applies the learner effects in one transaction so the durable claim and its effects commit together or not at all. Those guarantees do not survive being written without the transaction, so there is deliberately no fallback path.
- **Detection**: the connected deployment is asked what it is, at `connectDB` time, by running `hello` and reading `setName` (replica set) or `msg: "isdbgrid"` (sharded cluster). The answer is never inferred from the URI, because a URI can carry `?replicaSet=rs0` while the server behind it is a standalone. It is reported as `supported`, `unsupported` or `unknown`; `unknown` means unprobed, not incapable, so an inconclusive probe never disables transaction paths.
- **Behaviour on a standalone deployment**: the transaction-backed operations are refused with a `503` `DatabaseError` before a session is opened, and `GET /api/v1/health` reports `degraded` with `database.transactions: "unsupported"`. `GET /api/v1/health/ready` still returns `200 ready`, because every path that does not need a transaction remains usable and the worker depends on that endpoint; the capability is disclosed alongside `ready` so the two are not confused. Before this was explicit, the caller instead saw HTTP 500 with *"This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string"* — advice that does not work, since `retryWrites=false` does not make a standalone server able to transact.
- **Supported deployment**: the `docker-compose.yml` stack runs MongoDB as a single-node replica set (`rs0`, initialised by the `mongo-init` service), so the intended deployment satisfies this. A developer running a bare `mongod` on `27017` cannot generate a quiz or sync attempts.

---

## 💾 Single Instance MongoDB Dependency
- **Limitation**: System operations assume a single-instance MongoDB connection.
- **Impact**: If MongoDB fails, crucial parts of the application (e.g. signup, login, dashboard retrieval, attempts saving) degrade.
