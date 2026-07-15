# AthenaeumAI System Report

Generated after implementation of the Adaptive Revision, Recommendation Engine, and Contextual AI Tutor phases.

## 1. Product Architecture Summary

AthenaeumAI is now an AI-powered adaptive learning platform rather than a standalone quiz generator. The system supports authenticated learner workspaces, persistent study materials, persistent material chunks, local vector retrieval, AI-generated assessments, quiz attempts, adaptive mastery scoring, spaced repetition flashcards, review queues, learning event tracking, recommendation generation, AI-assisted mistake analysis, and retrieval-augmented tutoring over uploaded material.

The current architecture is modular and service-oriented:

- Controllers own HTTP request/response concerns.
- Services own business logic, AI orchestration, adaptive scoring, recommendations, and queue generation.
- Models define persistent learning state.
- Frontend pages render backend-driven state and avoid duplicating adaptive logic.

## 2. Backend Architecture Map

### Core Layers

- `server.js`
  - Express app composition
  - CORS and parsing middleware
  - route mounting
  - global error handling

- `routes/`
  - `authRoutes.js`
  - `quizRoutes.js`
  - `libraryRoutes.js`
  - `flashcardRoutes.js`
  - `analyticsRoutes.js`
  - `recommendationRoutes.js`
  - `reviewQueueRoutes.js`
  - `tutorRoutes.js`

- `controllers/`
  - Thin HTTP handlers
  - auth, quiz, library, analytics, flashcards, recommendations, review queue, tutor

- `services/`
  - `quizService.js`: quiz generation orchestration, chunking, retry, ranking, dedupe, fallback
  - `aiQuizService.js`: AI communication, prompt engineering, JSON parsing, AI validation
  - `progressService.js`: weighted mastery, confidence, weakness scoring, streak updates
  - `analyticsService.js`: backend-derived dashboard analytics
  - `flashcardService.js`: flashcard generation, fallback, due queue, spaced repetition
  - `recommendationService.js`: optimal next action, recommended quiz, readiness, review priorities
  - `reviewQueueService.js`: queue item generation, completion, snoozing
  - `learningEventService.js`: normalized learning event writes
  - `mistakeAnalysisService.js`: wrong-answer tutoring orchestration
  - `embeddingService.js`: material chunking, local vector embedding, semantic retrieval
  - `tutorService.js`: RAG orchestration over material chunks, weak topics, mistakes, and flashcards

- `models/`
  - `User`
  - `Quiz`
  - `QuizAttempt`
  - `StudyMaterial`
  - `FlashcardSet`
  - `UserProgress`
  - `LearningEvent`
  - `ReviewQueue`
  - `MaterialChunk`

## 3. Database Schema Report

### User

Stores authenticated learner identity and profile.

Important fields:

- `name`
- `email`
- `passwordHash`
- `profile`
- `streak.current`
- `streak.longest`
- `streak.lastStudyDate`

### StudyMaterial

Persistent uploaded source material.

Important fields:

- `user`
- `title`
- `originalFileName`
- `storagePath`
- `tags`
- `extractedText`
- `textPreview`
- `linkedQuizzes`
- `linkedFlashcardSets`

### MaterialChunk

Persistent retrieval unit for RAG.

Important fields:

- `user`
- `studyMaterial`
- `chunkIndex`
- `chunkText`
- `textPreview`
- `embedding`
- `embeddingModel`
- `tokenEstimate`
- `sourceTitle`
- `topics`
- `metadata`

Current embedding backend is `local-hash-v1`, a deterministic local vector representation. It keeps RAG functional without requiring a separate embedding API, while leaving the service boundary ready for a future external embedding provider.

### Quiz

Generated or default assessment.

Important fields:

- `user`
- `studyMaterial`
- `title`
- `difficulty`
- `questions`
- `attempts`

The embedded `attempts` array remains for compatibility, while detailed attempt intelligence is stored in `QuizAttempt`.

### QuizAttempt

Normalized attempt record.

Important fields:

