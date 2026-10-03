# Deployment & execution guide

How to run the application locally, and how it is deployed in production. The production topology is
declared in [`../render.yaml`](../render.yaml) so it is reviewable in Git rather than living only in
a Render dashboard.

## Local development

The backend expects a `.env` file in `backend/`. Copy the committed template and fill it in:

```bash
cp backend/.env.example backend/.env
# then set GROQ_API_KEY, MONGODB_URI and JWT_SECRET
```

`backend/config/env.js` validates them at startup and exits rather than starting half-configured.

Two ways to run it:

```bash
# 1. Docker Compose — brings up Mongo (as a replica set), Redis, API, worker and frontend
docker compose up

# 2. Directly, in two terminals
cd backend && npm install && npm run dev     # Express via nodemon
npm install && npm run dev                   # Vite dev server
```

| Service | URL |
|---|---|
| Frontend (Vite) | http://localhost:8080 |
| API | http://localhost:5001 |
| Health / readiness | http://localhost:5001/api/v1/health · `/ready` |

The dev server port is pinned in `vite.config.ts`, not left to Vite's default. `docker compose`
publishes the frontend on 8081 and honours `BACKEND_HOST_PORT` if 5001 is taken.

To produce a production bundle locally:

```bash
VITE_API_ROOT="https://api.example.com/api/v1" npm run build   # → dist/
```

## Production topology

Everything runs on Free plans, so **no payment method is required**.

```
athenaeumai.tech          Render static site   FREE   (the Vite bundle in dist/)
        │
        │  VITE_API_ROOT, baked in at build time
        ▼
api.athenaeumai.tech      Render web service   FREE   (0.1 CPU / 512 MB)
        │                      node main.js — Express AND the BullMQ worker
        ├── MONGODB_URI ──► MongoDB Atlas M0   FREE   (replica set — transactions required)
        ├── REDIS_URL ────► Render Key Value   FREE   (25 MB, in-memory only)
        └── GROQ_API_KEY ─► Groq free tier
```

### Why the worker shares the API process

Render publishes no Free compute plan for a Background Worker, so a $0 deployment cannot host the
consumer separately. `backend/main.js` starts both in one process instead:

```
node main.js
  ├── connectDB()        idempotent — see config/database.js
  ├── startWorker()      BullMQ consumer, concurrency 5
  └── startServer()      Express listener
```

Job semantics are unchanged. Work is still enqueued, still recorded in MongoDB, still retried with
backoff, and still executed by a real BullMQ worker — only the hosting process differs. Folding the
work into request handlers was rejected: it would make a multi-minute quiz generation occupy an HTTP
request, lose the durable job record, and remove retry and terminal-state behaviour.

`startServer()` and `startWorker()` deliberately register **no** process signal handlers, so
SIGTERM has a single owner: drain the worker, close HTTP, close the database, exit, with a 30s
ceiling. `node server.js` and `node worker.js` still work standalone and still own their own
shutdown — Compose, local development and the Playwright E2E suite use those.

Verified on a production-shaped single container: one process (`ps` shows a single
`node main.js`), API ready, and a real `INDEX_MATERIAL` job enqueued by the API was picked up by the
in-process worker 19 ms later and completed, indexing 5 chunks.

## Environment variables

### Frontend — build time

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_ROOT` | **yes** | Baked into the bundle. Must be the deployed API, e.g. `https://api.athenaeumai.tech/api/v1`. A production build with this unset throws at startup by design, rather than silently addressing localhost. |

