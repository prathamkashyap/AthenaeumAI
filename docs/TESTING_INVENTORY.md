# Test inventory

Everything below was executed on branch `improve/athenaeum-foundation` at commit `ddb2bba`. Every
number is a real result from that run, not an estimate. If you change a test, re-measure and update
this file — do not carry a number forward on trust.

## Suites at a glance

| Layer | Command | Files | Tests | Result |
|---|---|---:|---:|---|
| Backend unit | `cd backend && npm run test:unit` | 35 | 929 | 929 passed |
| Backend integration | `cd backend && npm run test:integration` | 9 | 114 | 101 passed, 13 skipped locally; 108 / 6 in CI |
| Frontend | `npm test` | 17 | 209 | 209 passed |
| Playwright E2E | `npm run test:e2e` | 2 | 28 | 26 passed, 2 skipped |

Totals: **63 test files, 1280 tests.**

Supporting checks, all passing on the same commit:

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0, 0 problems |

`npm run typecheck` is `tsc -b`, not `npx tsc --noEmit`. The root `tsconfig.json` is a solution file
with `"files": []` and project references, so `--noEmit` at the root compiles nothing and reports
success unconditionally. Use `npm run typecheck`.

## Backend unit — 35 files, 929 tests

No database, no Redis, no network, no AI credential. Suites replace only the Mongoose or SDK
boundary and then execute the shipped module.

| File | Tests | File | Tests |
|---|---:|---|---:|
| `reviewQueueService` | 97 | `tutorGroundingRefusal` | 24 |
| `reviewQueueAttemptAttribution` | 79 | `quizService` | 24 |
| `attemptProcessing` | 74 | `aiProviderTimeout` | 24 |
| `analyticsService` | 72 | `tutorGrounding` | 22 |
| `flashcardService` | 49 | `mongoTransactionCapability` | 20 |
| `aiQuizService` | 48 | `retrievalIndependentHoldout` | 19 |
| `bm25Retriever` | 37 | `retrievalHoldout` | 18 |
| `quizGenerationController` | 28 | `retrievalBaseline` | 18 |
| `topicNormalizationService` | 28 | `flashcardMistakes` | 18 |
| `retrievalGoldSet` | 27 | `retrievalHoldoutV2` | 17 |
| `backgroundJobStatus` | 26 | `backgroundJobService` | 17 |
| `qualityFilter` | 25 | `tutorService` | 16 |
| `streamingTutorService` | 16 | `flashcardGenerateRoute` | 14 |
| `workerJobLifecycle` | 10 | `flashcardGenerateWeakTopic` | 10 |
| `queueEnqueueFailure` | 10 | `mistakeAnalysisService` | 10 |
| `retrievalComparisonV2` | 9 | `groqProvider` | 7 |
| `bm25CandidateEvaluation` | 7 | `healthTransactionCapability` | 6 |
| `jobQueue` | 3 | | |

Nine of these inject `backend/tests/mocks/mockAIProvider.js` through the provider seam, so AI code
runs deterministically with no key and no network: `aiQuizService`, `aiProviderTimeout`,
`mistakeAnalysisService`, `queueEnqueueFailure`, `quizGenerationController`, `quizService`,
`streamingTutorService`, `tutorGroundingRefusal`, `tutorService`. `groqProvider` covers the vendor
adapter against a fake SDK.

## Backend integration — 9 files, 114 tests (101 passed, 13 skipped)

Needs a real MongoDB. Redis only for the BullMQ suite.

| File | Tests | Notes |
|---|---:|---|
| `reviewQueueAttemptIdentity` | 45 | Question identity against the real unique index |
| `api` | 24 | Mounts 6 routers |
| `backgroundJobDurability` | 11 | Job survives a process boundary |
| `mongoTransactionCapability` | 10 | 2 of its tests self-skip without a replica set |
| `tutorGroundingRefusalPersistence` | 9 | A refusal is recorded, not lost |
| `backgroundJobRetry` | 5 | Self-skips without a replica set |
| `attemptSyncDurability` | 4 | |
| `bullmq` | 3 | Self-skips unless `ENABLE_JOB_QUEUE=true` |
| `attemptSyncTransaction` | 3 | Self-skips without a replica set |

The 13 skips are capability probes, not failures. They assert that a deployment which cannot run
multi-document transactions skips the transaction-dependent path rather than pretending to pass.

The same 114 tests therefore yield a **different split** depending on the deployment, and both
figures are correct:

| Deployment | Result |
|---|---|
| Local, standalone `mongod` | 101 passed, 13 skipped |
| CI, single-node replica set with `ENABLE_JOB_QUEUE=true` | 108 passed, 6 skipped |

CI provisions a replica set and enables the queue, which activates 7 of the 13 gated tests. The
counts are verified against CI run `37042895598`.

## Frontend — 17 files, 209 tests

Vitest with jsdom and Testing Library. No browser, no network.

| File | Tests | File | Tests |
|---|---:|---|---:|
| `flashcardsDueReview` | 25 | `tutorNoMaterial` | 15 |
| `reviewQueueSection` | 22 | `indexingStatus` | 14 |
| `tutorPage` | 19 | `attemptBackgroundJob` | 12 |
| `indexingPolling` | 17 | `attemptRetry` | 12 |
| `todaysReview` | 15 | `flashcardsGenerationError` | 11 |
| `resultMistakeReview` | 11 | `libraryEmptyState` | 9 |
| `createAssessmentIndexing` | 8 | `attemptSaveFailure` | 6 |
| `questionBankRemoval` | 6 | `quizContextBackgroundJob` | 6 |
| `example` | 1 | | |

## Playwright E2E — 2 files, 28 tests (26 passed, 2 skipped)

