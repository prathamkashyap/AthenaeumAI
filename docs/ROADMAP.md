# AthenaeumAI Roadmap

This document outlines completed milestones, current activities, and future milestones for AthenaeumAI.

---

## 🏛️ Documentation Policy

Every feature merge must update:
- **`README.md`**: If user-facing functionalities are added, modified, or set up steps change.
- **`docs/ARCHITECTURE.md`**: If system-changing services, schemas, or pipelines are introduced.
- **`docs/API_REFERENCE.md`**: If endpoints, request payloads, or responses are added or updated.
- **`docs/CHANGELOG.md`**: Must always be updated with changes grouped under version tags.
- **`docs/ROADMAP.md`**: Move items across completed, in progress, and upcoming states.

---

## 🏁 Sprints & Phases

### Sprint 1: Governance & Backend Stabilization (Completed)
- **Sprint 1A - Governance [Completed]**: Reorganized docs directory, trimmed README, created ADRs and KNOWN_LIMITATIONS.md.
- **Sprint 1B - Infrastructure [Completed]**: Added Winston logger, correlation IDs, environment validation, custom errors, and API versioning.
- **Sprint 1C - Validation [Completed]**: Implemented Zod request schemas and metadata validation middleware.
- **Sprint 1D - Cleanup [Completed]**: Replaced console logs with Winston logs.

---

### Sprint 2: Database & Performance Optimization (Completed)
- **Index Tuning [Completed]**: Optimized Mongoose queries via compound indexes.
- **Soft Deletes [Completed]**: Added `deletedAt` filtering middleware to models.
- **Pagination [Completed]**: Supported pagination on review queue and flashcard sets.
- **Background Jobs [Completed]**: Offloaded PDF parsing and post-attempt triggers to an in-memory job queue.

---

### Sprint 3: AI Quality & Semantic Refinement (Completed)
- **Topic Normalization [Completed]**: Canonical mapping for noisy topic strings.
- **Bloom Taxonomy Calibration [Completed]**: Question calibration with cognitive taxonomy (Remember, Understand, Apply, Analyze, Evaluate, Create) and validation.
- **Quiz Quality Scoring [Completed]**: Multi-criteria 0-10 scoring and rejection threshold (5.0).

---

### Sprint 4: Advanced Tutoring & Production Readiness (Completed)
- **Socratic Tutoring Prompt [Completed]**: Enforced Socratic hint-chain pedagogy in the AI tutor.
- **SM-2+ Spaced Repetition [Completed]**: Upgraded the flashcard intervals to the SM-2+ algorithm.
- **SSE Streaming tutor [Completed]**: Real-time server-sent events for AI tutor responses.
- **Health & Monitoring [Completed]**: Uptime, request logging/counting, and database connection state monitoring.
- **Graceful Shutdown [Completed]**: Safe draining of database connections on SIGTERM/SIGINT signals.

---

### Sprint 5: Automated Testing & Quality Assurance (Next)
- **Unit Testing**: 80%+ test coverage target for TopicNormalizationService, QualityFilter, SM-2+ Scheduler, ReviewQueueService, and AnalyticsService.
- **API Integration Testing**: Auth, Quiz Generation, Flashcards, Tutor, Analytics, and Review Queue router validations.
- **Regression Testing**: Establishing regression suite pipelines for database and runtime error vectors.

---

### Sprint 6: Security & Production Hardening (Planned)
- **Helmet**: Standard security headers configuration.
- **Rate Limiting**: Protect auth, tutor, and quiz endpoints.
- **Refresh Tokens**: Migrate single JWTs to rotated access/refresh pairs.
- **Audit Logging**: Winston logs with audit trails.

---

### Sprint 7: Persistent Infrastructure (Planned)
- **Redis & BullMQ**: Transition to distributed persistent queues.
- **Object Storage**: S3/R2 storage integration for source PDFs.

---

### Sprint 8: Learning Intelligence (Planned)
- **Knowledge Graph**: Cognitive topic mapping and prerequisite analysis.
- **Predictive Analytics**: Exam readiness forecasts.

---

### Sprint 9: Real Vector RAG (Planned)
- **Qdrant Vector Database**: Full semantic vector search for material retrieval.

---

### Sprint 10: Deployment & DevOps (Planned)
- **Dockerization**: Multiple container builds for services.
- **Monitoring & Sentry**: Prometheus, Grafana, and error tracking integration.

---

### Sprint 11: Research & Publication (Planned)
- **Evaluation Framework**: Retention improvements, mastery metrics, and comparative evaluation sheets.
