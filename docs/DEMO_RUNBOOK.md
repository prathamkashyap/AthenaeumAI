# AthenaeumAI Demo Runbook

**Purpose.** One small, reproducible walkthrough of the current AthenaeumAI product flow,
anchored to a single committed study-material fixture. Use it to re-establish the baseline
before and after each foundation-rework change, and to compare behaviour across tasks.

**Fixture**

| | |
| :--- | :--- |
| Path | `backend/tests/fixtures/demo-material.pdf` |
| Subject | Operating Systems — Process Management |
| Pages / size | 2 pages, ~4 KB |
| SHA-256 | `14d9ec16e8aeaf8e58beb66ea3cfc2ce9150cf27250ce248c802bd4832573141` |
| Extracted text | 7,454 characters, 1,266 words, pure ASCII |
| Indexed chunks | 5 (see *Expected observations*) |

The same file is used for every rework task. Do not regenerate or edit it. If its hash ever
differs from the value above, treat that as a change to the baseline, not as a local
difference.

Verify the fixture before starting:

```bash
shasum -a 256 backend/tests/fixtures/demo-material.pdf
```

---

## 1. Prerequisites

Two configurations are supported. Pick one; do not mix them.

### Option A — Docker Compose (recommended)

Requires Docker and Docker Compose. Nothing else.

`docker-compose.yml` defines six services: `mongodb`, `mongo-init`, `redis`, `backend`,
`worker`, `frontend`. `mongo-init` initialises the single-node replica set `rs0`, because
`POST /api/v1/quiz/generate` writes the material and the quiz inside a MongoDB transaction
and transactions require a replica set.

The only manual step is providing a real Groq key, because the compose `env_file` is
`./backend/.env` (see Option B).

### Option B — local processes

| Component | Requirement | Notes |
| :--- | :--- | :--- |
| Node.js | 20 or newer | Matches the `node:20-alpine` base images. |
| MongoDB | **Required.** Must be a replica set. | `runInTransaction` aborts without one, so quiz generation fails. `docker-compose.yml` uses `mongo:6.0` with `--replSet rs0`. |
| Redis | **Required** for real background-job execution. | Consumed by the BullMQ worker. Not needed by the frontend. |
| Groq API key | **Required for live quiz generation.** | See the warning below. |
| Docker | Not required in this option. | |

**The Groq API key is not optional for a live demo.** Quiz generation, mistake analysis,
flashcard generation, and the AI tutor all call the live Groq API with the hard-coded model
`llama-3.3-70b-versatile`. There is no mock provider, no offline stub, and no provider seam
in the current code. Any step in this runbook that generates a quiz, analyses a mistake
attempt, or answers a tutor question **will fail without a working key**. Nothing else in
this runbook needs a key.

Create `backend/.env` from the committed template and fill it in:

```bash
cp backend/.env.example backend/.env
```

Required keys, per `backend/config/env.js`:

| Key | Example | Used by |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | `gsk_…` | quiz generation, mistake analysis, flashcards, tutor |
| `MONGODB_URI` | `mongodb://localhost:27017/athenaeumAI?replicaSet=rs0` | all persistence |
| `JWT_SECRET` | any string of 8+ characters | session tokens |
| `PORT` | `3001` (default) | API listen port |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | BullMQ |

`backend/config/env.js` exits the process at startup if `GROQ_API_KEY`, `MONGODB_URI`, or
`JWT_SECRET` is missing or empty, so a misconfigured environment fails fast and visibly.

The frontend needs to know where the API is. It reads `VITE_API_ROOT` (then `VITE_API_URL`),
falling back to a compiled-in default in `src/lib/api.ts`. **Set it explicitly** so the
runbook does not depend on which default that file currently carries:

```bash
# local processes, backend on the default port
export VITE_API_ROOT=http://localhost:3001/api/v1

# Docker Compose, using the host port the compose file publishes
export VITE_API_ROOT=http://localhost:5001/api/v1
```

