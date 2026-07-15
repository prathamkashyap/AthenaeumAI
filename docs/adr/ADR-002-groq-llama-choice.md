# ADR-002: Choice of Groq and Llama 3 70B for Quiz & Tutor Pipelines

## Context
Generative operations (quiz creation, distractors analysis, tutor answering) must happen quickly to prevent user frustration. Standard LLM hosting providers (e.g. Hugging Face, OpenAI) can suffer from high time-to-first-token latencies, and self-hosting large models requires expensive GPU server capacity.

## Decision
We chose the **Groq SDK** and selected the **Llama 3 70B** model. Groq's custom LPU (Language Processing Unit) architecture delivers extremely high inference speeds (hundreds of tokens per second).

## Consequences
- **Pros**: Quiz generation takes seconds instead of minutes; near-instantaneous tutor answers; Llama 3 70B is highly capable of JSON output formatting.
- **Cons**: Dependency on Groq API limits options if rate limits are hit or service is temporarily down.
- **Future Mitigation**: Implemented a retry and fallback mechanism inside `aiQuizService.js` to handle connection glitches or API failures gracefully.
