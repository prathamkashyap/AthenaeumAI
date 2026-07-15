# AthenaeumAI API Reference

All requests and responses use JSON. Versioned endpoints are mounted under `/api/v1/...` alongside unversioned compatibility aliases under `/api/...`.

---

## 🔐 Authentication

### POST `/api/v1/auth/signup`
Creates a new learner workspace.
- **Request Body**:
  ```json
  {
    "name": "Pratham Kashyap",
    "email": "learner@athenaeum.ai",
    "password": "securepassword123",
    "program": "Computer Science",
    "semester": "8"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "user": {
      "id": "user_id_here",
      "name": "Pratham Kashyap",
      "email": "learner@athenaeum.ai"
    },
    "token": "jwt_token_here"
  }
  ```

### POST `/api/v1/auth/login`
Authenticates existing credentials.
- **Request Body**:
  ```json
  {
    "email": "learner@athenaeum.ai",
    "password": "securepassword123"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "user": { "id": "...", "name": "...", "email": "..." },
    "token": "..."
  }
  ```

### GET `/api/v1/auth/me`
Fetches authenticated session profile. Requires `Authorization: Bearer <token>`.

---

## 📝 Quiz Generation & Attempts

### POST `/api/v1/quiz/generate`
Uploads study material and triggers AI quiz generation. Requires multipart/form-data.
- **Form Data**:
  - `file`: PDF document (max 10MB)
  - `difficulty`: `"Easy" | "Medium" | "Hard"` (default: `"Easy"`)
  - `count`: Integer between 1 and 20 (default: `5`)
  - `tags`: Optional comma-separated tag list
- **Response (200 OK)**:
  ```json
  {
    "quizId": "quiz_id",
    "materialId": "material_id",
    "title": "Operating Systems Paging",
    "difficulty": "Easy",
    "questionCount": 5,
    "quiz": [
      {
        "question": "What is paging?",
        "options": ["A memory management scheme", "A CPU scheduling algorithm", "A disk format", "A network protocol"],
        "answer": 0,
        "explanation": "Paging is a memory management scheme...",
        "topic": "Memory Management"
      }
    ]
  }
  ```

### POST `/api/v1/quiz/:id/attempt`
Submits answers, calculates scores, runs distractor tutoring analyses, and records progress events.
- **Request Body**:
  ```json
  {
    "score": 4,
    "total": 5,
    "answers": [0, 1, 2, 0, 1],
    "durationSeconds": 145
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "message": "Attempt saved",
    "attemptId": "attempt_id",
    "mistakeAnalyses": [
      {
        "questionIndex": 1,
        "selectedOption": 1,
        "misconceptionAnalysis": "The user confused segmentation with paging..."
      }
    ],
    "attemptCount": 1,
    "bestScore": 80
  }
  ```

### GET `/api/v1/quiz/history`
Lists learner attempts. Supports query params `page` (default: 1) and `limit` (default: 20).

---

## 🗄️ Library

### GET `/api/v1/library`
Lists uploaded study material. Supports search query `?search=paging`.

### GET `/api/v1/library/:id`
Fetches detail, linked assessments, and linked flashcard decks for a given material.

### PATCH `/api/v1/library/:id`
Updates material title and tags.
- **Request Body**:
  ```json
  {
    "title": "Updated Title",
    "tags": ["OS", "Memory"]
  }
  ```

---

## 🃏 Flashcards

### POST `/api/v1/flashcards/generate`
Generates a new active recall flashcard set.
- **Request Body**:
  ```json
  {
    "sourceType": "weak-topics" | "quiz" | "material",
    "sourceId": "source_id_required_if_quiz_or_material",
    "count": 12
  }
  ```

### POST `/api/v1/flashcards/:setId/cards/:cardId/review`
Submits a review grade to update spaced repetition intervals.
- **Request Body**:
  ```json
  {
    "rating": "again" | "hard" | "good" | "easy"
  }
  ```

---

## 🤖 Contextual AI Tutor

### POST `/api/v1/tutor/ask`
Asks the RAG grounded study tutor.
- **Request Body**:
  ```json
  {
    "question": "Can you explain how thrashing differs from basic paging?",
    "materialId": "optional_material_id"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "answer": "Thrashing is a state where the CPU spends more time paging than executing...",
    "sources": [
      {
        "materialTitle": "Operating Systems Paging",
        "preview": "Thrashing occurs when the page fault rate is very high..."
      }
    ],
    "suggestedFollowUps": [
      "What causes a page fault?",
      "How does a working set model prevent thrashing?"
    ]
  }
  ```

### POST `/api/v1/tutor/ask/stream`
Asks the Socratic study tutor using Server-Sent Events (SSE) real-time streaming.
- **Request Body**:
  ```json
  {
    "question": "Can you explain how thrashing differs from basic paging?",
    "materialId": "optional_material_id"
  }
  ```
- **Response (200 OK)**:
  Returns a Server-Sent Events stream (`text/event-stream`). Sends raw text chunks of the answer as they are generated:
  ```text
  data: Th
  data: rash
  data: ing
  data:  is
  data:  a
  ...
  data: [DONE]
  ```

---

## 🏥 Health & Monitoring

### GET `/api/v1/health`
Returns comprehensive system diagnostics and metrics. Public endpoint (no authentication required).
- **Response (200 OK when healthy, 503 Service Unavailable when degraded)**:
  ```json
  {
    "status": "ok",
    "uptime": 242.15,
    "timestamp": "2026-06-16T13:42:00.000Z",
    "version": "1.7.0",
    "environment": "production",
    "memory": {
      "rss": 82.5,
      "heapUsed": 44.12,
      "heapTotal": 68.31
    },
    "database": {
      "state": 1,
      "label": "connected"
    },
    "requestCount": 105,
    "startedAt": "2026-06-16T13:38:00.000Z"
  }
  ```

### GET `/api/v1/health/ready`
Lightweight readiness probe for load balancers and orchestrators. Returns `200 OK` if the database is fully connected, otherwise `503 Service Unavailable`. Public endpoint (no authentication required).
- **Response (200 OK)**:
  ```json
  {
    "status": "ready"
  }
  ```
- **Response (503 Service Unavailable)**:
  ```json
  {
    "status": "not_ready"
  }
  ```
