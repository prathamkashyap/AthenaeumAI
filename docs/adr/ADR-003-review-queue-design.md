# ADR-003: Centralized Review Queue Design

## Context
Learners require a single workspace panel that acts as an "inbox" for pending revisions. Tracking failed questions, weak topics, and due flashcards in separate interfaces results in fragmented user experiences and makes it difficult for recommendations engines to suggest unified actions.

## Decision
We implemented a centralized `ReviewQueue` collection in MongoDB. It stores revision cards containing different source event triggers (e.g. `failed_question`, `due_flashcard`, `weak_topic`). Completed items are marked `completed`, and items can be temporarily `snoozed` by the user.

## Consequences
- **Pros**: Unified UI presentation of revision priorities; simplifies recommendation calculations; permits snoozing individual study activities.
- **Cons**: Requires active database updates. An assessment attempt must update both the attempts collection and push items into the `ReviewQueue` schema, increasing query depth.
- **Future Mitigation**: Rebuilding and managing the review queue will be offloaded to background job workers (e.g., BullMQ) in Sprint 2.