### API — runtime

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production`. Selects the CORS allow-list and keeps the queue live. |
| `PORT` | yes | Render assigns it; do not hard-code 5000. |
| `MONGODB_URI` | **yes** | Must be a **replica set**. See below. |
| `JWT_SECRET` | **yes** | ≥ 8 characters. `generateValue: true` in the blueprint. |
| `GROQ_API_KEY` | **yes** | Without it every AI feature fails. |
| `GROQ_MODEL` | no | Defaults to `openai/gpt-oss-120b`. Set it to move models without a code change. |
| `ENABLE_JOB_QUEUE` | yes | `true`. The queue is only auto-disabled under `NODE_ENV=test`. |
| `REDIS_URL` | **yes** | Connection string from Render Key Value. `REDIS_HOST`/`REDIS_PORT` also work and are what Compose uses. |
| `ALLOWED_ORIGINS` | **yes** | Comma-separated frontend origins. In production this is the *only* allow-list — there is no localhost fallback. |

No secret value belongs in `render.yaml`. Each is declared `sync: false`, which makes Render prompt
for it at apply time.

## MongoDB must be a replica set

The durable attempt claim and quiz generation both run inside `runInTransaction`, and MongoDB does
not support multi-document transactions on a standalone server. The application refuses the write
rather than pretending to succeed.

`docker compose up` provisions a single-node replica set automatically. **Atlas deployments are
replica sets**, which is why Atlas is the right choice here and a self-hosted standalone `mongod` is
not:

```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
```

## One-time step after the first deploy

```bash
npm run indexes:sync
```

Run it once against the production database. It reconciles the per-question ReviewQueue unique
index. Mongoose's `autoIndex` creates missing indexes but will not *widen* one that already exists,
so a database created before `questionIndex` existed keeps the old coarse index and rejects the rows
current code writes. The command is idempotent and reports what it did.

The same applies to any environment that predates this change — it is a migration, not a per-deploy
step.

## Build and start commands

Neither Dockerfile is used in production: both run `npm run dev` (Vite dev server / nodemon). Render
builds from source instead.

| Service | Build | Start |
|---|---|---|
| `frontend` | `npm ci && npm run build` | static, publishes `./dist` |
| `api` | `cd backend && npm ci` | `npm run start:combined` → `node main.js` |

Health check: `GET /api/v1/health/ready`. It reports readiness from a real capability probe, so a
deployment that cannot reach MongoDB or cannot run transactions will not pass it.

The SPA rewrite in the blueprint matters: `/tutor`, `/review` and `/assessments/:id/result` are
client-side routes with no file behind them, and must resolve to `index.html`.

## What the Free tier costs you

Free is genuinely $0 with no payment method, and Render suspends rather than bills if you would
incur charges. But it is explicitly documented as being for testing and hobby projects, not
production. These are the behaviours that follow, all of them accepted deliberately:

| Limitation | Effect here |
|---|---|
| **Spins down after 15 min idle** | The service sleeps and takes ~1 min to wake on the next request. A visitor arriving after a quiet period sees a loading page first. |
| **750 instance hours/month per workspace** | Enough for a demo. Once exhausted, all Free web services are suspended until the month resets. |
| **0.1 CPU / 512 MB** | Comfortable for this workload — the AI calls are network-bound, not CPU-bound. |
| **Ephemeral filesystem** | Uploaded PDFs under `uploads/` do not survive. Nothing depends on that: the extracted text and chunks live in MongoDB. Logs are unaffected now that they go to stdout. |
| **Key Value is in-memory (25 MB)** | Queue contents are lost if the instance restarts, so an in-flight job can be dropped. `maxmemoryPolicy: noeviction` stops Redis silently evicting queued jobs at the memory ceiling. Retention caps (`removeOnComplete`/`removeOnFail`, 500 each) keep usage bounded. |
| **Service-initiated traffic threshold** | Render may suspend a Free service that generates unusually high outbound traffic — and it names *external database access* and *external API calls* explicitly, which is exactly Atlas and Groq. Fine at demo volume; a busy deployment would not be. |
| **No one-off jobs, no shell, no persistent disk** | Migrations run as a command, not a Render job. |

No uptime-pinging workaround is attempted: keeping the service awake to dodge the spin-down would
defeat the purpose and burn the instance hours.

## Known production limitation

Every model currently reachable on the configured Groq key is a **reasoning** model, so each spends
part of its token budget reasoning before answering. Measured end to end, a five-question quiz takes
**117–244s** depending on the model. The tutor is unaffected in practice (~7s). The previous default,
`llama-3.3-70b-versatile`, was non-reasoning and fast, and has been retired by Groq.

This is a real user-visible wait on the primary action. It is recorded rather than hidden, and it is
the first item on the product roadmap.

## Smoke test after deploying

Run against the live domain, not a local build:

- [ ] Homepage loads and the bundle contains no `localhost` API URL
- [ ] Registration, then logout and login again
- [ ] PDF upload → indexing reaches a terminal state
- [ ] Quiz generation completes (expect ~2 min; see the limitation above)
- [ ] Submitting an attempt creates one review item **per missed question**
- [ ] Today's Review lists them
- [ ] Tutor returns a grounded answer with citations
- [ ] Tutor refuses when the learner has no material, without calling the model
- [ ] `GET /api/v1/health/ready` reports ready
- [ ] The worker is running **inside the API process** — startup log shows `Combined API + worker process ready.`
- [ ] Logs appear in Render's dashboard (the app logs to stdout, not just to a file)
