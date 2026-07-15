# Known Limitations

This document lists the architectural limitations of the current AthenaeumAI platform. These items serve as key triggers for downstream sprints.

---

## 🔍 Local Hash Vector Representation
- **Limitation**: The current embedding pipeline (`local-hash-v1`) relies on deterministic lexical hashes.
- **Impact**: It lacks semantic understanding (e.g., matching "process states" to "PCB layout" if wording is dissimilar). RAG results may exclude relevant chunks if there is zero keyword overlap.

---

## ⚡ Synchronous Document Indexing
- **Limitation**: PDF text parsing, chunking, hashing, and database writes execute synchronously within the Express route lifecycle.
- **Impact**: Heavy PDF uploads can cause HTTP request timeouts (e.g. if the PDF is 50+ pages) and degrade performance for concurrent users.

---

## ⚙️ Lack of Background Task Runners
- **Limitation**: Tasks like rebuilding the review queue, updating streaks, and calculating recommendation snapshots run in-process on Express routes.
- **Impact**: Server execution paths are blocked, leading to performance variance. There is no job retry or crash-handling queue.

---

## 🧠 Limited Tutor Context Memory
- **Limitation**: The RAG tutoring pipeline only injects prior misconceptions and immediate material chunks.
- **Impact**: There is no long-term chat session window memory. Subsequent user queries do not inherit conversational history.

---

## 💾 Single Instance MongoDB Dependency
- **Limitation**: System operations assume a single-instance MongoDB connection.
- **Impact**: If MongoDB fails, crucial parts of the application (e.g. signup, login, dashboard retrieval, attempts saving) degrade.