Confirm the compose host port before using the second form:

```bash
docker compose ps   # read the published port for the "backend" service
```

---

## 2. Startup

### Option A — Docker Compose

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f worker
```

Expect all six services healthy. `mongo-init` exits `0` by design; a completed `Exited (0)`
for that service is success, not failure.

The API is published on the host at `${BACKEND_HOST_PORT:-5001}`; the frontend at `8081`.
Both defaults are overridable — see `docker-compose.yml`.

### Option B — local processes

Three terminals, from the repository root.

```bash
# 1 — API server
cd backend && npm run dev

# 2 — background worker  (mandatory; see Troubleshooting)
node backend/worker.js

# 3 — frontend
npm run dev
```

`node backend/worker.js` has no `npm` script. It must be started explicitly; `npm run dev`
in `backend/` starts only the API.

### Readiness checks

```bash
curl -s http://localhost:3001/api/v1/health        | head -c 400
curl -s http://localhost:3001/api/v1/health/ready
```

`/health/ready` returns `{"status":"ready"}` with HTTP 200 only once MongoDB is connected. In
`/health`, `services.bullMQ` reports the live job counts — remember those numbers, they are
how you confirm background work in step 9.

Frontend: open the URL Vite prints (default `http://localhost:5173` locally, `http://localhost:8081`
under Compose).

---

## 3. Demo flow

> **Read this before step 3.** There is no upload-only endpoint. `POST /api/v1/quiz/generate`
> accepts the PDF, extracts its text, generates the quiz, and stores both documents in a
> single request. Steps 3 and 4 below are therefore one action in the current implementation,
> and the request does not return until extraction *and* generation have finished.

### Step 1 — Start the application stack

Done in section 2. Do not continue until `/health/ready` returns `ready` and the worker
container is healthy.

### Step 2 — Create a demo user

In the browser, open `/auth`, choose **Signup**, and register with any unused email and a
password of at least 8 characters. You are redirected to the dashboard at `/`.

Note the session token key in browser storage: `athenaeum_token` (`src/lib/api.ts:7`). You
will need it for the `curl` calls in the optional API-only variants below.

### Step 3 + 4 — Upload the demo PDF and generate a quiz

In the browser, open `/assessments/create`.

1. Choose difficulty **Easy** and question count **5**.
2. Attach `backend/tests/fixtures/demo-material.pdf`. The picker accepts `application/pdf`
   only, up to 10 MB.
3. Submit. **Time the request.**

The request performs all of the following before responding, in this order:

```
multer writes the file to backend/uploads/
  → extractTextFromPDF          blocking fs.readFileSync + PDF parse
  → generateQuizFromAI          3 sequential Groq calls (chunked source text)
  → MongoDB transaction         StudyMaterial + Quiz written together
  → enqueue INDEX_MATERIAL     (awaited, then the response is sent)
  → HTTP 200 with the full quiz
```

So the browser stays on the generating screen for the whole extraction and generation
window. Expect several seconds, bounded by Groq latency, not by the file size.

Optional API-only equivalent. Set `TOKEN` to the `athenaeum_token` value from browser
storage (developer console → `localStorage`):

```bash
export TOKEN='<paste athenaeum_token here>'

curl -s -X POST http://localhost:3001/api/v1/quiz/generate \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@backend/tests/fixtures/demo-material.pdf;type=application/pdf" \
  -F "difficulty=Easy" \
  -F "count=5"
```

The response contains `quizId`, `materialId`, `title`, `questionCount`, and `questions`. Keep
`quizId` — step 5 needs it.

### Step 5 — Complete the attempt with at least one wrong answer

In the browser, open `/assessments/<quizId>`. Answer the questions, deliberately selecting
**one wrong option and leaving at least one blank** to guarantee a non-perfect score, then
submit.

The attempt request performs all of the following before responding:

```
grade answers against the quiz
  → analyzeMistakesForAttempt   Groq call, up to 5 wrong answers
  → QuizAttempt created, quiz updated
  → enqueue SYNC_ATTEMPT        (awaited, then the response is sent)
  → HTTP 200 with attemptId and the mistake analyses
```