- `user`
- `quiz`
- `studyMaterial`
- `score`
- `total`
- `accuracy`
- `difficulty`
- `durationSeconds`
- `answers`
- `mistakeAnalyses`

### UserProgress

Adaptive mastery model.

Important topic fields:

- `attempted`
- `correct`
- `mastery`
- `weaknessScore`
- `confidence`
- `reviewCount`
- `lastWrongAt`
- `lastPracticedAt`
- `recommendedDifficulty`

Mastery is weighted using accuracy, recency, and confidence rather than raw correctness alone.

### FlashcardSet

AI-generated or fallback-generated recall decks.

Important card review fields:

- `nextReviewAt`
- `easeFactor`
- `interval`
- `repetitions`
- compatibility fields: `dueAt`, `ease`, `intervalDays`

### LearningEvent

Append-only intelligence dataset.

Event types:

- `quiz_attempt`
- `flashcard_review`
- `recommendation_followed`
- `revision_completed`
- `ai_tutoring_interaction`

Important fields:

- `user`
- `subject`
- `topic`
- `eventType`
- `result`
- `confidence`
- `difficulty`
- `metadata`

### ReviewQueue

Actionable revision queue.

Item types:

- `weak_topic`
- `failed_question`
- `due_flashcard`
- `low_confidence_topic`
- `overdue_review`

Important fields:

- `priority`
- `dueAt`
- `status`
- `source`
- `metadata`

## 4. API Endpoint Inventory

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Quiz

- `POST /api/quiz/generate`
- `GET /api/quiz/history`
- `GET /api/quiz/subjects`
- `GET /api/quiz/subject/:subject`
- `GET /api/quiz/:id`
- `POST /api/quiz/:id/attempt`

### Library

- `GET /api/library`
- `GET /api/library/:id`
- `PATCH /api/library/:id`

### Flashcards

- `GET /api/flashcards`
- `GET /api/flashcards/due`
- `POST /api/flashcards/generate`
- `POST /api/flashcards/:setId/cards/:cardId/review`

### Analytics

- `GET /api/analytics/dashboard`

### Recommendations

- `GET /api/recommendations/dashboard`
- `POST /api/recommendations/follow`

### Review Queue

- `GET /api/review-queue`
- `POST /api/review-queue/rebuild`
- `POST /api/review-queue/:id/complete`
- `POST /api/review-queue/:id/snooze`

### Tutor

- `POST /api/tutor/ask`
- `POST /api/tutor/materials/:materialId/reindex`

## 5. Adaptive Learning Pipeline

Current learning loop:

1. User uploads material.
2. Text is extracted and persisted as `StudyMaterial`.
3. AI quiz generation runs through the protected quiz pipeline.
4. Material chunks are indexed for retrieval.
5. User attempts quiz.
6. Attempt is saved as `QuizAttempt`.
7. Incorrect answers are analyzed by AI mistake analysis.
8. `UserProgress` updates mastery, confidence, weakness, and recommended difficulty.
9. `LearningEvent` records normalized learning behavior.
10. `ReviewQueue` receives failed questions, weak topics, low-confidence topics, and due flashcards.
11. `recommendationService` generates the learner's next best action.
12. Tutor requests retrieve material chunks, weak topics, prior mistakes, and related flashcards.
13. Dashboard and Tutor render backend intelligence.

## 6. AI Generation Workflow

### Quiz Generation

PDF to quiz:

1. extract text
2. clean text
3. chunk text
4. select distributed chunks
5. call Groq via `aiQuizService`
6. parse JSON
7. validate question structure
8. filter low-quality questions
9. semantic dedupe
10. rank questions
11. persist quiz and material

### Flashcard Generation

Sources:

- quiz questions
- material text
- weak topics

Fallback sequence:

1. AI-generated flashcards
2. quiz-question fallback
3. source-text fallback

### Mistake Analysis

When a learner answers incorrectly:

