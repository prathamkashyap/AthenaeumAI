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

## 💾 Single Instance MongoDB Dependency
- **Limitation**: System operations assume a single-instance MongoDB connection.
- **Impact**: If MongoDB fails, crucial parts of the application (e.g. signup, login, dashboard retrieval, attempts saving) degrade.