The response payload contains `mistakeAnalyses`, so you can see the misconception text for
the wrong answers immediately. The browser remains on the result screen for the whole
analysis window.

Do not assume the generated questions are stable. They come from a live LLM at generation
time and differ between runs; the same fixture does not produce the same quiz. Only the
source material is deterministic.

### Step 6 — Observe learner/progress state

In the browser, open `/` (dashboard) and then `/analytics`.

Look for:

- **Dashboard** — quizzes taken, questions answered, readiness, retention, due reviews.
- **Weak topics** and **recommended next action**, populated from the attempt.
- **Analytics** — a 30-day accuracy trend, per-topic mastery, weak topics, and the
  "adaptive recommendations from incorrect answers" panel.

These read `UserProgress`. `UserProgress` is written by the `SYNC_ATTEMPT` worker job, not by
the attempt request. If the worker was not running, the attempt was saved but these panels
stay empty — that is the single most useful diagnostic in this whole runbook.

### Step 7 — Open the review/recommendation experience

Return to `/`. The recommendations block shows the readiness score, retention trend, due
flashcards, weakest topic, and a suggested revision item sourced from the review queue.

There is no dedicated review-queue page in the current frontend. The review queue is
populated by the `SYNC_ATTEMPT` worker job and by the advisory `REBUILD_REVIEW_QUEUE` job
that the recommendations endpoint enqueues. To inspect the raw items:

```bash
curl -s http://localhost:3001/api/v1/review-queue \
  -H "Authorization: Bearer $TOKEN" | head -c 1200
```

Item types you should expect after a scored attempt: `failed_question` (one per wrong
answer), plus `weak_topic` or `low_confidence_topic` for affected topics.

### Step 8 — Ask the tutor a material-grounded question

Open `/tutor` and ask, verbatim:

```
What does the process control block contain, and what is the role of the program counter?
```

This is answerable from the fixture. It is a good probe because the exact phrase
"process control block" and "program counter" appear repeatedly in the source text, which
suits the current lexical retriever.

Use a second, deliberately off-topic question to characterise retrieval behaviour:

```
Explain the quantum chromodynamics of the strong force.
```

**What to expect:** the tutor still returns an answer, because there is no refusal gate in
the current implementation. The retrieved context for an off-topic question consists of the
highest-scoring chunks regardless of how low those scores are.

### Step 9 — Inspect the retrieved-source metadata

In the tutor panel, the answer lists the retrieved sources, each with a chunk id, chunk
index, source title, and a match percentage.

The percentage is `Math.round(score * 100)` where `score` is
`0.78 × cosine + 0.22 × keyword-overlap` (`src/pages/Tutor.tsx`, `embeddingService.js:196`).
Treat it as a **heuristic lexical-hash similarity score, not a semantic similarity score**.
It rewards exact shared tokens; it does not understand synonyms or paraphrase. A
paraphrased question can score near zero against a chunk that plainly answers it.

Recorded for the fixture, measured with the current scoring formula:

| Question | Top score |
| :--- | :--- |
| "What is a process control block?" | 0.6981 |
| "When does a process move from the Running state to the Ready state?" | 0.6655 |
| "What triggers a context switch?" | 0.2866 |
| "What is the difference between a preemptive and a non-preemptive scheduler?" | 0.2433 |
| "quantum chromodynamics" (off-topic) | 0.0482 |

Two things to internalise: scores are moderate even for on-topic questions, and off-topic
questions still receive a top hit. The tutor is prompt-constrained to the retrieved text;
it is not guaranteed to be factually entailed by that text, and the product does not verify
entailment.

### Step 10 — Record what was synchronous and what was background

