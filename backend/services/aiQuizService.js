import Groq from "groq-sdk";
import logger from "../utils/logger.js";

// =========================
// Groq Client (Lazy Init)
// =========================
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

// =========================
// Difficulty Profiles
// =========================
const DIFFICULTY = {
  Easy: {
    temp: 0.3,
  },
  Medium: {
    temp: 0.4,
  },
  Hard: {
    temp: 0.25,
  },
};

// =========================
// JSON Parsing (Robust)
// =========================
const parseAIResponse = (raw) => {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// =========================
// Validation
// =========================
export const VALID_COGNITIVE_LEVELS = new Set(["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]);

export const getDefaultCognitiveLevel = (difficulty) => {
  if (difficulty === "Easy") return "Remember";
  if (difficulty === "Medium") return "Apply";
  return "Evaluate";
};

const isValidQuestion = (q) => {
  const hasValidCognitive = !q.cognitiveLevel || VALID_COGNITIVE_LEVELS.has(q.cognitiveLevel);
  return (
    q &&
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    typeof q.answer === "number" &&
    q.answer >= 0 &&
    q.answer <= 3 &&
    hasValidCognitive
  );
};

const isValidFlashcard = (card) => {
  return (
    card &&
    typeof card.front === "string" &&
    typeof card.back === "string" &&
    card.front.trim().length > 10 &&
    card.back.trim().length > 20
  );
};

const isValidMistakeAnalysis = (item) => {
  return (
    item &&
    typeof item.questionIndex === "number" &&
    typeof item.misconception === "string" &&
    typeof item.clarification === "string" &&
    typeof item.revisionSuggestion === "string"
  );
};

const parseAIObjectResponse = (raw) => {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// =========================
// Prompt Builder (IMPROVED)
// =========================
// const buildPrompt = (text, difficulty, count) => {
//   return `
// You are an expert exam setter (GATE, NPTEL, University exams).

// TASK:
// Generate ${count} HIGH-QUALITY MCQs from the given content.

// DIFFICULTY: ${difficulty}

// Each question MUST:
// - require reasoning, not recall
// - involve elimination between similar options
// - include at least one tricky/confusing option
// - test WHY or HOW, not WHAT

// Prefer questions like:
// - "Why does X happen?"
// - "What would happen if X is changed?"
// - "Which scenario best demonstrates X?"

// STRICT RULES:
// - Use ONLY the given content
// - DO NOT copy sentences directly
// - NO fill-in-the-blanks
// - Questions must test understanding (not memory)
// - Avoid trivial or obvious questions

// QUESTION DESIGN:
// - Focus on concepts, reasoning, and application
// - Include tricky and realistic distractors
// - At least 2 options should appear plausible
// - Avoid options like "All of the above" or "None"

// FORMAT (STRICT JSON ARRAY ONLY):
// [
//   {
//     "question": "",
//     "options": ["", "", "", ""],
//     "answer": 0,
//     "explanation": "",
//     "topic": ""
//   }
// ]

// GOOD QUESTION STYLE:
// "Which of the following best explains why X occurs?"

// BAD QUESTION STYLE:
// "X is defined as ______"

// IMPORTANT:
// - Do NOT reuse sentence structure from input
// - Reframe content into conceptual questions
// - Ensure each question is unique

// Avoid:
// - direct definitions
// - obvious factual recall
// - questions answerable in one glance

// DIFFICULTY RULES:

// Easy:
// - Basic understanding

// Medium:
// - Application or scenario-based

// Hard:
// - Trick questions, edge cases, multi-step reasoning

// CONTENT:
// ${text}
// `;
// };

const buildPrompt = (chunk, difficulty, count) => {
  let cognitivePrompt = "";
  if (difficulty === "Easy") {
    cognitivePrompt = `For "Easy" difficulty, focus on the following Bloom's Taxonomy cognitive levels:
- "Remember" (factual recall, retrieving relevant knowledge)
- "Understand" (conceptual understanding, explaining ideas or concepts)
Each question MUST have "cognitiveLevel" set to either "Remember" or "Understand".`;
  } else if (difficulty === "Medium") {
    cognitivePrompt = `For "Medium" difficulty, focus on the following Bloom's Taxonomy cognitive levels:
- "Apply" (scenarios, using information in another familiar situation)
- "Analyze" (breaking information into parts to explore understandings and relationships)
Each question MUST have "cognitiveLevel" set to either "Apply" or "Analyze".`;
  } else { // Hard
    cognitivePrompt = `For "Hard" difficulty, focus on the following Bloom's Taxonomy cognitive levels:
- "Evaluate" (justifying a stand or decision, critiquing, multi-step deduction)
- "Create" (synthesizing information, designing or constructing new patterns)
Each question MUST have "cognitiveLevel" set to either "Evaluate" or "Create".`;
  }

  return `
You are an expert exam setter (GATE, NPTEL, University exams).

TASK:
Generate ${count} HIGH-QUALITY MCQs from the given content.

DIFFICULTY: ${difficulty}

----------------------------------------
COGNITIVE LEVEL & BLOOM'S TAXONOMY:
----------------------------------------
${cognitivePrompt}

----------------------------------------
CORE REQUIREMENTS:
----------------------------------------

Each question MUST:
- require reasoning, not recall (except for Remember/Understand which can test fundamental concepts)
- involve elimination between similar options
- include at least one tricky/confusing option
- test WHY or HOW, not WHAT

Prefer:
- "Why does X happen?"
- "What would happen if X changes?"
- "Which scenario best demonstrates X?"

----------------------------------------
STRICT RULES:
----------------------------------------

- Use ONLY the given content
- DO NOT copy sentences directly
- DO NOT create fill-in-the-blanks
- Avoid factual recall questions
- Avoid definitions
- Avoid obvious answers
- Avoid repeating similar questions
- Ensure questions are NOT semantically similar to each other.

----------------------------------------
QUESTION DESIGN:
----------------------------------------

- Focus on concepts, reasoning, and application
- At least 2 options must seem correct at first glance
- Only ONE correct answer
- Avoid "All of the above" / "None of the above"

----------------------------------------
OUTPUT FORMAT (STRICT):
----------------------------------------

Return ONLY a valid JSON array.
No explanation text. No markdown. No extra words.

[
  {
    "question": "string",
    "options": ["string", "string", "string", "string"],
    "answer": 0,
    "explanation": "string",
    "topic": "string",
    "cognitiveLevel": "string"
  }
]

----------------------------------------
CONTENT:
----------------------------------------

${chunk}
`;
};

// =========================
// CORE AI CALL (PURE)
// =========================
export const generateQuizFromAI = async (
  text,
  difficulty = "Easy",
  count = 5
) => {
  try {
    const profile = DIFFICULTY[difficulty] || DIFFICULTY.Easy;

    // 🔥 Simple chunking (lightweight)
    const chunkSize = 1500;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    // 🔥 pick diverse chunks
    const selectedChunks = [
      chunks[0],
      chunks[Math.floor(chunks.length / 2)],
      chunks[chunks.length - 1],
    ].filter(Boolean);

    let allQuestions = [];

    for (const chunk of selectedChunks) {
      try {
        const response = await getGroqClient().chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "Return ONLY JSON array. No markdown, no explanation.",
            },
            {
              role: "user",
              content: buildPrompt(chunk, difficulty, Math.ceil(count / selectedChunks.length)),
            },
          ],
          temperature: difficulty === "Hard" ? 0.2 : profile.temp,
          max_tokens: 2048,
        });

        const raw = response.choices[0]?.message?.content;
        const parsed = parseAIResponse(raw);

        if (parsed) {
          const valid = parsed.filter(isValidQuestion).map((q) => ({
            ...q,
            cognitiveLevel: q.cognitiveLevel && VALID_COGNITIVE_LEVELS.has(q.cognitiveLevel)
              ? q.cognitiveLevel
              : getDefaultCognitiveLevel(difficulty),
          }));
          allQuestions.push(...valid);
        }

      } catch (err) {
        logger.warn("Quiz generation chunk failed", { error: err.message });
      }
    }

    // 🔥 remove duplicates
    const unique = [];
    const seen = new Set();

    for (const q of allQuestions) {
      if (!seen.has(q.question)) {
        seen.add(q.question);
        unique.push(q);
      }
    }

    return unique.slice(0, count);

  } catch (err) {
    logger.error("AI quiz generation failed", { error: err.message });
    throw err;
  }
};

