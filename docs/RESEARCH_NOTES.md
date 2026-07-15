# Academic & Research Notes

This document highlights the academic algorithms and pedagogical concepts underlying AthenaeumAI's assessment pipelines.

---

## 🏛️ Bloom's Taxonomy Calibration
The system targets cognitive revision levels to ensure learners progress beyond rote memory:

```
[Create]       -> Generate study guides, custom questions, synthesis
[Evaluate]     -> Mistake analyses,Distractor review justification
[Analyze]      -> RAG comparison, detail extraction
[Apply]        -> Flashcard review scenarios
[Understand]   -> Conceptual quizzes, rationale explanations
[Remember]     -> Basic term definition checks
```

Rather than raw Easy/Medium/Hard tags, the internal prompt templates structure questions according to cognitive complexity (Recall, Application, Synthesis).

---

## 🃏 Spaced Repetition (SM-2 Algorithm)
Active recall decks implement a modified SM-2 spaced repetition calculation to optimize the forgetting curve:

- **Ease Factor (EF)**: Measures topic difficulty (starts at 2.5).
- **Repetitions (n)**: Consecutive reviews.
- **Interval (I)**: Days before next review is due.

### Interval Assignment Logic
- $n = 1 \implies I = 1 \text{ day}$
- $n = 2 \implies I = 4 \text{ days}$
- $n > 2 \implies I = I_{prev} \times EF_{prev}$

### Ease Factor Modification
Based on the review rating (Again, Hard, Good, Easy):
$$EF_{new} = EF_{prev} + (0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02))$$
Where $q$ represents the numeric quality score mapped from rating keys:
- `easy` $\to 5$
- `good` $\to 4$
- `hard` $\to 3$
- `again` $\to 0$

---

## 🔍 Retrieval-Augmented Generation (RAG)
For the AI Tutor pipeline, AthenaeumAI segments documents into 600-character overlapping chunks.

### Vector Representation (`local-hash-v1`)
To maintain zero-dependency local operation, text chunks are indexed using a multi-hash vector representation:
1. Tokenizes text to clean keywords.
2. Formulates local bag-of-word vector hashes.
3. Ranks relevant chunks using lexical similarity and overlap metrics.
4. Chunks are passed inside LLM context window templates along with the active learner query.