| Step | Runs inside the HTTP request | Runs in the BullMQ worker |
| :--- | :--- | :--- |
| Generate quiz from PDF | PDF text extraction; all Groq generation; MongoDB transaction; enqueue call | `INDEX_MATERIAL` → chunk, embed, write `MaterialChunk` |
| Submit attempt | grading; Groq mistake analysis; attempt write; enqueue call | `SYNC_ATTEMPT` → `UserProgress`, `LearningEvent`, failed-question items, review-queue rebuild |
| Tutor question | retrieval; Groq answer; learning-event write | — |
| Dashboard / recommendations | reads `UserProgress`; enqueues an advisory rebuild | `REBUILD_REVIEW_QUEUE` |

Confirm the background work actually happened. Compare the BullMQ counters from step 1 with
the current values, and re-read the panels from steps 6 and 7:

```bash
docker compose logs worker | tail -40        # Option A
# Option B: the worker writes to backend/logs/app.log
tail -40 backend/logs/app.log
```

Look for `[JobWorker] Starting job`, `Completed job`, and `[JobQueue] Enqueued task`.

---

## 4. Expected observations

These describe the implementation as it stands. Treat any deviation as a finding to record,
not as something to fix in the middle of a demo.

**Upload and generation**

- The `/assessments/create` request does not return until PDF text extraction *and* LLM quiz
  generation have both completed. Neither stage is backgrounded.
- PDF parsing is a blocking synchronous filesystem read inside the request.
- The response is HTTP 200 with the complete quiz. There is no `202 Accepted` and no polling
  contract.
- Text shorter than 50 extracted characters is rejected with a validation error. This fixture
  extracts 7,454 characters, so it clears the gate comfortably.

**Indexing**

- Material chunking, the `local-hash-v1` embedding, and the `MaterialChunk` writes happen in
  the worker via the `INDEX_MATERIAL` job.
- This fixture produces **5 chunks** of roughly 1,500–1,800 characters each, each storing a
  384-dimensional vector.
- Indexing is *not* fully removed from the request path: the tutor read path lazily indexes
  any unindexed material for the current user, and a tutor question is the one place where
  you may pay the indexing cost synchronously.
- If the worker is not running, the upload still succeeds. Nothing is indexed until a tutor
  question triggers the lazy path.

**Attempt submission**

- The attempt request waits for mistake analysis. The analyses are already present in the
  attempt response.
- `UserProgress` mastery, confidence and weakness, `LearningEvent` rows, and the review-queue
  rebuild all happen afterwards in the `SYNC_ATTEMPT` worker job.
- Therefore, immediately after submitting, the attempt result screen is populated but the
  dashboard and analytics panels may not be. Give the worker a moment and reload.

**Tutor and retrieval**

- The tutor response includes retrieved chunk metadata: chunk id, chunk index, source title,
  preview, and a score.
- Scores are heuristic lexical-hash similarity, not semantic similarity. Synonyms and
  paraphrase are not matched.
- There is no retrieval-confidence refusal gate. An off-topic question still receives an
  answer built from the top-scoring chunks.
- The tutor is instructed to answer only from the supplied context, but nothing in the code
  verifies that the answer is actually supported by that context.

**Quality of generated quizzes**

- The live upload path is: upload → extract text → `generateQuiz` → structural validation
  (four options, an answer index in 0–3, a known cognitive level) → scored quality filter →
  token-overlap de-duplication → ranking → persist. Questions failing the structural check are
  dropped silently.
- De-duplication is token-overlap, not exact-string: two questions sharing more than 60% of
  their tokens are treated as the same and the later one is dropped. So a genuinely distinct
  question that reuses the source's vocabulary can be discarded.
- If Groq fails for every chunk, the request returns an error — HTTP 502 via `AIServiceError`.
  There is no degraded or fallback quiz on the live path.

---

## 5. Troubleshooting

Only failure modes you can actually hit in this demo.

**MongoDB unavailable**
`backend/config/database.js` logs the error and returns `null` rather than crashing, so the
API stays up and most endpoints answer `503` with a database message. Quiz generation fails
outright,
because `runInTransaction` cannot start a session against a disconnected client. Check
`/health`: `database.state` and `services.mongoDB` report it. Under Compose, also check that
`mongo-init` completed with exit code 0 — without the replica set, transactions fail even
though Mongo is connected.

