import logger from "../utils/logger.js";
import { getAIProvider } from "./aiProvider.js";
import {
  evaluateTutorGrounding,
  insufficientContextResponse,
} from "./tutorGrounding.js";

/**
 * The refusal stream, as a plain async iterable of `{ content }` chunks.
 *
 * Returning a stream rather than throwing keeps the HTTP contract identical to a
 * successful tutoring response: the controller still sets the event-stream
 * headers, still iterates, and still writes `[DONE]`, so a refusal needs no
 * controller change and cannot surface as a client-side error. It is the same
 * payload the non-streaming path returns, JSON-encoded, so both paths hand the
 * client one refusal document.
 */
const refusalStream = (payload) => (async function* refuse() {
  yield { content: JSON.stringify(payload) };
})();

export const streamTutorResponse = async ({
  question,
  materialContexts,
  weakTopics,
  mistakeHistory,
  flashcards,
}) => {
  // Same decision, same module, same result as the non-streaming tutor. The gate
  // sits before the provider is touched, so an ungrounded question cannot reach
  // the model on either path.
  const grounding = evaluateTutorGrounding(materialContexts);

  if (!grounding.grounded) {
    logger.info("Tutor stream refused without calling the model: no retrieved evidence", {
      reason: grounding.reason,
      consideredCount: grounding.consideredCount,
    });

    return refusalStream(
      insufficientContextResponse({ question, grounding: { ...grounding, streamed: true } }),
    );
  }

  const contextText = materialContexts.map((context, index) => (
    `[SOURCE ${index + 1}]
Title: ${context.sourceTitle}
Chunk: ${context.chunkIndex}
Similarity: ${context.score}
Text: ${context.chunkText}`
  )).join("\n\n");

  const stream = await getAIProvider().stream({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are AthenaeumAI Tutor, a Socratic teaching assistant. You help the user learn by guiding them with hints and leading questions rather than giving immediate, direct answers or solutions. Answer only from the provided context. Return strict JSON.",
      },
      {
        role: "user",
        content: `
The learner asks:
${question}

Use the uploaded material context and learner profile below.

Rules:
- Adopt a strict Socratic teaching style. Never give the direct solution or final answer immediately if the user is asking for a solution to an exercise or problem. Instead:
  1. Break down the core concept and explain the underlying principles using scaffolding.
  2. Provide a constructive hint or intermediate steps to guide the user's reasoning.
  3. Ask a thought-provoking leading question at the end of the answer that prompts the user to take the next logical step.
- Ground all explanations and concepts in the provided sources.
- If context is insufficient, explain what is missing and suggest a Socratic study strategy.
- Personalize using weak topics and prior mistakes when relevant.
- Be clear, educational, and engaging.
- Avoid inventing facts not supported by context.

Return ONLY a JSON object:
{
  "answer": "string", // Structured as a Socratic hint/explanation ending with a leading question
  "groundedSources": [{"sourceNumber": 1, "sourceTitle": "string", "whyRelevant": "string"}],
  "personalizedNotes": ["string"],
  "revisionPlan": ["string"],
  "suggestedFollowUps": ["string"] // Under Socratic tutoring, suggested followups should be thought-provoking queries
}

UPLOADED MATERIAL CONTEXT:
${contextText || "No matching uploaded material chunks were found."}

WEAK TOPICS:
${JSON.stringify(weakTopics, null, 2)}

RECENT MISTAKES:
${JSON.stringify(mistakeHistory, null, 2)}

RELATED FLASHCARDS:
${JSON.stringify(flashcards, null, 2)}
`,
      },
    ],
    temperature: 0.2,
    maxTokens: 2500,
  });

  return stream;
};
