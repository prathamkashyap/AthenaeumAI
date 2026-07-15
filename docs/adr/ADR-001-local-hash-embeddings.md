# ADR-001: Local Hash Vector Representation for Document Retrieval

## Context
AthenaeumAI requires a RAG (Retrieval-Augmented Generation) pipeline to ground tutor responses and quiz generation in user-uploaded documents. Running semantic vector embeddings (like OpenAI text-embedding-3-small) requires external API calls, introducing cost, latency, and dependency vulnerabilities, while local neural models (like sentence-transformers) require PyTorch/Python environments, complicating our Node.js runtime.

## Decision
We implemented a custom, lightweight lexical hashing model (`local-hash-v1`) that runs directly in Node.js. It tokenizes, cleans, and counts term occurrences in text chunks, generating compact vector-like hashes that allow fast keyword-based similarity matching.

## Consequences
- **Pros**: Zero external API dependencies, sub-millisecond execution times, zero runtime installation overhead.
- **Cons**: Lacks semantic awareness. Similarity is limited to lexical keyword overlap. Synonym matching is not supported.
- **Future Mitigation**: We will upgrade this boundary to support a managed embedding model (e.g., E5, Nomic) once production hosting is established.