Real HTTP against the real Express app and a real MongoDB. Chromium for the three browser flows.

- `flow.spec.ts` — 14 tests: health endpoints, signup/login and their rejections, protected-route
  401s, empty-library responses, and three browser flows (auth page, signup to dashboard, tutor
  empty state).
- `async-job-lifecycle.spec.ts` — 14 tests over Playwright's `request` fixture: job ownership and
  tenancy, public-contract safety, tracked `SYNC_ATTEMPT` jobs, readiness truthfulness.

The 2 skips are the real-worker BullMQ case, which requires `E2E_REAL_QUEUE=true` plus an isolated
Redis. Everything else runs by default.

## Measured coverage

From `cd backend && npm run test:coverage` (unit + integration, 1043 tests):

| Metric | Covered | Total | Percent |
|---|---:|---:|---:|
| Statements | 1042 | 1517 | 68.69% |
| Branches | 747 | 1232 | 60.63% |
| Functions | 234 | 348 | 67.24% |
| Lines | 1042 | 1517 | 68.69% |

There is **no enforced coverage floor.** `backend/jest.config.json` declares no
`coverageThreshold`, and `vitest.config.ts` defines no coverage configuration at all. The figures
above are reported for information, not gated.

`recommendationService.js` is the one service with no direct test: 0 of 15 functions covered.

## Measured retrieval

Retrieval is lexical, and it is measured rather than asserted. `local-hash-v1` is the production
scorer. Seven suites in the unit layer consume six labelled fixtures in `backend/tests/fixtures/`.

Production scorer on the three holdout sets, all queries answerable:

| Evaluation set | Queries | HitRate@1 | HitRate@3 | HitRate@5 | Precision@5 | MRR |
|---|---:|---:|---:|---:|---:|---:|
| Independent holdout v1.0.0 | 24 | 0.9167 | 1.0000 | 1.0000 | 0.2083 | 0.9583 |
| Holdout v2.0.0 | 38 | 0.9211 | 1.0000 | 1.0000 | 0.2000 | 0.9474 |
| Independent holdout, final | 40 | 0.9250 | 1.0000 | 1.0000 | 0.2000 | 0.9583 |

The v2 gold set is harder by construction: 31 queries, 29 answerable and 2 deliberately
unanswerable. Production scores HitRate@1 0.7241, HitRate@5 0.8276, Precision@5 0.1724, MRR 0.7644.

`backend/services/bm25Retriever.js` is an independently implemented BM25 scorer kept as an
**evaluation candidate only** — no production module imports it. Measured against production it
scores *higher* on HitRate@1 and MRR (v2 gold set: 0.7931 and 0.8103; final holdout: 0.9750 and
0.9875). That result is recorded rather than acted on; adopting it is product work, not a test fix.

Latency is **not** measured anywhere.

## What each layer is for

The layers overlap on purpose. A single layer is not trusted to carry a claim alone.

- **Unit** — production formulas and their edge cases, against stubbed boundaries.
- **Integration** — that the same code behaves against a real database and a real unique index.
- **Frontend** — that pages and context render correct states, including empty and failed ones.
- **E2E** — that the deployed shape of the API holds together over real HTTP, and that a learner
  can register and reach a usable page.

Tutor behaviour is deliberately split: `tutorPage`, `tutorNoMaterial` and `tutorGroundingRefusal`
cover the UI, while `async-job-lifecycle` and `tutorGroundingRefusalPersistence` cover the refusal
contract. The grounded tutor chat flow against real indexed material is verified by the
post-deployment smoke test, not by a browser spec, because seeding a material requires the AI path.

## External services

| Layer | MongoDB | Redis | AI credential | Browser | Worker |
|---|---|---|---|---|---|
| Backend unit | no | no | no | no | no |
| Backend integration | **yes** | for `bullmq` | no | no | no |
| Frontend | no | no | no | no | no |
| E2E, default | **yes** | no | no | yes | no |
| E2E, `E2E_REAL_QUEUE=true` | **yes** | **yes**, isolated | no | yes | **yes** |

## CI behaviour

`.github/workflows/ci.yml` defines three jobs — `backend`, `frontend`, `e2e` — and triggers on
push to `main`/`develop`/`feature/**` and on pull requests to `main`/`develop`.

- **backend** — provisions a single-node MongoDB replica set, then unit + coverage, then
  integration with `ENABLE_JOB_QUEUE=true`. A replica set rather than a plain service container,
  because the durable attempt claim depends on multi-document transactions and a standalone server
  cannot provide them.
- **frontend** — `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. The test step runs
  before the build so a failure stops the artifact.
- **e2e** — Playwright, on pull requests and on pushes to `main`. The job uses only hardcoded
  placeholder credentials, so it also runs on forks.

CI does **not** run `npm run lint`. Lint is clean locally and is not currently enforced. Making it
a gate is a one-line change that has not been made.

## Known gaps

Stated plainly so they are not mistaken for coverage:

1. **No latency measurement** anywhere in the retrieval pipeline.
2. **`recommendationService.js` has no direct test** — 0 of 15 functions.
3. **The tutor chat flow is not covered by a browser spec.** Seeding a material needs the AI path,
   which needs a real credential and a replica set.
4. **Seven of `api.test.js`'s 24 passes are no-ops** — an early `if (!authToken) return;` guard lets
   them pass without asserting. They are counted as passing and assert nothing.
5. **Cross-tenant isolation is covered for two resources only** — background jobs and review-queue
   items. Material, quiz, attempt and flashcard cross-user reads are untested.
6. **Lint is not a CI gate**, so it can regress without being noticed.
7. **`src/test/example.test.ts`** is a one-assertion placeholder. It is kept deliberately so the
   "no frontend tests" path stays honest if the suite is ever emptied again.
