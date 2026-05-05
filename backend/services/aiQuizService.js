// import Groq from "groq-sdk";

// // Lazy-initialize Groq client to avoid crash when API key is not yet configured
// let groq = null;

// const getGroqClient = () => {
//   if (!process.env.GROQ_API_KEY) {
//     throw new Error("GROQ_API_KEY is not set in environment variables");
//   }
//   if (!groq) {
//     groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
//   }
//   return groq;
// };

// /**
//  * Difficulty-specific prompt configurations.
//  * Controls the style, depth, and trickiness of generated questions.
//  */
// const DIFFICULTY_PROFILES = {
//   Easy: {
//     style: "straightforward recall and basic understanding",
//     depth: "Test direct facts, definitions, and simple concepts from the text.",
//     distractors: "Make wrong options clearly distinguishable but plausible.",
//     temperature: 0.3,
//   },
//   Medium: {
//     style: "application and analysis",
//     depth: "Test ability to apply concepts, compare ideas, and understand relationships between topics.",
//     distractors: "Include at least one tricky distractor that is partially correct but not the best answer.",
//     temperature: 0.4,
//   },
//   Hard: {
//     style: "critical thinking, edge cases, and deep analysis",
//     depth: "Test nuanced understanding, exceptions to rules, and ability to evaluate complex scenarios. Include questions that require synthesizing multiple concepts.",
//     distractors: "Make all distractors highly plausible. At least two should be partially correct. The correct answer should require careful reasoning.",
//     temperature: 0.25,
//   },
// };

// /**
//  * Validates a single question object for correctness.
//  */
// const validateQuestion = (q, index) => {
//   const errors = [];

//   if (!q.question || typeof q.question !== "string" || q.question.trim().length < 10) {
//     errors.push(`Q${index + 1}: Question text is missing or too short`);
//   }

//   if (!Array.isArray(q.options) || q.options.length !== 4) {
//     errors.push(`Q${index + 1}: Must have exactly 4 options`);
//   } else {
//     // Check for duplicate options
//     const unique = new Set(q.options.map((o) => o.toLowerCase().trim()));
//     if (unique.size !== 4) {
//       errors.push(`Q${index + 1}: Contains duplicate options`);
//     }
//     // Check for empty options
//     if (q.options.some((o) => !o || o.trim().length === 0)) {
//       errors.push(`Q${index + 1}: Contains empty options`);
//     }
//   }

//   if (typeof q.answer !== "number" || q.answer < 0 || q.answer > 3) {
//     errors.push(`Q${index + 1}: Answer index must be 0-3, got ${q.answer}`);
//   }

//   return errors;
// };

// /**
//  * Attempts to parse quiz JSON from AI response with multiple strategies.
//  */
// const parseAIResponse = (raw) => {
//   // Strategy 1: Direct JSON array extraction
//   const arrayMatch = raw.match(/\[[\s\S]*\]/);
//   if (arrayMatch) {
//     try {
//       return JSON.parse(arrayMatch[0]);
//     } catch (e) {
//       // Continue to next strategy
//     }
//   }

//   // Strategy 2: Extract from markdown code block
//   const codeBlockMatch = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
//   if (codeBlockMatch) {
//     try {
//       return JSON.parse(codeBlockMatch[1]);
//     } catch (e) {
//       // Continue to next strategy
//     }
//   }

//   // Strategy 3: Try parsing the entire response
//   try {
//     const parsed = JSON.parse(raw);
//     if (Array.isArray(parsed)) return parsed;
//     if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
//     if (parsed.quiz && Array.isArray(parsed.quiz)) return parsed.quiz;
//   } catch (e) {
//     // All strategies failed
//   }

//   return null;
// };

// /**
//  * Generates exam-style MCQs using Groq AI with robust prompting,
//  * validation, and retry logic.
//  *
//  * @param {string} text - Extracted text from the uploaded document
//  * @param {string} difficulty - "Easy" | "Medium" | "Hard"
//  * @param {number} count - Number of questions to generate (default 5)
//  * @returns {Array} Array of validated question objects
//  */
// export const generateQuizFromAI = async (text, difficulty = "Easy", count = 5) => {
//   const profile = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.Easy;
//   const maxRetries = 2;
//   let lastError = null;