export const generateFlashcardsFromAI = async (text, count = 12) => {
  if (!text || text.trim().length < 80) return [];

  const response = await getGroqClient().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Return ONLY a valid JSON array. No markdown, no commentary.",
      },
      {
        role: "user",
        content: `
You are an expert learning scientist building active-recall flashcards.

Generate ${count} high-quality flashcards from the content.

Rules:
- Use ONLY the supplied content.
- Front side should test one concept, relationship, or misconception.
- Back side should be concise but explanatory.
- Prefer conceptual recall over trivia.
- Include a topic label for each card.

Return ONLY this JSON array:
[
  {
    "front": "string",
    "back": "string",
    "topic": "string"
  }
]

CONTENT:
${text.slice(0, 9000)}
`,
      },
    ],
    temperature: 0.25,
    max_tokens: 2048,
  });

  const raw = response.choices[0]?.message?.content || "";
  const parsed = parseAIResponse(raw);
  if (!parsed) return [];

  return parsed
    .filter(isValidFlashcard)
    .map((card) => ({
      front: card.front.trim(),
      back: card.back.trim(),
      topic: String(card.topic || "General").trim() || "General",
    }))
    .slice(0, count);
};

export const generateMistakeAnalysesFromAI = async ({ quizTitle, difficulty, mistakes }) => {
  if (!mistakes?.length) return [];

  const response = await getGroqClient().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Return ONLY a valid JSON array. No markdown, no commentary.",
      },
      {
        role: "user",
        content: `
You are an expert AI tutor analyzing wrong quiz answers.

Quiz: ${quizTitle}
Difficulty: ${difficulty}

For each wrong answer, generate:
- misconception: what misunderstanding likely caused the answer
- clarification: concise conceptual correction
- distractorReason: why the chosen distractor looked plausible
- revisionSuggestion: what to review next
- relatedFlashcards: 2-3 short flashcard prompts

Use ONLY the question, options, correct answer, selected answer, explanation, and topic supplied.

Return ONLY this JSON array:
[
  {
    "questionIndex": 0,
    "topic": "string",
    "misconception": "string",
    "clarification": "string",
    "distractorReason": "string",
    "revisionSuggestion": "string",
    "relatedFlashcards": ["string", "string"]
  }
]

WRONG ANSWERS:
${JSON.stringify(mistakes, null, 2)}
`,
      },
    ],
    temperature: 0.2,
    max_tokens: 2048,
  });

  const raw = response.choices[0]?.message?.content || "";
  const parsed = parseAIResponse(raw);
  if (!parsed) return [];

  return parsed
    .filter(isValidMistakeAnalysis)
    .map((item) => ({
      questionIndex: item.questionIndex,
      topic: String(item.topic || "General").trim() || "General",
      misconception: item.misconception.trim(),
      clarification: item.clarification.trim(),
      distractorReason: String(item.distractorReason || "").trim(),
      revisionSuggestion: item.revisionSuggestion.trim(),
      relatedFlashcards: Array.isArray(item.relatedFlashcards)
        ? item.relatedFlashcards.map((card) => String(card).trim()).filter(Boolean).slice(0, 3)
        : [],
    }));
};

export const generateTutorResponseFromAI = async ({
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

  const response = await getGroqClient().chat.completions.create({
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
  });

  const raw = response.choices[0]?.message?.content || "";
  const parsed = parseAIObjectResponse(raw);
  if (!parsed?.answer) {
    throw new Error("Tutor AI returned invalid response");
  }

  return {
    answer: String(parsed.answer || "").trim(),
    groundedSources: Array.isArray(parsed.groundedSources) ? parsed.groundedSources.slice(0, 5) : [],
    personalizedNotes: Array.isArray(parsed.personalizedNotes) ? parsed.personalizedNotes.slice(0, 5) : [],
    revisionPlan: Array.isArray(parsed.revisionPlan) ? parsed.revisionPlan.slice(0, 6) : [],
    suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps) ? parsed.suggestedFollowUps.slice(0, 5) : [],
  };
};
