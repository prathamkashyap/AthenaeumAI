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

```
athenaeumai.tech          Render static site   (the Vite bundle in dist/)
        │
        │  VITE_API_ROOT, baked in at build time
        ▼
api.athenaeumai.tech      Render web service   (Express, node server.js)
        │
        ├── MONGODB_URI ──► MongoDB Atlas      (replica set — transactions required)
        ├── REDIS_URL ────► Render Key Value   (Valkey, BullMQ)
        └── GROQ_API_KEY ─► Groq
                                    │
                       athenaeum-worker  Render background worker (node worker.js)
                          consumes the same queue
```

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

### Worker — runtime

`NODE_ENV`, `MONGODB_URI`, `GROQ_API_KEY`, `GROQ_MODEL`, `ENABLE_JOB_QUEUE`, `REDIS_URL`. No
`JWT_SECRET` and no `ALLOWED_ORIGINS`: the worker serves no HTTP and issues no tokens.

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
| `api` | `cd backend && npm ci` | `npm start` → `node server.js` |
| `worker` | `cd backend && npm ci` | `node worker.js` |

Health check: `GET /api/v1/health/ready`. It reports readiness from a real capability probe, so a
deployment that cannot reach MongoDB or cannot run transactions will not pass it.

The SPA rewrite in the blueprint matters: `/tutor`, `/review` and `/assessments/:id/result` are
client-side routes with no file behind them, and must resolve to `index.html`.

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
- [ ] The worker process is running and consuming the queue
