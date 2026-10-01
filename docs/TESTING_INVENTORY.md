# Testing Inventory

**Repository:** `prathamkashyap/AthenaeumAI`
**Baseline commit:** `e845d65` ("chore(test): remove global coverage threshold to fix CI")
**Branch:** `improve/athenaeum-foundation`
**Audit date:** 2026-09-29

---

## 1. Purpose

This document records the current automated-testing surface of the repository as it actually
exists. It is a baseline, not a plan, and it changes no application behaviour.

It exists to separate four things that a filename or a coverage number alone cannot distinguish:

1. **Tests of shipped production code** — the test imports the module and executing the
   assertion runs that module's code.
2. **Integration tests of real application behaviour** — production code is reached through a
   route or a worker, but not by direct call.
3. **Tests that duplicate production logic** — the test defines its own copy of a formula or
   rule and asserts against the copy. The shipped module is never loaded.
4. **Untested production paths** — no suite imports, reaches, or meaningfully executes the code.

Three rules govern every classification below.

- **Test filenames are not evidence.** A test named `flashcardService.test.js` is only a test of
  `flashcardService.js` if it imports it. Every classification here was derived from the
  `import` statements in the test source and from which functions are invoked.
- **Assertions are not enough.** A passing assertion against a copied formula is a test of the
  copy. Section 4 records, for each duplicated suite, exactly which production rules are
  mirrored and which are absent from the copy.
- **Coverage percentage is not behavioural coverage.** Section 5 reports statement, branch, and
  function coverage separately, because they diverge sharply in this repository.

`file:line` references point at `main` as of `e845d65`.

---

## 2. Test-suite inventory

Ten test files exist in the repository. Generated coverage artefacts
(`backend/coverage/`, `dist/`) and the committed fixture
(`backend/tests/fixtures/demo-material.pdf`) are **not** tests and are excluded from all counts.