//   for (let attempt = 0; attempt <= maxRetries; attempt++) {
//     try {
//       if (attempt > 0) {
//         console.log(`AI generation retry ${attempt}/${maxRetries}...`);
//       }

//       const prompt = `You are an expert examination question creator for university-level assessments (NPTEL, PYQ-style).

// TASK: Generate exactly ${count} multiple-choice questions from the provided study material.

// DIFFICULTY LEVEL: ${difficulty}
// - Question style: ${profile.style}
// - Depth requirement: ${profile.depth}
// - Distractor strategy: ${profile.distractors}

// STRICT RULES:
// 1. Every question MUST be derived ONLY from the provided text — no external knowledge.
// 2. Questions must test ${profile.style} — NOT simple fill-in-the-blank or trivial recall.
// 3. Each question must have exactly 4 options labeled as strings (not A/B/C/D prefixed).
// 4. Exactly ONE option must be correct. The "answer" field is the 0-based index of the correct option.
// 5. All 4 options must be distinct and meaningful — no "None of the above" or "All of the above".
// 6. Include an "explanation" field that briefly explains WHY the correct answer is right and why key distractors are wrong.
// 7. If possible, include a "topic" field identifying the subject area of the question.

// RESPONSE FORMAT — Return ONLY a valid JSON array, no markdown, no explanation outside the JSON:

// [
//   {
//     "question": "What is the primary purpose of...",
//     "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
//     "answer": 2,
//     "explanation": "Option C is correct because... Option A is wrong because...",
//     "topic": "Topic Name"
//   }
// ]

// STUDY MATERIAL:
// ${text.slice(0, 4000)}`;


//       const response = await getGroqClient().chat.completions.create({
//         model: "llama3-70b-8192",
//         messages: [
//           {
//             role: "system",
//             content: "You are a precise exam question generator. You output ONLY valid JSON arrays. No markdown, no explanation text outside the JSON.",
//           },
//           {
//             role: "user",
//             content: prompt,
//           },
//         ],
//         temperature: profile.temperature,
//         max_tokens: 4096,
//       });

//       const raw = response.choices[0]?.message?.content;

//       if (!raw) {
//         throw new Error("Empty response from AI");
//       }

//       console.log(`GROQ response length: ${raw.length} chars (attempt ${attempt + 1})`);

//       // Parse the response
//       const quiz = parseAIResponse(raw);

//       if (!quiz) {
//         throw new Error("Failed to parse JSON from AI response");
//       }

//       if (!Array.isArray(quiz) || quiz.length === 0) {
//         throw new Error("AI returned empty or non-array response");
//       }

//       // Validate each question
//       const allErrors = [];
//       quiz.forEach((q, i) => {
//         const errors = validateQuestion(q, i);
//         allErrors.push(...errors);
//       });

//       if (allErrors.length > 0) {
//         console.warn("Validation warnings:", allErrors);

//         // Auto-fix what we can
//         const fixedQuiz = quiz
//           .filter((q) => {
//             return (
//               q.question &&
//               Array.isArray(q.options) &&
//               q.options.length === 4 &&
//               typeof q.answer === "number" &&
//               q.answer >= 0 &&
//               q.answer <= 3
//             );
//           })
//           .map((q) => ({
//             question: q.question.trim(),
//             options: q.options.map((o) => (typeof o === "string" ? o.trim() : String(o))),
//             answer: q.answer,
//             explanation: q.explanation || "",
//             topic: q.topic || "",
//           }));

//         if (fixedQuiz.length === 0) {
//           throw new Error("No valid questions after validation");
//         }

//         console.log(`Validated: ${fixedQuiz.length}/${quiz.length} questions passed`);
//         return fixedQuiz;
//       }

//       // All valid — normalize and return
//       return quiz.map((q) => ({
//         question: q.question.trim(),
//         options: q.options.map((o) => (typeof o === "string" ? o.trim() : String(o))),
//         answer: q.answer,
//         explanation: q.explanation || "",
//         topic: q.topic || "",
//       }));
//     } catch (err) {
//       lastError = err;
//       console.error(`AI generation attempt ${attempt + 1} failed:`, err.message);