1. wrong answers are normalized
2. AI analyzes misconception and distractor plausibility
3. fallback tutoring text is used if AI fails
4. revision queue items are created
5. result page displays tutoring feedback

### Contextual Tutor

Tutor request flow:

1. learner asks a question
2. optional material filter is applied
3. `embeddingService` ensures chunks exist for the learner's material
4. query embedding is generated
5. material chunks are ranked by vector similarity plus lexical overlap
6. weak topics are retrieved from `UserProgress`
7. prior misconception records are retrieved from `QuizAttempt`
8. related flashcards are retrieved from `FlashcardSet`
9. `aiQuizService` generates a grounded tutoring response
10. fallback response uses the best retrieved source if AI fails
11. `LearningEvent` records `ai_tutoring_interaction`

The tutor returns:

- answer
- grounded sources
- personalized notes
- revision plan
- suggested follow-ups
- retrieved context previews

## 7. Recommendation System Flow

`recommendationService.js` reads:

- `UserProgress`
- `QuizAttempt`
- `FlashcardSet`
- `ReviewQueue`
- available quizzes

It returns:

- readiness score
- retention trend
- due review count
- weakest topic
- low-confidence topic
- recommended quiz
- suggested revision
- optimal next action
- continue studying target
- top review queue items

This keeps adaptive decision-making centralized on the backend.

## 8. Analytics Engine Flow

`analyticsService.js` computes:

- quiz totals
- average accuracy
- average mastery
- average confidence
- retention score
- estimated readiness
- accuracy trend
- topic mastery
- weak topics
- due flashcard count
- dashboard highlights

The analytics layer is currently computed dynamically per request. This is acceptable for early scale but should eventually move to cached snapshots.

## 9. Frontend Architecture Map

### Contexts

- `AuthContext`
  - token session
  - current user
  - login/signup/logout

- `QuizContext`
  - active quiz lifecycle
  - generation state
  - quiz fetch
  - attempt save
  - result continuity

### API Helper

- `src/lib/api.ts`
  - centralized API root
  - auth headers
  - expired session handling

### Pages

- `Auth`
- `Index`
- `Upload`
- `Assessments`
- `CreateAssessment`
- `AttemptAssessment`
- `ResultAssessment`
- `Analytics`
- `Flashcards`
- `Tutor`
- `Quiz`

Frontend adaptive displays are backend-driven. The frontend does not recompute mastery, weakness, readiness, or recommendations.

## 10. Dashboard Intelligence

Homepage now displays backend-derived:

- Continue Studying
- Recommended Quiz
- Weakest Topic
- Review Due Today
- Readiness Score
- Suggested Revision
- Retention signal
- High priority recommendation

This makes the dashboard an adaptive command center rather than a static metrics page.

## 11. Current Production Readiness

Strong:

- modular backend layering
- AI isolation
- persistence
- authenticated user scope
- adaptive scoring foundation
- review queue foundation
- learning event dataset
- spaced repetition support
- retrieval-augmented tutoring
- persistent material chunk index
- grounded source previews in tutor responses

Partial:

- no background jobs yet
- analytics computed live
- no embedding-based semantic dedupe for flashcards
- local hash embeddings should eventually be upgraded to a dedicated embedding model
- no production token refresh/session rotation
- no deployment-specific observability

## 12. Future Scaling Considerations

Recommended next infrastructure upgrades:

- background job runner for recommendation rebuilding
- cached analytics snapshots
- indexes tuned against real MongoDB query plans
- AI request queue and per-plan quotas
- managed vector index for material chunks
- higher-quality embedding provider
- semantic topic graph across chunks, mistakes, and flashcards
- event stream aggregation
- websocket or polling update channel for long-running generation
- deployment split between frontend, API, database, file storage, and worker processes

## 13. Next Frontier

The next major evolution should be:

- Socratic hint chains
- exam simulation mode
- long-term learner memory model
- semantic concept graph
- streaming tutor responses
- citations linked directly to material pages/chunks

AthenaeumAI is now structurally positioned to become intelligent educational infrastructure rather than a feature collection.