**Redis unavailable while real queue execution is enabled**
The API process stays up. `enqueue` calls throw a typed "background processing could not be
scheduled" error, and because `INDEX_MATERIAL` and `SYNC_ATTEMPT` are awaited, the client
sees a 5xx **even though the material, quiz, and attempt were already committed**. That
failure is misleading: re-running the request creates a second quiz. `/health` reports
`services.redis` and `services.bullMQ`.

**Groq API key missing or invalid**
A missing or empty key is caught at startup by `backend/config/env.js`, which prints the
offending variables and exits. An invalid or rate-limited key fails later, inside the
request: quiz generation, mistake analysis, and the tutor all surface an error. The upload
path has no fallback quiz, so generation failure means no quiz at all. Verify with a single
call:

```bash
curl -s -X POST http://localhost:3001/api/v1/tutor/ask \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"What is a process control block?"}'
```

**Worker not running**
The most common and most misleading failure. Uploads and attempts both succeed; nothing
indexes and `UserProgress` never updates, so the dashboard and analytics panels stay empty
forever. The one visible exception is `REBUILD_REVIEW_QUEUE`, whose enqueue is fire-and-forget
and swallows its error, so the recommendations endpoint returns 200 with stale data. Under
Compose, confirm the `worker` service is healthy — it has no HTTP listener, so its health
check is a process liveness probe. Locally, confirm the second terminal is still running.

**Material exists but no chunks are indexed**
Expected whenever the worker is down or the `INDEX_MATERIAL` job failed. The tutor still
answers, because the tutor read path lazily indexes on first use, and a `POST
/api/v1/tutor/materials/:materialId/reindex` endpoint performs the same work
synchronously in the
request. Inspect the chunks directly:
```bash
curl -s "http://localhost:3001/api/v1/tutor/history" -H "Authorization: Bearer $TOKEN"
```

`metadata.retrievedChunkIds` in that history lists the chunks actually retrieved for each
past tutor interaction. An empty or absent list alongside a working tutor panel usually
means no material has been indexed for that user yet.

**Authentication or session problem**
Protected routes return `401` when the bearer token is missing or invalid, and the
frontend clears `athenaeum_token` and redirects to `/auth` on any 401
(`src/lib/api.ts:26-30`). A token signed with a different `JWT_SECRET` than the one the
running API holds is invalid, so if you changed `backend/.env` while the API was running,
sign in again. A `503` on protected routes is a database problem, not an auth problem — see
the MongoDB entry above.

---

## 6. Demo acceptance checklist

Observable behaviour only.

- [ ] `shasum -a 256 backend/tests/fixtures/demo-material.pdf` matches the hash in this
      document
- [ ] All three processes are running, and `/api/v1/health/ready` returns `ready`
- [ ] A demo user is created and the dashboard loads
- [ ] The fixture PDF is accepted by the upload control
- [ ] The quiz-generation request stays pending while generation runs, then returns a quiz
- [ ] The generated quiz opens and every question has exactly four options
- [ ] An attempt with at least one incorrect answer is submitted
- [ ] The attempt response contains `mistakeAnalyses` entries for the wrong answers
- [ ] The attempt result screen shows a score below 100%
- [ ] After a short wait, the dashboard and `/analytics` show non-zero quizzes taken and at
      least one weak topic
- [ ] The review queue contains at least one `failed_question` item
- [ ] The tutor returns an answer to the process-control-block question
- [ ] The tutor panel lists retrieved sources with chunk ids and a match percentage
- [ ] The off-topic tutor question still returns an answer, and its retrieval scores are
      visibly lower than the on-topic scores
- [ ] Worker logs show `Enqueued task` and `Completed job` entries for the run
- [ ] Every step above was completed, and any deviation was recorded rather than fixed