//       if (attempt === maxRetries) {
//         throw new Error(`AI generation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
//       }

//       // Brief delay before retry
//       await new Promise((resolve) => setTimeout(resolve, 1000));
//     }
//   }

//   throw lastError;
// };


import Groq from "groq-sdk";

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
// Chunking (CRITICAL FIX)
// =========================
const chunkText = (text, size = 1200) => {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
};

// =========================
// Difficulty Profiles
// =========================
const DIFFICULTY = {
  Easy: {
    style: "basic understanding and recall",
    temp: 0.3,
  },
  Medium: {
    style: "conceptual + application",
    temp: 0.4,
  },
  Hard: {
    style: "deep reasoning and tricky scenarios",
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
const isValidQuestion = (q) => {
  return (
    q &&
    q.question &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    typeof q.answer === "number" &&
    q.answer >= 0 &&
    q.answer <= 3
  );
};

// =========================
// Prompt Builder (UPGRADED)
// =========================
const buildPrompt = (chunk, difficulty, count) => {
  return `
You are an expert exam paper setter (NPTEL + PYQ style).

TASK:
Generate ${count} HIGH-QUALITY MCQs strictly from the given text.

DIFFICULTY: ${difficulty}

IMPORTANT RULES:
- Use ONLY the given text
- No outside knowledge
- Avoid trivial or obvious questions

QUESTION QUALITY:
- Focus on concepts, not wording
- Include tricky and close distractors
- At least 2 options should be partially correct

CONTENT AWARENESS:
- If definitions → conceptual questions
- If lists → "which is correct/incorrect"
- If advantages → "which is NOT an advantage"
- If comparisons → scenario-based

FORMAT (STRICT JSON ONLY):
[
  {
    "question": "",
    "options": ["", "", "", ""],
    "answer": 0,
    "explanation": "",
    "topic": ""
  }
]
DO NOT convert sentences directly into fill-in-the-blank questions.

Each question MUST:
- require thinking
- NOT be solvable by copying a single line
- test understanding of the concept

BAD EXAMPLE (DO NOT DO):
"Image transformation is a ____ operation"

GOOD EXAMPLE:
"Which of the following best describes the role of image transformation?"

If the content is a heading, list, or syllabus line:
→ Convert it into a conceptual or application-based question.
→ DO NOT keep original sentence structure.

TEXT:
${chunk}
`;
};

// =========================
// Core Generator (Chunk-wise)
// =========================
const generateFromChunk = async (chunk, difficulty, count) => {
  const profile = DIFFICULTY[difficulty] || DIFFICULTY.Easy;

  const response = await getGroqClient().chat.completions.create({
    model: "llama3-70b-8192",
    messages: [
      {
        role: "system",
        content: "Return ONLY JSON array. No markdown.",
      },
      {
        role: "user",
        content: buildPrompt(chunk, difficulty, count),
      },
    ],
    temperature: profile.temp,
    max_tokens: 2048,
  });

  const raw = response.choices[0]?.message?.content;

  if (!raw) throw new Error("Empty AI response");

  const parsed = parseAIResponse(raw);

  if (!parsed) throw new Error("Parsing failed");

  return parsed.filter(isValidQuestion);
};

// =========================
// MAIN FUNCTION (FINAL)
// =========================
export const generateQuizFromAI = async (
  text,
  difficulty = "Easy",
  totalCount = 5
) => {
  try {
    const chunks = chunkText(text);

    // 🔥 Select diverse chunks (not just first ones)
    const selectedChunks = [
      chunks[0],
      chunks[Math.floor(chunks.length / 2)],
      chunks[chunks.length - 1],
    ].filter(Boolean);

    let allQuestions = [];

    for (const chunk of selectedChunks) {
      try {
        const questions = await generateFromChunk(
          chunk,
          difficulty,
          Math.ceil(totalCount / selectedChunks.length)
        );

        allQuestions.push(...questions);
      } catch (err) {
        console.warn("Chunk failed:", err.message);
      }
    }

    // Final trim
    return allQuestions.slice(0, totalCount);
  } catch (err) {
    console.error("AI generation failed:", err.message);
    throw err;
  }
};