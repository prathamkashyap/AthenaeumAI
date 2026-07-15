# Changelog

All notable changes to the AthenaeumAI project will be documented in this file.

---

## [1.9.0] - 2026-06-16
### Added
- Created a comprehensive programmatic, zero-cost database seeder (`backend/scripts/seedDemo.js`) simulating a 30-day completed student journey (12 quiz attempts, 3 materials, 3 flashcard decks, 15 review queue items, weak topics, and tutor conversations).
- Created a seed verification command (`backend/scripts/verifyDemo.js`) running database schema count assertions.
- Created a smoke test suite (`backend/scripts/smokeTest.js`) verifying local DB status, health endpoint JSONs, login responses, and protected routes.
- Created a dedicated troubleshooting guide (`docs/TROUBLESHOOTING.md`) documenting database connections, environment variables, port conflicts, and seeder results.
- Expanded the Playwright E2E test suite (`tests/e2e/flow.spec.ts`) to include API route mocking, PDF upload flows, tutor chats, and dashboard UI validations.

---

## [1.8.0] - 2026-06-16
### Added
- Upgraded the AI tutor endpoint to support real-time streaming using Server-Sent Events (SSE) at `/api/v1/tutor/ask/stream`.
- Implemented public health check endpoints `/api/v1/health` and `/api/v1/health/ready` providing diagnostics (uptime, memory, database connection state, request count, and start time).
- Integrated request counter middleware and start time tracking in `server.js`.
- Implemented graceful shutdown handles for SIGTERM/SIGINT signals to close the HTTP server and drain Mongoose connections cleanly.
- Upgraded spaced repetition flashcards to use the SM-2+ algorithm.
- Enhanced tutor system prompts with Socratic hint-chain pedagogy.

---

## [1.7.0] - 2026-06-09
### Added
- Created `backend/services/topicNormalizationService.js` to normalize noisy/redundant topic tags.
- Integrated topic normalization in `quizService.js`, `quizController.js`, `progressService.js`, and `learningEventService.js`.
- Implemented Bloom's Taxonomy cognitive calibration on quiz generation. Added `cognitiveLevel` validation matching Easy ("Remember", "Understand"), Medium ("Apply", "Analyze"), and Hard ("Evaluate", "Create") levels.
- Updated Mongoose `Quiz.js` schema with the `cognitiveLevel` field.
- Upgraded `backend/utils/qualityFilter.js` to support detailed quality scoring (0 to 10) evaluating ambiguity, empty/short options, duplicate options, and short explanation string sizes.
- Configured a threshold rejection filter to filter out any generated questions scoring below 5.0 in the generation pipeline.

---

## [1.6.0] - 2026-06-09
### Added
- Added compound indexes on `UserProgress`, `ReviewQueue`, and `QuizAttempt`.
- Implemented cascading soft deletes using `deletedAt` filtering middleware on `Quiz`, `StudyMaterial`, and `FlashcardSet` models.
- Exposed paginated review queue and flashcard list endpoints.
- Implemented a zero-dependency async background queue (`JobQueue`) for offloading heavy tasks like PDF parsing.

---

## [1.5.0] - 2026-06-09
### Added
- Reorganized codebase documentation structure under a centralized `/docs` directory.
- Archived original `SYSTEM_REPORT.md` into `docs/archive/SYSTEM_REPORT_v1.md`.
- Moved `AthenaeumAI_Report.tex` to `docs/REPORT/AthenaeumAI_Report.tex`.
- Created initial Architecture Decision Records (ADRs) under `docs/adr/`.
- Created `docs/KNOWN_LIMITATIONS.md` outlining system-level bottlenecks.

---

## [1.4.0]
### Added
- Contextual AI Tutor implementing Retrieval-Augmented Generation (RAG) over uploaded course materials.
- Local vector retrieval index for document chunks.
- Weak topic tracking and mistake analysis feedback loop on assessment views.

---

## [1.3.0]
### Added
- Centralized Review Queue sorting failed questions, low confidence subjects, and overdue reviews.
- Spaced Repetition flashcards interface supporting interval calculations.
