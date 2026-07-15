import Groq from "groq-sdk";
import logger from "../utils/logger.js";

let groq = null;

const getGroqClient = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }
  if (!groq) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
};

export const streamTutorResponse = async ({
  question,
  materialContexts,
  weakTopics,
  mistakeHistory,
  flashcards,
}) => {
  const contextText = materialContexts.map((context, index) => (
    `[SOURCE ${index + 1}]
Title: ${context.sourceTitle}
Chunk: ${context.chunkIndex}
Similarity: ${context.score}
Text: ${context.chunkText}`
  )).join("\n\n");

  const stream = await getGroqClient().chat.completions.create({
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
    max_tokens: 2500,
    stream: true,
  });

  return stream;
};
