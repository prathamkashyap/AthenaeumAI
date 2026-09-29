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

## 📬 Background Work Can Be Committed To But Unscheduled
- **Limitation**: Durable application state is written and committed *before* its background job is scheduled. `POST /quiz/generate` commits the material and quiz, then enqueues `INDEX_MATERIAL`; `POST /quiz/:id/attempt` writes the attempt, then enqueues `SYNC_ATTEMPT`. If Redis is unavailable at that point, the commit has already succeeded and cannot be undone.
- **Current behaviour**: Since `829a226`/`Make queue failures truthful after commit`, a scheduling failure is no longer reported as a failure of the business operation. The endpoint returns **200** with its normal success payload plus an additive field:
  ```json
  "backgroundProcessing": { "status": "not_scheduled", "task": "INDEX_MATERIAL" }
  ```
  The success path is unchanged and carries no such field. Genuine failures before the commit — a database write, a missing quiz, an unavailable database, or any non-queue fault while scheduling — are still reported as failures.
- **Impact**: The response is truthful, but the background work genuinely has not run. Material indexing for an unscheduled job, and learner analytics/review-queue rebuild for an unscheduled attempt, require **operational recovery that is not yet automated**. There is no job-status endpoint, no transactional outbox, no automatic rescheduling, and no HTTP idempotency key.
- **Known residual risk**: because there is no request-level idempotency, a client that retries after a scheduling failure will create a *second* quiz or a *second* attempt. `SYNC_ATTEMPT` remains safe against duplicate *processing* (`829a226` durable claim on `QuizAttempt._id`), but it cannot prevent duplicate *submission*. Closing this needs the explicit job-status/idempotency contract, not a change to the queue.

---

## 🔎 Background Job Status Is Tracked, Not Recovered
- **What now exists**: background work that was already asynchronous (`INDEX_MATERIAL`, `SYNC_ATTEMPT`) is recorded in a `BackgroundJob` document and readable at `GET /api/v1/jobs/:id`, scoped to the authenticated learner. States are `pending → queued → running → completed | failed`, plus `not_scheduled` when the queue refused the work. A client can therefore tell the difference between work that is genuinely running and work that never started.
- **Ordering**: the job record is created *after* the business record is committed and *before* the enqueue is attempted, so a job is never reported as `queued` when Redis refused it. The record is deliberately **not** created inside the business transaction and **is not** a transactional outbox: this repository's Mongo deployment is a standalone outside a replica set, so transactions are unavailable there.
- **Separation of state**: a `BackgroundJob` describes background processing only. It is never evidence that a `StudyMaterial`, `Quiz` or `QuizAttempt` exists, and it is not the correctness boundary for `SYNC_ATTEMPT` — the durable claim on `QuizAttempt.sync` inside the business transaction remains that boundary.
- **Still missing**: the record makes a lost job *visible*; it does not make it *recoverable*. Nothing re-enqueues a `not_scheduled` or `failed` job, there is no operator endpoint to retry one, and no reconciliation pass exists. Retention is a 30-day TTL on `completedAt`, so a job that never resolves is retained indefinitely rather than silently dropped.
- **Residual risk unchanged**: client-driven duplicate submission is still possible, because there is no HTTP idempotency key.

---

## 💾 Single Instance MongoDB Dependency
- **Limitation**: System operations assume a single-instance MongoDB connection.
- **Impact**: If MongoDB fails, crucial parts of the application (e.g. signup, login, dashboard retrieval, attempts saving) degrade.