| Suite | Location / command | Framework | Files | Tests | External services | What it exercises |
| ----- | ------------------ | --------- | ----: | ----: | ----------------- | ----------------- |
| Frontend unit | `npm test` → `vitest run`; `src/test/`, `vitest.config.ts` | Vitest 3.2.4 (jsdom) | 1 | 1 | none | Nothing. `src/test/example.test.ts` asserts `expect(true).toBe(true)`. Imports only `vitest`. |
| Backend unit | `cd backend && npm run test:unit`; `backend/tests/unit/` | Jest 30 (node) | 21 | 564 | none | Contract suites, all production-bound: only infrastructure is replaced. Includes `mongoTransactionCapability.test.js` (capability detection and the centralized transaction gate) and `healthTransactionCapability.test.js` (the health surface's capability decision, with Redis and MongoDB mocked so that decision is isolable). |
| Backend integration | `cd backend && npm run test:integration`; `backend/tests/integration/` | Jest 30 + supertest | 5 | 52 (47 + 5) | **MongoDB** required. **Redis** required for `bullmq.test.js`, which self-skips unless `ENABLE_JOB_QUEUE=true`. | `api.test.js` mounts 6 routers. `mongoTransactionCapability.test.js` classifies the deployment it is really connected to and proves that a transaction-backed write on a standalone server fails with a safe application error and persists nothing; its replica-set block self-skips when no replica set is available rather than asserting against a double. `bullmq.test.js` runs a real BullMQ `Worker` over `processBackgroundJob` against a real Redis. |
| Backend coverage | `cd backend && npm run test:coverage` | Jest 30, istanbul | 8 (same as above) | 142 total (139 passed, 3 skipped) | as above | No additional code. Re-runs the full suite with instrumentation. No threshold. |
| E2E | `npm run test:e2e`; `tests/e2e/`, `playwright.config.ts` | Playwright 1.61.0 | 2 | 28 | **MongoDB**, Chromium, a real API process, a Vite dev server. **Redis** only with `E2E_REAL_QUEUE=true`, which also starts the worker. | 15 API-level tests via Playwright's `request` fixture; 3 browser tests. Includes the async-job lifecycle spec and a readiness regression asserting `database.transactions` matches the real deployment. Mocks only `**/api/v1/tutor/ask`. |
| Backend smoke | `npm run smoke` → `backend/scripts/smokeTest.js` | plain Node script | — | — | MongoDB, a running API | Not a Jest suite. Asserts DB connectivity, health endpoints, login, and protected-route token handling. Not part of any automated run. |
| Backend seed/verify | `npm run seed:demo`, `npm run verify:demo` → `backend/scripts/seedDemo.js`, `verifyDemo.js` | plain Node script | — | — | MongoDB | Data seeding and count assertions. Manual utilities, not automated tests. |

### Per-file test counts (measured)

| File | `test(`/`it(` literals | Tests reported by runner | Production imports |
| ---- | -------------------: | --------------------------: | ------------------ |
| `backend/tests/unit/topicNormalizationService.test.js` | 28 | 28 passed | `../../services/topicNormalizationService.js` |
| `backend/tests/unit/qualityFilter.test.js` | 25 | 25 passed | `../../utils/qualityFilter.js` |
| `backend/tests/unit/analyticsService.test.js` | 25 | 25 passed | **none** |
| `backend/tests/unit/reviewQueueService.test.js` | 19 | 19 passed | **none** |
| `backend/tests/unit/flashcardService.test.js` | 18 | 18 passed | **none** |
| `backend/tests/unit/jobQueue.test.js` | 3 | 3 passed | `../../utils/jobQueue.js`, `../../utils/errors.js` |
| `backend/tests/integration/api.test.js` | 18 (+4 generated by a `forEach` at `:222-227`) | 21 passed | 6 route modules |
| `backend/tests/integration/bullmq.test.js` | 3 | 3 (skipped without the flag) | 3 models, `utils/jobQueue.js`, `worker.js` |
| `tests/e2e/flow.spec.ts` | 14 | not executed | **none** |
| `src/test/example.test.ts` | 1 | 1 passed | **none** |

`backend/jest.config.json` sets `testMatch: ["**/tests/**/*.test.js"]`, so
`backend/tests/mocks/groqMock.js` is never collected — confirmed absent from
`jest --listTests`.

---

## 3. Unit-test import map

Classification vocabulary:

| Class | Meaning |
| :--- | :--- |
| **Direct production-code test** | Imports the module under test and invokes its exported functions. |
| **Indirect / shared-utility test** | Imports production code incidentally (e.g. an error class) rather than the behaviour named in the filename. |
| **Local re-implementation** | Declares its own copy of the production formula/rule and asserts against the copy. The production module is never loaded. |
| **Mock-only test** | Exercises a test-supplied double and no production module. |
| **Other** | Anything else, explained inline. |

| Test file | Imports production module? | Production module(s) imported | What is actually tested | Assessment |
| --------- | -------------------------- | ----------------------------- | ----------------------- | ---------- |
| `backend/tests/unit/topicNormalizationService.test.js` | **Yes** | `../../services/topicNormalizationService.js` | `toTitleCase` and `normalizeTopic` are imported and called across 28 cases: casing, whitespace, separators, noise words, acronyms, and the canonical-subject map. | **Direct production-code test.** 100% statement, branch, and function coverage of the module. |
| `backend/tests/unit/qualityFilter.test.js` | **Yes** | `../../utils/qualityFilter.js` | `calculateQualityScore` and `isLowQuality` are imported and called. Covers structural disqualifiers (non-string question, wrong option count, out-of-range answer) and each of the six penalty rules individually, plus the `< 5.0` rejection boundary. | **Direct production-code test.** 94.44% statements, 94.11% branches, 100% functions. |
| `backend/tests/unit/jobQueue.test.js` | **Yes** | `../../utils/jobQueue.js` (`createJobQueue`), `../../utils/errors.js` (`QueueEnqueueError`) | `createJobQueue({ queue: fakeQueue, testMode: false })` is called directly. Asserts that `queue.add` receives the merged default options, that a rejected `add` surfaces as `QueueEnqueueError`, and that a function payload is rejected before `add` is reached. `queue.add` is a `jest.fn()`. | **Direct production-code test** of the enqueue wrapper, over an injected fake queue. `QueueEnqueueError` from `errors.js` is imported only as an assertion helper — see the `errors.js` row in §5. |
| `backend/tests/unit/flashcardService.test.js` | **No** | **none** | A locally defined `clamp` (`:8`) and `computeNextReview` (`:10-36`) re-create the SM-2 ease formula, clamp, repetition reset, interval ladder, and easy bonus. All 18 assertions run against that copy. | **Local re-implementation.** See §4.1. |
| `backend/tests/unit/analyticsService.test.js` | **No** | **none** | Seven locally defined helpers (`:9-72`): `toPercent`, `computeRetentionScore`, `computeReadiness`, `computeAverageMastery`, `computeAverageConfidence`, `computeWeakTopics`, `buildAccuracyTrend`. All 25 assertions run against those copies. | **Local re-implementation.** See §4.2. |
| `backend/tests/unit/reviewQueueService.test.js` | **No** | **none** | Five locally defined helpers (`:9-76`): `nowPlusHours`, `buildTopicItem`, `buildFlashcardItem`, `paginateItems`, `snoozeItem`. All 19 assertions run against those copies. | **Local re-implementation.** See §4.3. |

**Backend unit totals:** 3 of 6 suites are direct production-code tests (3 + 25 + 28 = 56
assertions). 3 of 6 are local re-implementations (18 + 25 + 19 = 62 assertions) that load no
production service at all.

**Other non-test-support files under `backend/tests/`:**

| File | Status |
| :--- | :--- |
| `backend/tests/mocks/groqMock.js` | Exports `MOCK_QUESTIONS`, `MOCK_FLASHCARDS`, `MOCK_TUTOR_RESPONSE`, `createMockGroqClient`, `createFailingGroqClient`. **Imported by nothing.** A repo-wide search for `groqMock`, `createMockGroqClient`, `createFailingGroqClient`, `MOCK_TUTOR_RESPONSE`, `MOCK_FLASHCARDS`, and `MOCK_QUESTIONS` across `*.js`, `*.ts`, `*.tsx`, `*.json`, `*.yml` returns matches only inside the file itself. Not collected by Jest (no `.test.js` suffix). Not referenced by CI. |
| `backend/tests/fixtures/demo-material.pdf` | A committed PDF fixture for manual demo use. Not a test, not collected by any runner. |

---

## 4. Re-implemented test logic

Three suites re-create production rules locally. In all three the copy is currently
*faithful* — the constants and thresholds match production today — but nothing links the two,
so the copies can drift silently. The concern is not present divergence; it is the absence of
any mechanism that would detect future divergence.

Verification that the copies are currently faithful (constants compared line by line between
each test file and its production counterpart):

| Rule | Production | Test copy | Agree |
| :--- | :--- | :--- | :--- |
| SM-2 ease formula, clamp `[1.3, 3.0]` | `flashcardService.js:176-180` | `flashcardService.test.js:14-18` | yes |
| SM-2 interval ladder `1 / 6 / interval × EF` | `flashcardService.js:183-195` | `flashcardService.test.js:21-33` | yes |
| SM-2 easy bonus `× 1.3` | `flashcardService.js:193` | `flashcardService.test.js:31` | yes |
| Retention decay `2.2 / day` | `analyticsService.js:117` | `analyticsService.test.js:20` | yes |
| Never-practiced default `30` days | `analyticsService.js:116` | `analyticsService.test.js:19` | yes |
| Readiness weights `0.55 / 0.25 / 0.20` | `analyticsService.js:121` | `analyticsService.test.js:27` | yes |
| Weak-topic filter `> 35` or mastery `< 65` | `analyticsService.js:66` | `analyticsService.test.js:41` | yes |
| Review topic filter `> 35` or confidence `< 55` | `reviewQueueService.js:59` | `reviewQueueService.test.js` — **absent** | **no** |
| Review topic cap `.slice(0, 12)` | `reviewQueueService.js:60` | `reviewQueueService.test.js` — **absent** | **no** |
| Flashcard priority `round(55 + daysOverdue × 8)` | `reviewQueueService.js:101` | `reviewQueueService.test.js:41` | yes |
| Overdue threshold `≥ 1 day` | `reviewQueueService.js:96` | `reviewQueueService.test.js:36` | yes |
| `failed_question` priority `80` | `reviewQueueService.js:35` | `reviewQueueService.test.js` — **absent** | **no** |

### 4.1 Flashcards / SM-2

**Production module:** `backend/services/flashcardService.js`
**Production function:** `applySpacedRepetitionReview` (`:147-211`)
**Test file:** `backend/tests/unit/flashcardService.test.js`
**Test copy:** `clamp` (`:8`) and `computeNextReview` (`:10-36`)

`applySpacedRepetitionReview` is a single exported function that performs the SM-2 arithmetic
and then, in the same body, loads a `FlashcardSet` from MongoDB (`:155`), resolves the
sub-document card (`:163`), mutates nine fields (`:199-207`), and calls `set.save()` (`:209`).
There is no exported pure helper. The test therefore could not import and call the real
arithmetic without a database, and the local copy exists for that reason.

| SM-2 rule | Mirrored by the copy? | Asserted? | Evidence |
| :--- | :--- | :--- | :--- |
| Ease-factor calculation | yes (`:14-16`) | yes | `:104-107` |
| Ease-factor clamp, floor `1.3` | yes (`:17`) | yes | `:56-59` |
| Ease-factor clamp, ceiling `3.0` | yes (`:17`) | yes | `:139-142` |
| Repetition reset when `quality < 3` | yes (`:20`) | yes | `:41-44` |
| First-repetition interval = 1 day | yes (`:25-26`) | yes | `:71-74` |
| Second-repetition interval = 6 days | yes (`:27-28`) | yes | `:89-92` |
| Subsequent interval `interval × EF` | yes (`:29-33`) | yes, **relatively only** | `:94-102` asserts `> 10`, not a specific value |
| Easy bonus `× 1.3` | yes (`:31`) | yes, **relatively only** | `:118-132` compares `easy > good` |
| `hard` behaviour (quality 3, enters the repetition branch) | yes (`:11`) | partially | `:64-78` covers increment and first interval only; no test distinguishes `hard` from `good` on the interval ladder |
| `again` → interval 0 vs other low score → 1 day | yes (`:24`) | yes | `:46-49` covers `again` only; the "other low score → 1 day" branch is unreachable via the public rating map and is untested |
| Next-review date calculation (`now + interval × 24h`) | Not applicable — the suite now imports the production function instead of mirroring the arithmetic | **yes** | `flashcardService.test.js` calls the real `applySpacedRepetitionReview`, which computes and persists `nextReviewAt`. No real database stands behind the date assertion. |
| Persisted card fields (9 fields, 3 alias pairs) | **no** | **no** | `:199-207` is inside the unexecuted production function |
| Seed state in `normalizeCardsForScheduling` | **no** | **no** | `flashcardService.js:10-24` is not mirrored |
| 404 branches for missing set / missing card | **no** | **no** | `:156-169` is not mirrored |
| Which production function is imported | — | — | **none; the test file has zero relative imports** |

**Mutation check.** To establish how tightly the assertions bind, the same 13 assertions from
this suite were replayed against a copy of the production formula with individual constants
mutated (operated on a scratch copy in `/tmp`; no repository file was modified):

| Mutation to production logic | Result of the suite's corresponding assertion |
| :--- | :--- |
| Second-repetition interval `6 → 3` | **FAILS** — the assertion is meaningful |
| Ease-factor floor `1.3 → 0.5` | **FAILS** — the assertion is meaningful |
| Easy bonus `1.3 → 1.0` (bonus removed) | **PASSES** — the assertion does not pin the constant |

**Why this matters.** The suite is green today and would stay green if `applySpacedRepetitionReview`
were deleted outright, because the shipped function is never imported. Two of the thirteen
assertions bind to a specific numeric constant; the other eleven are satisfied by a wide class
of implementations. There is currently no test in the repository that would fail if the SM-2
scheduler changed its ease floor, its second interval, or its entire body.

### 4.2 Analytics / decay

**Production module:** `backend/services/analyticsService.js`
**Production function:** `getDashboardAnalytics` (`:15-186`) — a single monolithic exported
function containing the decay constant, the readiness weights, the weak-topic filter, the
trend builder, and six database reads.
**Test file:** `backend/tests/unit/analyticsService.test.js`
**Test copies:** `toPercent` (`:9`), `computeRetentionScore` (`:11-24`), `computeReadiness`
(`:26-27`), `computeAverageMastery` (`:29-32`), `computeAverageConfidence` (`:34-37`),
`computeWeakTopics` (`:39-50`), `buildAccuracyTrend` (`:52-72`)

| Production behaviour | Imported? | Mirrored by copy? | Asserted? |
| :--- | :--- | :--- | :--- |
| `toPercent` | no | yes | yes (`:76-92`) |
| Retention decay `max(0, confidence − days × 2.2)` | no | yes (`:20`) | yes (`:132-153`) |
| Never-practiced 30-day default | no | yes (`:19`) | yes (`:132-136`) |
| Readiness weights `0.55 / 0.25 / 0.20` | no | yes (`:27`) | yes (`:160-166`) |
| Readiness weight ordering (mastery dominant) | no | yes | yes (`:168-174`) |
| `averageMastery` / `averageConfidence` | no | yes | yes (`:96-115`) |
| Weak-topic filter and top-6 slice | no | yes (`:41-42`) | yes (`:180-231`) |
| 30-day accuracy trend | no | yes (`:52-72`) | yes (`:236-257`) |
| `reviewDueToday` | no | no | no |
| `recommendedNextAction` branching | no | no | no |
| `highlights` block | no | no | no |
| All six database reads | no | no | no |
| `startOfDay` (`:9-12`) | no | no | no |

**Why this matters.** The production decay constants are inlined inside one unexported-from-a-
helper function that requires five MongoDB reads to execute. The test copies the arithmetic and
drops the I/O. The result is that a change to `analyticsService.js:117` (the `2.2` coefficient)
or `:121` (the readiness weights) would not fail any test, even though the local copy in the test
file would then be provably wrong.

### 4.3 Review queue

**Production module:** `backend/services/reviewQueueService.js`
**Production functions:** `upsertOpenQueueItem` (`:8-25`), `enqueueFailedQuestionItems`
(`:27-51`), `rebuildReviewQueueForUser` (`:53-118`), `listReviewQueue` (`:120-143`),
`completeReviewQueueItem` (`:145-174`), `snoozeReviewQueueItem` (`:176-190`)
**Test file:** `backend/tests/unit/reviewQueueService.test.js`
**Test copies:** `nowPlusHours` (`:9`), `buildTopicItem` (`:11-30`), `buildFlashcardItem`
(`:32-53`), `paginateItems` (`:55-67`), `snoozeItem` (`:72-76`)

| Production behaviour | Imported? | Mirrored by copy? | Asserted? |
| :--- | :--- | :--- | :--- |
| `upsertOpenQueueItem` filter and `$set`/`$setOnInsert` | no | **no** | no |
| `enqueueFailedQuestionItems` — `failed_question` construction | no | **no** | no |
| `enqueueFailedQuestionItems` — priority `80` | no | **no** | no |
| `rebuildReviewQueueForUser` topic filter `> 35` / `< 55` | no | **no** | no |
| `rebuildReviewQueueForUser` topic cap `.slice(0, 12)` | no | **no** | no |
| Topic item `itemType` classification and title | no | yes (`:14, 19-21`) | yes (`:83-105`) |
| Topic item priority `max(weaknessScore, 100 − confidence)` | no | yes (`:21`) | yes (`:107-116`) |
| Topic item description string | no | yes (`:20`) | yes (`:119-122`) |
| Flashcard `overdue_review` vs `due_flashcard` at 1 day | no | yes (`:36`) | yes (`:132-146`) |
| Flashcard priority `round(55 + daysOverdue × 8)` | no | yes (`:41`) | yes, relatively (`:136, 144`) |
| Flashcard `General` topic fallback | no | yes (`:39`) | yes (`:155-160`) |
| `listReviewQueue` sort order `priority` desc, `dueAt` asc | no | **no** | no |
| `listReviewQueue` pagination and clamping | no | yes (`:55-67`) | yes (`:165-200`) |
| `completeReviewQueueItem` — status flip and `revision_completed` event | no | **no** | no |
| `snoozeReviewQueueItem` — `dueAt + hours`, priority forced to `40` | no | yes (`:72-76`) | yes (`:204-229`) |

**Why this matters.** This is the most divergent of the three. The suite does not mirror the
*filtering* logic that decides which topics become queue items, the `failed_question`
construction that the `SYNC_ATTEMPT` worker depends on, the listing sort order, or the
completion path. It mirrors only the per-item *shape* and the pagination arithmetic. Because
`rebuildReviewQueueForUser` is a pure function of `UserProgress` and `FlashcardSet` reads, a
test of the shipped function needs only those two collections — but no such test exists, and
the only coverage of the module comes from the BullMQ integration test reaching it through the
worker, which asserts nothing about the produced items.

---

## 5. Production-module coverage inventory

Coverage is **measured but not enforced**. `backend/jest.config.json` has no
`coverageThreshold` key; `vitest.config.ts` defines no coverage configuration; and
`.github/workflows/ci.yml` runs coverage, publishes the artefact, and contains zero occurrences
of the string `threshold`. The `e845d65` commit removed a prior global gate of
branches 70 / functions 75 / lines 80 / statements 80.

The most important number in this section: **12 of the 13 modules in `backend/services/` have
0.00% function coverage.** Non-zero statement coverage in those files comes from module
evaluation — top-level `const` declarations of arrow functions — not from any function body
executing. `topicNormalizationService.js` is the only service with a function ever called by
any test in the repository.

### Learning core

| Production area | Direct unit test | Integration coverage | E2E coverage | Coverage quality | Gap |
| --------------- | ---------------- | -------------------- | ------------ | ---------------- | --- |
| `progressService.js` | **Direct, with stubbed models** — `attemptProcessing.test.js` drives `updateUserProgressFromAttempt` and `updateStudyStreak` through the real worker path. | **Yes** — `attemptSyncTransaction.test.js` runs the same code against a real replica-set transaction and real models, including the rollback case. | None | Prior measurement, predates current code: 0.00% functions, 13.09% statements. Not re-measured. | All the private formulas (`computeWeightedMastery`, `computeWeaknessScore`, `recencyScoreFor`, `difficultyDeltaFor`) execute in both suites. No E2E drives this module. |
| `flashcardService.js` | **Direct** — `flashcardService.test.js` imports the real module (only the FlashcardSet model is stubbed); `flashcardMistakes`, `flashcardGenerateWeakTopic` and `flashcardGenerateRoute` drive `createFlashcardSet`. | None | `flashcardsDueReview.test.tsx` covers the review UI and the submitted rating | Prior measurement, predates current code: 0.00% functions. Not re-measured. | `applySpacedRepetitionReview`, `createFlashcardSet` and `getDueFlashcards` all execute. `getDueFlashcards` runs only against stubbed models. |
| `analyticsService.js` | **Direct** — `analyticsService.test.js` imports the real module and mocks only the five models, so the body executes. | Route-level only, and see the §6.1 finding — the authenticated dashboard request is skipped at runtime. | None | Prior measurement, predates current code: 0.00% functions. Not re-measured. | `getDashboardAnalytics` body executes against stubbed models. The §6.1 runtime skip is unchanged. |
| `reviewQueueService.js` | **Direct** — `reviewQueueService.test.js` imports the real module and mocks only models. | Indirectly reached by the worker, and by `backgroundJobRetry.test.js` through a real retry delivery. | None | Prior measurement, predates current code: 0.00% functions. Not re-measured. | `upsertOpenQueueItem`, `enqueueFailedQuestionItems`, `listReviewQueue`, `completeReviewQueueItem` and `snoozeReviewQueueItem` all execute against stubbed models; none runs against a real collection. |
| `learningEventService.js` | **Direct** — `attemptSyncTransaction.test.js` stubs the module but delegates to the real `recordAttemptEvents`, so it writes real rows inside the real transaction. | **Yes** — same suite, against a real database. | None | Prior measurement, predates current code: 20% statements, **0.00% functions**. Not re-measured. | Both `recordAttemptEvents` (real database) and `recordLearningEvent` (via `reviewQueueService.test.js`, stubbed model) execute. |
| `topicNormalizationService.js` | **Direct** — 28 cases. | Indirectly reached by the progress path. | None | **100% statements, branches, functions.** | None for this module. |
| `recommendationService.js` | None. | None — no test mounts `recommendationRoutes`, and no test calls `GET /recommendations/dashboard`. | None | **0.00% across all metrics.** | `getRecommendationSnapshot` and `recordRecommendationFollowed` never executed, including the `void jobQueue.enqueue` fire-and-forget path at `:37-47`. |

### AI / quiz

| Production area | Direct unit test | Integration coverage | E2E coverage | Coverage quality | Gap |
| --------------- | ---------------- | -------------------- | ------------ | ---------------- | --- |
| `aiQuizService.js` | **Partial** — `aiQuizService.test.js` drives the module's own exports directly against a stubbed provider; `quizService.test.js` and `quizGenerationController.test.js` reach `generateQuizFromAI` through `generateQuiz`; the flashcard and tutor suites replace the whole module. | Module is loaded transitively by route import, so module-level declarations count. | None | Prior measurement, predates the current code: 14.56% statements, **0.00% functions.** Not re-measured. | `generateQuizFromAI` **is** executed, via `generateQuiz` (`quizService.js:36`); those suites stub the provider rather than this module. `generateTutorResponseFromAI` **is** executed (`aiQuizService.test.js`), as is `generateMistakeAnalysesFromAI` (reached by the real `analyzeMistakesForAttempt`). `generateFlashcardsFromAI`, `getGroqClient`, and all prompt builders are never executed. |
| `quizService.js` | **Direct** — `tests/unit/quizService.test.js` and `tests/unit/quizGenerationController.test.js` (97 tests across the quiz-generation suites). | Loaded transitively by the route import; the live upload route calls `generateQuiz` (`quizController.js:117`). | `tests/e2e/async-job-lifecycle.spec.ts` submits a PDF and asserts the generated quiz and its tracked job. | Prior measurement, predates the current code: 6.57% statements, 0.00% functions. Not re-measured. | `generateQuiz`, `isSimilar`, `removeSimilar` and `scoreQuestion` are all executed, by the unit suites and by the live upload route. `fallbackQuizGenerator` was removed in `cd65a23`; quiz generation now raises `AIServiceError` (HTTP 502) instead of synthesising questions. `seedDefaultQuizzes`, the only other caller, is never invoked. |
| `mistakeAnalysisService.js` | **Direct** — `mistakeAnalysisService.test.js` imports the real module with zero mocks and drives `analyzeMistakesForAttempt`. | Indirectly reached from the worker's `SYNC_ATTEMPT` path. | None | Prior measurement, predates current code: 11.76% statements, 0.00% functions. Not re-measured. | `analyzeMistakesForAttempt` and `fallbackAnalysis` both execute, the latter on the provider-failure branch. |
| `streamingTutorService.js` | **Direct** — `streamingTutorService.test.js` has zero mocks and calls `streamTutorResponse` directly. | None | The E2E tutor mock still intercepts the HTTP route, so this module is not reached in E2E. | Prior measurement, predates current code: **0.00% across all metrics.** Not re-measured. | Unit-covered. The streaming endpoint has no frontend caller. |
| `tutorService.js` | **Direct** — `tutorService.test.js` imports the real module, mocking only models, `learningEventService` and `aiQuizService`. | None — `tutorRoutes` is not mounted by `api.test.js`. | None — mocked at the browser layer. | Prior measurement, predates current code: **0.00% across all metrics.** Not re-measured. | `gatherTutorContext` and `askContextualTutor` execute, including the retrieval branch, but against a stubbed chunk store and a stubbed provider — so grounding is asserted structurally, not against real retrieved chunks. |
| `utils/qualityFilter.js` | **Direct** — 25 cases. | None. | None | 94.44% statements, 94.11% branches, 100% functions. | Well covered as a module. Noted in §5 note: it is **not on the live quiz path**, so its coverage does not represent covered user-facing behaviour. |
| `utils/pdfParser.js` | None — stubbed wherever a controller test needs it. | None | **Yes** — `async-job-lifecycle.spec.ts` uploads a real PDF, so extraction runs. | Prior measurement, predates current code: 10% statements, 0.00% functions, 100% branches. Not re-measured. | `extractTextFromPDF` executes in E2E only. Its `try`/`catch` is the only branch, hence the historical 100% branch figure. |

### Retrieval

| Production area | Direct unit test | Integration coverage | E2E coverage | Coverage quality | Gap |
| --------------- | ---------------- | -------------------- | ------------ | ---------------- | --- |
| `embeddingService.js` | None. | Indirect: `bullmq.test.js` asserts one 384-length embedding is persisted. | None | 14.41% statements, **0.00% functions.** | `generateEmbedding`, `cosineSimilarity`, `chunkMaterialText`, `keywordOverlapScore`, and the whole of `searchMaterialChunks` never executed. `indexStudyMaterialChunks` is reached via the worker but only its persistence result is asserted. |
| `models/MaterialChunk.js` | None. | Indirect: imported and queried by `bullmq.test.js`. | None | Not in `collectCoverageFrom` (models are excluded from the coverage report). | Schema validation, the unique compound index, and the `topics` text index are never asserted. |

### Background processing

| Production area | Direct unit test | Integration coverage | E2E coverage | Coverage quality | Gap |
| --------------- | ---------------- | -------------------- | ------------ | ---------------- | --- |
| `utils/jobQueue.js` | **Direct** — 3 cases over `createJobQueue` with an injected fake queue. | Indirect: `bullmq.test.js` uses the module-level `jobQueue` and `backgroundQueue` against real Redis. | None | **86.36% statements, 61.53% branches, 66.66% functions** under unit tests alone; 40.9% under integration alone. | Uncovered unit lines `26, 42, 51` are the Redis error listener, the test-mode early return, and the unconfigured-queue throw. No test covers `isQueueDisabled` resolution from `NODE_ENV`/`ENABLE_JOB_QUEUE`. |
| `worker.js` | None — not in `collectCoverageFrom`, so it is absent from the coverage report entirely. | **Direct behavioural coverage** — `bullmq.test.js` registers a real `Worker` on the exported `processBackgroundJob`. | None | Not measured. The only suite that executes worker code. | `startWorker` (`:109-155`) — the BullMQ `Worker` construction, `concurrency: 5`, the `QueueEvents` listeners, and the SIGINT/SIGTERM shutdown handlers — is never executed, because tests import `processBackgroundJob` only. |

### Controllers / HTTP

No controller has a direct unit test. Every controller is exercised, if at all, through
`backend/tests/integration/api.test.js`, which mounts six routers.

| Controller | Router mounted by `api.test.js` | Handler actually invoked by a test | Statement coverage (combined run) |
| :--- | :--- | :--- | ---: |
| `authController.js` | yes | `signup`, `login`, `me` | 16.88% |
| `healthController.js` | yes | **none** — `api.test.js` mounts `healthRoutes.js`, whose handlers are defined inline in that route file, not in the controller | 0.00% |
| `analyticsController.js` | yes | `dashboardAnalytics` — **but skipped at runtime, see §6.1** | 15.38% |
| `quizController.js` | yes | `getQuizHistory` — **skipped at runtime** | 5.83% |
| `flashcardController.js` | yes | `listFlashcardSets` — **skipped at runtime** | 14.70% |
| `reviewQueueController.js` | yes | `getReviewQueue` — **skipped at runtime** | 20.00% |
| `libraryController.js` | **no** | none — `libraryRoutes` is never mounted | 0.00% |
| `tutorController.js` | **no** | none — `tutorRoutes` is never mounted | 0.00% |
| `recommendationController.js` | **no** | none | 0.00% |
| `notificationController.js` | **no** | none | 0.00% |

Handlers imported by a mounted router but never invoked by any test (17 of them):
`generateQuizController`, `getQuizById`, `getQuizBySubject`, `getSubjects`, `saveAttempt`,
`deleteQuiz` (all in `quizController`); `listDueFlashcards`, `generateFlashcardSet`,
`reviewFlashcard`, `deleteFlashcardSet` (`flashcardController`);
`rebuildReviewQueue`, `completeReviewQueue`, `snoozeReviewQueue` (`reviewQueueController`);
`listLearningEvents` (`analyticsController`); `updateProfile`, `refresh`, `logout`
(`authController`).

### Remaining first-party modules

| Module | Coverage quality | Note |
| :--- | :--- | :--- |
| `utils/errors.js` | 50% statements, 20.83% branches, 30% functions (combined) | Reached **indirectly**: `jobQueue.test.js` imports `QueueEnqueueError` to assert error typing. Not the subject of any test. |
| `utils/auth.js` | 19.48% statements, 0% functions | No direct test. Reached via the auth routes, but only the module-level declarations execute. |
| `utils/dbTransactions.js` | 9.09% statements, 0% functions | No direct test. |
| `utils/chunker.js` | 0.00% | No test. |
| `utils/textCleaner.js` | 0.00% | No test. |
| `services/defaultQuizSeeder.js` | Excluded from `collectCoverageFrom` (`jest.config.json:11`) | No test. |
| `utils/logger.js` | Excluded from `collectCoverageFrom` (`jest.config.json:12`) | No test. |
| All 11 Mongoose models | Not in `collectCoverageFrom` | No schema-level test. `User`, `StudyMaterial`, `MaterialChunk` are imported by `bullmq.test.js` for fixtures, not for validation. |
| All `backend/middleware/*` | Not in `collectCoverageFrom` | No direct test. `authMiddleware`, `validateRequest`, and `upload` run transitively in integration. |
| All `backend/validation/*` | Not in `collectCoverageFrom` | Reached transitively by the mounted routers. |
| All `src/**` (frontend) | 1 placeholder test | No component, hook, context, or `api.ts` test. |

---

## 6. Integration-test inventory

### 6.1 `backend/tests/integration/api.test.js`

**Setup** (`:35-67`): builds a minimal Express app from six route modules — `authRoutes`,
`healthRoutes`, `analyticsRoutes`, `quizRoutes`, `flashcardRoutes`, `reviewQueueRoutes` — and
connects with `mongoose.connect(testDbUri)` (`:44-46`). It deliberately does not import
`server.js`, so the API's own bootstrap never runs.

**Routes exercised:** `/auth/signup`, `/auth/login`, `/auth/me`, `/health`, `/health/ready`,
`/analytics/dashboard`, `/quiz/history`, `/flashcards`, `/review-queue`.

**Services reached:** those reachable from the above six routers. In practice, the reachable
service bodies are only the health route's inline handlers — see the finding below.

**Database behaviour:** `User` creation is attempted; `UserProgress.deleteMany({})` and
`User.deleteMany({ email: /integration-test/ })` clean up (`:71-75`).

**Redis / BullMQ:** not used. With `NODE_ENV=test` and no `ENABLE_JOB_QUEUE`, `jobQueue.js:8-9`
disables the queue, so `backgroundQueue` is never constructed.

**Real worker:** no.

**Authentication coverage:** the test asserts 401-or-503 for four unauthenticated protected
routes (`:214-228`) and asserts signup/login validation rejections (400/422). Those assertions
do execute.

**Tenant-isolation coverage:** none. There is no test that creates two users and checks that
one cannot read the other's material, quiz, attempt, flashcard, or review-queue item. The
`$or: [{ user }, { isDefault: true }]` sharing of default quizzes is never asserted either.

**Assertions made:** 21 reported. Notable limitations, established by running the suite's own
setup as a read-only probe against the same MongoDB:

> `api.test.js` connects with `mongoose.connect()` directly instead of calling `connectDB()`
> from `backend/config/database.js`. The `isConnected` flag that `isDBConnected()` returns is
> set **only** inside `connectDB()` (`config/database.js:15`). Therefore `isDBConnected()` is
> `false` for the whole suite, and `signup` takes its early return
> `return res.status(503).json({ error: "MongoDB is required for signup and progress tracking" })`
> (`authController.js:44-46`).
>
> The test accepts this: `expect([201, 503]).toContain(res.status)` (`:104`). Because
> `res.status !== 201`, `authToken` is never assigned (`:107-110`). Every subsequent test
> guarded by `if (!authToken) return;` — lines `115, 126, 139, 149, 158, 164, 179, 190, 199,
> 207, 234, 261, 267` — **returns immediately without executing a single assertion.**
>
> Measured directly: `POST /api/v1/auth/signup → 503`; `authToken assigned → false`.

**Consequence.** Of the 21 reported passes, **12 are no-ops.** The "green" integration suite
does not execute the login-success path, `/auth/me`, the analytics dashboard, quiz history,
flashcard listing, or the review queue. This is consistent with the 0.00% function coverage
across all 13 services in §5: the services are *loaded* but their bodies never *run*. The test
suite reports success either way, so a genuine failure in any of those paths would be invisible.

### 6.2 `backend/tests/integration/bullmq.test.js`

**Conditional presence.** `:14-15` replaces `describe` with `describe.skip` unless
`ENABLE_JOB_QUEUE === "true"`. Without the flag the whole suite reports as 3 skipped and the run
is green. `backend/package.json:16` does not set the flag; `.github/workflows/ci.yml:70` does.

**Setup** (`:34-48`): connects to `MONGODB_URI_TEST`, opens two `ioredis` clients, constructs a
real `Worker(BACKGROUND_QUEUE_NAME, processBackgroundJob, { concurrency: 1 })` and a real
`QueueEvents`.

**What it genuinely exercises — verified test by test:**

| Question | Answer | Evidence |
| :--- | :--- | :--- |
| Real enqueue into a Redis-backed queue? | **Yes** | `:86-91` calls the real `jobQueue.enqueue`; the module-level `backgroundQueue` is a live `Queue` over `REDIS_HOST`/`REDIS_PORT`. |
| Real worker processing? | **Yes** | `:41-44` registers `processBackgroundJob` — imported from `backend/worker.js` — on a real BullMQ `Worker`. |
| Resulting database mutations? | **Yes, for `INDEX_MATERIAL` only** | `:98-101` asserts one `MaterialChunk` document, a 384-length `embedding`, and `metadata.indexedAt`. |
| Queue dedup? | **Yes** | `:107-126` pauses the queue, enqueues the same `REBUILD_REVIEW_QUEUE` payload twice with an identical `deduplicationId`, and asserts `duplicate.id === first.id`. |
| Retry / failure handling? | **Yes, genuinely** | `:128-145` enqueues an unknown job type with an explicit `attempts: 2` and `backoff: { type: "fixed", delay: 25 }`, then asserts the promise rejects with `"Unknown background job type"`, that `attemptsMade === 2`, that `failedReason` contains the message, and that the record appears in `getFailed()`. This is not a configuration claim — the failure is observed. |
| `SYNC_ATTEMPT` processing? | **Yes, at every level.** | `attemptProcessing.test.js` drives the handler with the transaction and models stubbed; `attemptSyncTransaction.test.js` runs it against a real replica-set transaction (first application, duplicate refusal, mid-transaction rollback); `backgroundJobRetry.test.js` drives a real retry delivery; `async-job-lifecycle.spec.ts` submits attempts in E2E. |
| `REBUILD_REVIEW_QUEUE` result contents? | **No.** Only the job result is asserted, not the queue items. | `:120-122` asserts `toMatchObject({ type: "REBUILD_REVIEW_QUEUE" })`. Nothing inspects `ReviewQueue` documents. |
| Worker lifecycle (construction, `concurrency: 5`, `QueueEvents`, graceful shutdown)? | **No.** | The test imports `processBackgroundJob` only, never `startWorker` (`worker.js:109-155`). |
| Attempt-ownership re-check in the worker? | **No.** | `worker.js:79-81` is inside `SYNC_ATTEMPT`, never reached. |
| Tenant isolation? | **No.** | A single user is created (`:58-62`); no cross-user assertion exists. |

**Cleanup** (`:65-75`): closes worker, queue events, queue, both Redis clients, and the
MongoDB connection.

### 6.3 Integration run observed during this audit

| Invocation | Result |
| :--- | :--- |
| `npm run test:integration` (repo default, queue disabled) | **PASS** — 1 suite passed, 1 skipped, 21 passed / 3 skipped. Same run in earlier sessions of this rework recorded 24/24 when `ENABLE_JOB_QUEUE=true` and Redis was reachable. |
| `npm run test:integration` with `ENABLE_JOB_QUEUE=true` | **FAIL — 4 of 24.** See the environment note below. |

**Environment note (reported, not worked around).** During this audit, Redis stopped
listening on `127.0.0.1:6379`. MongoDB remained reachable on `27017`. No configuration,
test, or service was modified in response. With `ENABLE_JOB_QUEUE=true` and no Redis:

- `bullmq.test.js` — all 3 tests fail with `Exceeded timeout of 30000 ms for a hook` in
  `beforeAll` (`:34-48`), which awaits `worker.waitUntilReady()`. The suite therefore reports
  a green total for the *other* suite while the queue suite is entirely non-executing.
- `api.test.js` — `GET /api/v1/health › returns 200 with status ok` fails with
  `Exceeded timeout of 15000 ms for a test`. The request **hangs** rather than returning
  `degraded`. `healthRoutes.js:36-42` awaits `backgroundQueue.getJobCounts()` inside a
  `try`/`catch`, but the queue's ioredis client is constructed with
  `maxRetriesPerRequest: null` (`jobQueue.js:22`), so the promise never settles and the
  `catch` never fires. The health endpoint has no timeout guard on that call.

Both facts are recorded here as observations about current behaviour. Neither was fixed.

---

## 7. AI-path test inventory

| AI path | Unit test | Integration test | E2E test | Requires live Groq? | Current status |
| ------- | --------- | ---------------- | -------- | ------------------- | -------------- |
| `generateQuizFromAI` (`aiQuizService.js:279-356`) | **Direct**, indirectly — `quizService.test.js` and `quizGenerationController.test.js` reach it through `generateQuiz`. | Reached by the live upload route (`quizController.js:117`). | `tests/e2e/async-job-lifecycle.spec.ts` posts a PDF to `/quiz/generate`. | **Yes**, at runtime | Covered at the function level, but only against a stubbed provider, so its prompt construction is asserted indirectly rather than pinned to real provider output. |
| `generateTutorResponseFromAI` (`aiQuizService.js:482-563`) | **Direct** — `aiQuizService.test.js` imports the real function and controls the provider through the `setAIProvider` seam. | None — `tutorRoutes` not mounted | None — the E2E tutor test mocks the HTTP route | **Yes**, at runtime | Covered directly and **offline**: the prompt built from the retrieved `[SOURCE n]` context, the learner question, the weak-topic/mistake-history/flashcard payload, the tutor's own model and sampling parameters, the system role, response parsing and collection caps, provider failure, and the bounded timeout are all asserted against a stubbed provider. No real Groq request is made, so this is seam coverage rather than network coverage. |
| `streamTutorResponse` (`streamingTutorService.js:16-86`) | **Direct** — `streamingTutorService.test.js` has zero mocks and calls it. | None | None — the streaming endpoint has no frontend caller | **Yes**, at runtime | Unit-covered. Prior measurement, predates current code: **0.00% across all metrics.** Not re-measured. |
| `generateMistakeAnalysesFromAI` (`aiQuizService.js:414-480`) | **Indirect** — reached by the real `analyzeMistakesForAttempt`, with the provider stubbed at the seam. | None | None | **Yes**, at runtime | Reached, but only against a stubbed provider, so prompt construction is not pinned to real provider output. |
| `analyzeMistakesForAttempt` (`mistakeAnalysisService.js:19-55`) | **Direct** — `mistakeAnalysisService.test.js`, zero mocks. | Indirectly reached from the worker's `SYNC_ATTEMPT` path. | None | **Yes**, at runtime | Covered directly, including the per-item fallback branch. |
| `generateFlashcardsFromAI` (`aiQuizService.js:358-412`) | None | None — `generateFlashcardSet` never invoked | None | **Yes**, at runtime | **Untested.** |
| `getGroqClient` (`aiQuizService.js:9-17`, `streamingTutorService.js:6-14`) | None | None | None | — | **Untested.** No test constructs a Groq client, valid or invalid. |
| Prompt builders (`buildPrompt`, `getDefaultCognitiveLevel`, `VALID_COGNITIVE_LEVELS`) | None | None | None | no | **Untested**, except that `getDefaultCognitiveLevel` and `VALID_COGNITIVE_LEVELS` are exported and therefore not covered. |
| Fallback generators (`fallbackTutorResponse`, `fallbackAnalysis`, `fallbackFromQuestions`, `fallbackFromText`) | None | None | None | no | **Untested.** All are internal to their modules and only reachable on LLM failure. |

### Is `groqMock.js` imported anywhere?

**No.** A repository-wide search across `*.js`, `*.ts`, `*.tsx`, `*.json`, `*.yml`, `*.mjs`,
`*.cjs`, excluding `node_modules`, for `groqMock`, `createMockGroqClient`,
`createFailingGroqClient`, `MOCK_QUESTIONS`, `MOCK_FLASHCARDS`, and `MOCK_TUTOR_RESPONSE`
returns matches **only inside `backend/tests/mocks/groqMock.js` itself**. It is additionally
invisible to Jest, because `testMatch` is `**/tests/**/*.test.js` and the file is not named
`*.test.js` — confirmed by its absence from `jest --listTests`. It is not referenced by
`.github/workflows/ci.yml`, and it is not referenced by any production module.

There is also no seam through which it could be used: `aiQuizService.js:9-17` and
`streamingTutorService.js:6-14` each call `new Groq({ apiKey })` directly. No interface,
factory, or injection point exists in either module, and the model string
`llama-3.3-70b-versatile` is hard-coded at all five call sites.

`MOCK_TUTOR_RESPONSE` uses the key `reply`, while the live tutor returns `answer`; the mock's
shape does not match the current tutor response contract.

### The distinction that must not be collapsed

These two statements are true simultaneously and are not equivalent:

- **"CI does not require a working Groq credential."** Verified. `ci.yml:47` and `ci.yml:136`
  both set `GROQ_API_KEY: test-key-not-real`. That string is non-empty, so it satisfies the Zod
  schema in `backend/config/env.js:8-11` and the non-empty guard in
  `aiQuizService.js:10-12`. It is never sent to Groq because no test reaches a Groq call.
- **"AI code paths are tested without Groq."** **False.** No AI code path is tested at all,
  with or without a key. The placeholder credential is doing nothing except satisfy
  configuration validation. It provides no test coverage, and its presence in CI must not be
  read as evidence that the AI layer is exercised.

---

## 8. E2E inventory

**Files:** 2 (`flow.spec.ts`, `async-job-lifecycle.spec.ts`). **Tests:** 28.

**Previously not executable; the three blockers in the earlier audit are resolved or
superseded.**

1. **Chromium** — `npx playwright install chromium` was run and the browser is now present, so
   the `page`-based specs execute.
2. **Database target** — the config's `mongoUri` defaulted to `mongodb://127.0.0.1:27018/...`,
   which was not listening, so the API never passed `/health/ready` and the entire suite failed
   with an opaque `webServer` timeout. The default now targets `27017`, and `MONGODB_URI_TEST`
   takes precedence over `MONGODB_URI`.
3. **Servers** — unchanged in shape: an API process and a Vite dev server. Requests go to the
   absolute API root rather than through Vite, because there is no dev proxy.

**Redis remains unavailable**, so the real BullMQ lifecycle is opt-in via `E2E_REAL_QUEUE=true`,
which additionally starts `backend/worker.js` as a second `webServer` entry. Left unset, the
backend runs with its queue disabled and the lifecycle spec skips rather than passing vacuously.

### Findings from a real run

- **`POST /api/v1/quiz/generate` cannot work on a standalone `mongod`.** It persists the
  material and quiz inside a transaction, and transactions require a replica set or mongos.
  The endpoint returns 500 with *"This MongoDB deployment does not support retryable writes"*,
  and no connection-string option changes that (verified directly against the driver). This is
  a deployment constraint, not a test defect: `docker-compose.yml` configures a single-node
  replica set, so the intended deployment satisfies it. The async spec probes `hello.setName`
  and skips the generation path with that stated reason.
- The attempt-submission and job-status path uses no transaction and is exercised in full.
- One pre-existing UI spec, *Signup creates a session and loads the dashboard*, fails because
  it asserts the committed dashboard greeting `Welcome back,` (`src/pages/Index.tsx:206`) while
  the **uncommitted** working-tree redesign replaced it with time-based greetings
  (`Good morning` / `Good afternoon` / `Good evening`). This is stale relative to in-progress UI
  work, not a backend gap; neither the spec nor the UI was modified.

- The deployment's transaction capability is now reported by the application itself
  (`database.transactions` on `/health` and `/health/ready`) and is read from the connected
  server's own `hello` response rather than inferred from the URI. On this standalone deployment
  it reports `unsupported` and `/health` reports `degraded`, while `/health/ready` stays
  `200 ready` because every non-transactional path still works. A regression test asserts the
  reported capability matches what the E2E helper independently probes, and needs no Redis.
- `POST /api/v1/quiz/generate` on this deployment now returns `503` with a message naming the
  transaction prerequisite, instead of the `500` *"does not support retryable writes"* wording
  found in Task 14.

**Structure:** 8 `describe` blocks across the two files, 28 tests.


| Block | Tests | Client | What it asserts |
| :--- | ----: | :--- | :--- |
| Health Endpoints | 2 | `request` | `GET /health` returns 200 with `status` in `[ok, degraded]`, `version` and `uptime` present, `database.label === "connected"`. `GET /health/ready` returns 200 `ready`. |
| Auth API | 4 | `request` | Signup creates a user and returns a token; duplicate email returns 409; login succeeds; wrong password returns 401. |
| Protected Routes without Auth | 3 | `request` | `/quiz/history`, `/library`, `/analytics/dashboard` all return 401. |
| Authenticated Flows | 2 | `request` | Signup then `GET /quiz/history` returns `{ quizzes: [] }`; `GET /library` returns `{ materials }`. |
| UI Workflows & Mocking | 3 | `page` | Auth page shows `Welcome back`; signup creates a session and the dashboard loads; tutor chat renders the mocked answer. |

**API mocking:** exactly one route interception, `page.route('**/api/v1/tutor/ask', …)` at
`:135-143`, returning a fixed JSON body. It applies to all three `UI Workflows & Mocking`
tests, including the two that never call the tutor.

**Is the worker real or synthetic?** Neither — it does not run. `playwright.config.ts:27` boots
the API with `NODE_ENV=test` and does **not** set `ENABLE_JOB_QUEUE`. `jobQueue.js:8-9`
therefore evaluates `isQueueDisabled = true`, `backgroundQueue` is `null`, and
`jobQueue.enqueue` returns the synthetic object from `:41-48`. No BullMQ consumer is started.
Two consequences: no Redis connection is opened by the E2E API process, and **no background
indexing or attempt sync ever executes during E2E**. `GET /health` reports
`services.bullMQ` as `"error"` (the `try`/`catch` at `healthRoutes.js:37-42` catches the
`TypeError` from calling `getJobCounts()` on `null`) and `status` as `"degraded"` — which the
health test tolerates at `:15`.

**Is quiz generation exercised?** **No.** No E2E test issues a request to
`POST /api/v1/quiz/generate`, and no PDF is ever selected in the browser. The upload control on
`/assessments/create` is never visited.

**Is the tutor real or mocked?** Mocked at the browser layer. The tutor request never leaves
the browser, so `tutorController`, `tutorService`, `streamingTutorService`, and
`aiQuizService` are all unexercised.

**Tutor mock shape mismatch.** The mock returns `{ answer: … }` (`:139-141`) and the
assertion at `:184` checks for that text. The live `/api/v1/tutor/ask` handler returns
`answer` alongside `groundedSources`, `retrievedContext`, and `learnerContext`
(`tutorService.js:169-187`), so the mock's `answer` key happens to match the real field, but
the mock omits `retrievedContext` entirely. The E2E suite therefore cannot detect a regression
in the retrieval-metadata path.

**Other expectations checked against the current UI.** The assertion at `:148` requires the
text `Welcome back` on `/auth`. On `main` that string is the `<h2>` of the **Login** tab
(`src/pages/Auth.tsx:104`) and the default tab state is `"login"`
(`src/pages/Auth.tsx:16`), so the assertion is satisfied on load without clicking Signup. The
same holds in the current dirty working tree. The assertion at `:161` requires the button label
`Create Workspace`, which is present in the Signup tab of both trees. The assertion at `:182`
requires a textarea whose placeholder contains `Ask`, and the button `Ask Tutor`; both are
present in `src/pages/Tutor.tsx`. **No expectation mismatch was found in the E2E spec against
the current frontend.**

**No E2E test covers:** mistake analysis, flashcards, analytics dashboards, the review queue,
the library UI beyond an empty-list check, or the streaming tutor route.
(`async-job-lifecycle.spec.ts` does now cover PDF upload, quiz generation and attempt
submission, so those were removed from this list.)

---

## 9. Coverage baseline

Command: `cd backend && npm run test:coverage` (`node --experimental-vm-modules
node_modules/.bin/jest --coverage`), run with the repository's own configuration.

### Combined run (all 8 backend suites, queue disabled — the repo default)

| Metric | Value |
| :--- | ---: |
| Statements | **14.40%** |
| Branches | **6.31%** |
| Functions | **5.88%** |
| Lines | **15.09%** |
| Tests | 139 passed, 3 skipped, 142 total |
| Suites | 7 passed, 1 skipped, 8 total |
| Exit code | 0 — no threshold to fail |

### What CI actually reports

`.github/workflows/ci.yml:66-67` runs jest with `--testPathPatterns=tests/unit --coverage`.
That is the **unit suites only**, so the coverage figure published as the CI artefact is not the
14.40% combined number. Reproducing that exact command locally:

| Metric | Unit-only |
| :--- | ---: |
| Statements | 5.55% |
| Branches | 5.91% |
| Functions | 4.77% |
| Lines | 5.36% |

Under unit tests alone, **all 10 controllers are at 0.00%** and **all 13 services except
`topicNormalizationService.js` are at 0.00% statements, branches, and functions.**

### Coverage scope

`collectCoverageFrom` (`backend/jest.config.json:7-13`) covers only
`services/**/*.js`, `utils/**/*.js`, and `controllers/**/*.js`, excluding
`services/defaultQuizSeeder.js` and `utils/logger.js`. **Models, routes, middleware,
validation, `worker.js`, `config/`, and the entire frontend are outside the measured set**, so
their coverage is unmeasured rather than zero.

### Enforcement

| Location | Threshold configured? |
| :--- | :--- |
| `backend/jest.config.json` | **No** — no `coverageThreshold` key |
| `vitest.config.ts` | **No** — no `coverage` configuration of any kind |
| `.github/workflows/ci.yml` | **No** — runs coverage and uploads the artefact; zero occurrences of `threshold` |

The prior gate (`branches 70 / functions 75 / lines 80 / statements 80`) was deleted in
`e845d65` ("chore(test): remove global coverage threshold to fix CI"), whose message states the
tests were passing while CI failed on the gate.

**Coverage is measured and not enforced.** This document records the measurement; it does not
propose a threshold.

### Why the percentages understate behaviour further

`learnbuf` and `learningEventService` show 20% statements with **0.00% functions**;
`analyticsService` shows 5.08% statements with 0.00% functions; `flashcardService` shows 6.25%
with 0.00%. In each case the covered statements are the top-level `const x = (…) => {}`
declarations executed at import time, and no function body ever runs. Across `backend/services/`:

| Module | Statements | Branches | Functions |
| :--- | ---: | ---: | ---: |
| `topicNormalizationService.js` | 100.00 | 100.00 | **100.00** |
| `learningEventService.js` | 20.00 | 0.00 | 0.00 |
| `aiQuizService.js` | 14.56 | 0.00 | 0.00 |
| `embeddingService.js` | 14.41 | 0.00 | 0.00 |
| `mistakeAnalysisService.js` | 11.76 | 0.00 | 0.00 |
| `progressService.js` | 13.09 | 0.00 | 0.00 |
| `reviewQueueService.js` | 12.96 | 0.00 | 0.00 |
| `quizService.js` | 6.57 | 0.00 | 0.00 |
| `flashcardService.js` | 6.25 | 0.00 | 0.00 |
| `analyticsService.js` | 5.08 | 0.00 | 0.00 |
| `recommendationService.js` | 0.00 | 0.00 | 0.00 |
| `streamingTutorService.js` | 0.00 | 0.00 | 0.00 |
| `tutorService.js` | 0.00 | 0.00 | 0.00 |

**12 of 13 services have 0.00% function coverage.** One service, out of thirteen, has a
function body executed by any test in the repository.

---

## 10. External-service requirements

Derived from the actual configuration in `backend/jest.config.json`, `vitest.config.ts`,
`playwright.config.ts`, `backend/utils/jobQueue.js`, and `backend/config/env.js`.

| Test surface | MongoDB | Redis | Groq | Browser/Chromium | Worker | Network |
| ------------ | ------: | ----: | ---: | ---------------: | -----: | ------: |
| Frontend unit (`npm test`) | — | — | — | — | — | — |
| Backend unit (`test:unit`) | — | — | — | — | — | — |
| Backend coverage (`test:coverage`, queue disabled) | — | — | — | — | — | — |
| Backend integration, default (`test:integration`) | **required** | — | — | — | — | — |
| Backend integration with `ENABLE_JOB_QUEUE=true` (what CI runs) | **required** | **required** | — | — | **required, real** | — |
| E2E (`test:e2e`) | **required** | not required | — | **required** | not started (queue disabled under `NODE_ENV=test`) | — |

Supporting details:

- **Why backend unit tests need nothing.** `jobQueue.js:8-9` sets `isQueueDisabled` when
  `NODE_ENV=test` and `ENABLE_JOB_QUEUE !== "true"`, so `redisConnection` and `backgroundQueue`
  are `null` and `createJobQueue` returns a synthetic job (`:41-48`) without touching Redis.
  `jobQueue.test.js` does not even use that path — it injects a `queue` whose `add` is a
  `jest.fn()`, so no Redis client is created at all.
- **Why integration needs MongoDB.** `api.test.js:38-46` and `bullmq.test.js:36` both call
  `mongoose.connect()`. Without a reachable server the suites cannot start; the cleanup
  `deleteMany` calls would also fail.
- **Why the BullMQ suite needs Redis *and* the flag.** `bullmq.test.js:14-15` self-skips
  without `ENABLE_JOB_QUEUE=true`, and `:39-47` opens two real `ioredis` clients and awaits
  `worker.waitUntilReady()` and `queueEvents.waitUntilReady()`. With the flag set and Redis
  unreachable, all three tests fail with a 30-second `beforeAll` timeout rather than a fast
  connection error.
- **Why the placeholder Groq key causes no calls.** `config/env.js:8-11` and
  `aiQuizService.js:10-12` only check that `GROQ_API_KEY` is a non-empty string. No test
  reaches `getGroqClient()`, so the placeholder is never transmitted. See §7 for why this must
  not be read as AI coverage.
- **Why E2E needs no Redis.** `playwright.config.ts:27` sets `NODE_ENV=test` without
  `ENABLE_JOB_QUEUE`, so the API process never opens a Redis connection — and consequently
  never runs a worker.
- **No network dependency in any suite** other than the Groq API, which no test reaches. The
  Playwright browser install is a one-time prerequisite, not a per-run dependency.

---

## 11. Testing gaps

Each gap below is a direct consequence of the inventory above.

**Learning core**

1. ~~`applySpacedRepetitionReview` (`flashcardService.js:147-211`) is never executed by any
   test.~~ **Resolved.** `flashcardService.test.js` now imports the production function and
   exercises it, including the per-rating ease, interval and repetition outcomes; the suite
   would no longer pass if the function were deleted.
2. ~~`getDashboardAnalytics` (`analyticsService.js:15-186`) is never executed.~~ **Resolved.**
   `analyticsService.test.js` imports the production module and executes the body against
   stubbed models.
3. ~~`rebuildReviewQueueForUser`, `upsertOpenQueueItem`, `enqueueFailedQuestionItems`,
   `listReviewQueue`, `completeReviewQueueItem`, and `snoozeReviewQueueItem` are never
   executed.~~ **Resolved.** `reviewQueueService.test.js` imports the production module and
   exercises all six against stubbed models. They still do not run against a real collection.
4. ~~`updateUserProgressFromAttempt` and `updateStudyStreak` (`progressService.js:51, 141`)
   are never executed, because no test enqueues `SYNC_ATTEMPT`.~~ **Resolved.**
   `attemptProcessing.test.js` drives both through the real worker path, and
   `attemptSyncTransaction.test.js` additionally runs them inside a real transaction,
   including the rollback case that discards the earlier writes.
5. `getRecommendationSnapshot` (`recommendationService.js:20-160`) is never executed; the file
   is at 0.00% across all metrics and no test mounts `recommendationRoutes`.
6. The two divergent readiness/retention formulas in `analyticsService.js:117, 121` and
   `recommendationService.js:17, 71` are not asserted against each other anywhere.

**AI layer**

7. No test imports `aiQuizService.js` or `streamingTutorService.js`. Every AI function has
   0.00% function coverage.
8. No usable injectable or mock AI provider exists. `backend/tests/mocks/groqMock.js` is
   imported by nothing, is not collected by Jest, and could not be wired in without adding a
   seam, because both services call `new Groq(...)` inline. Its `MOCK_TUTOR_RESPONSE` shape
   also does not match the current tutor response contract.
9. Quiz quality filtering and non-trivial deduplication are on the live upload path: the route
   calls `generateQuiz` (`quizController.js:117`), which filters, de-duplicates and ranks before
   persisting. The 25-case `qualityFilter` suite therefore covers a module a user-facing request
   does execute. (`docs/CLAIM_STATUS.md` previously said otherwise; that was corrected in
   `a0323c9`.)

**Retrieval**

10. `embeddingService.js` has no test. `generateEmbedding`, `cosineSimilarity`,
    `chunkMaterialText`, and `keywordOverlapScore` are never executed, and
    `searchMaterialChunks` is never executed. The only assertion anywhere on this module is
    that a persisted `embedding` array has length 384.
11. No retrieval relevance benchmark exists: no fixture queries, no relevance labels, no
    recall or precision measurement, no latency measurement.

**HTTP and controllers**

12. 4 of 10 controllers are never loaded by any test (`libraryController`, `tutorController`,
    `recommendationController`, `notificationController`), all at 0.00%.
13. 17 handlers in mounted routers are imported but never invoked, including every
    quiz-write path, `saveAttempt`, `generateQuizController`, and every flashcard and
    review-queue mutation.
14. No tenant-isolation test exists. No test creates two users and asserts that one cannot
    read the other's material, quiz, attempt, flashcard, or review-queue item, and no test
    covers the intentional `isDefault` sharing of default quizzes.
15. `healthController.js` is at 0.00% because `api.test.js` mounts `healthRoutes.js`, whose
    handlers are defined inline in the route file. The duplicate handler pair in
    `healthController.js` is dead with respect to testing.

**Worker and background processing**

16. `startWorker` (`worker.js:109-155`) is never executed: `Worker` construction,
    `concurrency: 5`, all three `QueueEvents` listeners, and the SIGINT/SIGTERM graceful
    shutdown are untested.
17. No test exercises the `SYNC_ATTEMPT` job, so the worker's attempt-ownership re-check
    (`worker.js:79-81`) and its non-idempotent counter updates are untested.
18. `worker.js` is not in `collectCoverageFrom`, so its execution is not measured at all.

**Test-infrastructure integrity**

19. 12 of the 21 passing tests in `api.test.js` are silent no-ops because `isDBConnected()` is
    `false` for the whole suite (§6.1). A regression in login, `/auth/me`, the analytics
    dashboard, quiz history, flashcard listing, or the review queue would not fail any test.
20. The default `npm run test:integration` reports success while the entire BullMQ suite is
    skipped, because `backend/package.json:16` does not set `ENABLE_JOB_QUEUE` while
    `ci.yml:70` does. The same command means different things locally and in CI.
21. With the queue enabled and Redis unreachable, the BullMQ suite fails with 30-second hook
    timeouts and `GET /api/v1/health` hangs past its 15-second test timeout, because
    `healthRoutes.js:38` awaits `getJobCounts()` with no timeout guard and the queue client
    retries indefinitely.
22. The E2E suite requires a database on port `27018` by default, which is not where the local
    MongoDB listens, and its worker never runs — so the background pipeline is untested at the
    browser level too.

**Frontend and toolchain**

23. The frontend has one test asserting `expect(true).toBe(true)`. No component, hook, context,
    or `api.ts` test exists. The E2E suite is the only frontend coverage and it never exercises
    quiz generation, attempt submission, flashcards, analytics, or the library.
24. There is no enforced coverage threshold anywhere, and CI publishes the unit-only figure
    (5.55% statements) as the coverage artefact rather than the combined one.
25. `backend/**/*.js` is outside the ESLint configuration (`eslint.config.js:11` scopes
    `files` to `**/*.{ts,tsx}`), and `npm run build` in `backend/` only runs `node --check` on
    two entry files.

---

## 12. Rework Implications

Factual consequences of the inventory above. No ordering, priority, or target is proposed.

1. **The first testing rework should make assertions execute production learning code rather
   than duplicated formulas.** The three re-implementation suites currently provide no signal
   about the shipped modules: `flashcardService.js`, `analyticsService.js`, and
   `reviewQueueService.js` are at 0.00% function coverage. A local copy can only ever verify
   itself, and the mutation check in §4.1 shows that even a copy-level assertion can fail to
   bind to the constant it is named after.
2. **The duplicated suites cannot simply be re-pointed at production as written.**
   `applySpacedRepetitionReview`, `getDashboardAnalytics`, and the `reviewQueueService` exports
   each fuse arithmetic with database I/O in a single exported function, and none exposes a
   pure helper. Whether that shape is changed or the tests supply their own database is a
   decision this document does not make; the current fact is that no pure entry point exists
   to import.
3. **AI functionality needs a provider seam before meaningful offline AI-path tests can
   exist.** All 13 AI-related functions are at 0.00% function coverage. `groqMock.js` is
   unreferenced and unusable as written, because both services construct `new Groq(...)`
   inline. Until a seam exists, the only ways to execute these paths are a live credential or a
   test-only refactor of the production modules.
4. **"CI runs without a working Groq credential" must not be reported as AI coverage.** The
   placeholder key satisfies configuration validation only. No AI path is executed with or
   without it.
5. **Retrieval needs a labelled evaluation set before retriever changes can be compared.**
   `embeddingService.js` has no test of any kind, and the score it returns is a blend of a
   signed-hash cosine and a keyword-overlap ratio. Without fixtures and relevance labels,
   there is currently no quantity against which a future retriever could be compared.
6. **Coverage should be treated as an observed baseline until the important production paths
   have direct tests.** 14.40% statements with 12 of 13 services at 0.00% functions describes
   module loading more than behaviour. Two further distortions should be accounted for when
   reading any future number: the CI artefact reports the unit-only figure (5.55%), and
   `collectCoverageFrom` excludes models, routes, middleware, validation, `worker.js`, and the
   frontend entirely.
7. **The integration suite's green result is currently weaker than it appears.** 12 of its 21
   passes assert nothing, and the BullMQ suite is conditionally absent under the default npm
   script. Any reading of "integration tests pass" should establish which of those two
   conditions applied to the run in question.
8. **Worker coverage is narrower than "BullMQ is tested" suggests.** Only
   `processBackgroundJob` is exercised. `startWorker`, the `QueueEvents` listeners, graceful
   shutdown, and the entire `SYNC_ATTEMPT` path are not — and `worker.js` is outside the
   measured coverage scope, so its execution is not even being counted.
