/**
 * Deterministic mock implementation of the AI provider interface.
 *
 * This is a stand-in for a *model*, not for a vendor SDK. It speaks the same
 * `{ content }` / `{ content }`-chunk contract that `services/groqProvider.js`
 * produces, so the services under test exercise their real parsing and error
 * handling without a network call or an API key.
 *
 * The fixtures below mirror the shapes the application actually validates
 * against (`aiQuizService.js` and the `Quiz` schema), not a guessed contract:
 * questions carry four options, a 0-3 answer index and a Bloom cognitive level;
 * the tutor response is the `{ answer, groundedSources, ... }` object the service
 * parses rather than the `{ reply, followUpQuestions }` shape an earlier, unused
 * mock invented.
 */

import { jest } from "@jest/globals";

/** A model response body, as raw text exactly as a model would emit it. */
const asContent = (value) => {
  // An already-shaped completion is passed through untouched, so a test can
  // simulate the awkward cases a stringified body could not express, such as a
  // response that arrived with no content at all.
  if (value && typeof value === "object" && !Array.isArray(value) && "content" in value) {
    return value;
  }
  return { content: typeof value === "string" ? value : JSON.stringify(value) };
};

export const MOCK_QUESTIONS = [
  {
    question: "Which scheduling behaviour lets a short process wait behind a long one, and why?",
    options: [
      "Round Robin, because every process gets an equal slice",
      "Priority Scheduling, because the long process outranks the short one",
      "First Come First Served, because the long process arrived first and holds the CPU",
      "Shortest Job First, because the long process is never dispatched",
    ],
    answer: 2,
    explanation: "FCFS serves the queue in arrival order, so a long burst blocks every process queued behind it.",
    topic: "Scheduling",
    cognitiveLevel: "Analyze",
  },
  {
    question: "A process holds a lock while waiting for a second lock held by a waiting process. What is this called?",
    options: ["Starvation", "Deadlock", "Thrashing", "Preemption"],
    answer: 1,
    explanation: "Two processes each hold a resource the other needs, so neither can proceed.",
    topic: "Deadlock",
    cognitiveLevel: "Apply",
  },
  {
    question: "Which paging replacement policy can suffer from thrashing on a small frame allocation?",
    options: ["FIFO", "Optimal", "LRU", "Random"],
    answer: 2,
    explanation: "LRU adapts to locality but can still thrash when the working set exceeds the allocated frames.",
    topic: "Paging",
    cognitiveLevel: "Evaluate",
  },
];

export const MOCK_FLASHCARDS = [
  {
    front: "What causes the convoy effect in FCFS scheduling?",
    back: "A long-running process at the head of the ready queue delays every short process queued behind it, because FCFS is non-preemptive.",
    topic: "Scheduling",
  },
];

export const MOCK_MISTAKE_ANALYSES = [
  {
    questionIndex: 1,
    topic: "Deadlock",
    misconception: "Confusing deadlock with starvation, where a process waits indefinitely for a resource that is never released.",
    clarification: "A deadlock is a circular wait between processes that each hold a resource the other needs; starvation is unfair but unbounded progress elsewhere.",
    distractorReason: "\"Starvation\" also describes indefinite waiting, so it looks plausible without checking whether progress is possible elsewhere.",
    revisionSuggestion: "Re-derive the four Coffman conditions and test each against this scenario.",
    relatedFlashcards: ["List the four Coffman conditions.", "Distinguish deadlock from starvation."],
  },
];

export const MOCK_TUTOR_RESPONSE = {
  answer: "The cycle matters more than the wait: each process holds a resource the other needs. What would change if one process could release its lock early?",
  groundedSources: [
    { sourceNumber: 1, sourceTitle: "Operating Systems Notes", whyRelevant: "Defines circular wait as one of the four deadlock conditions." },
  ],
  personalizedNotes: ["You have twice missed questions on deadlock versus starvation."],
  revisionPlan: ["Re-read the Coffman conditions.", "Try two short quizzes on deadlock."],
  suggestedFollowUps: ["Can you construct a schedule that avoids circular wait?"],
};

/**
 * A provider that always returns the same body.
 * @param {unknown} response A value the model would have produced. Pass an array
 *   of questions/flashcards when the service expects a JSON array body.
 */
export const createMockAIProvider = (response = MOCK_QUESTIONS) => ({
  complete: jest.fn(async () => asContent(response)),
  stream: jest.fn(async function* stream() {
    const body = typeof response === "string" ? response : JSON.stringify(response);
    for (const piece of body.match(/[\s\S]{1,24}/g) || []) {
      yield { content: piece };
    }
  }),
});

/**
 * A provider that returns a different body on each successive call, for
 * exercising paths that make several requests.
 * @param {unknown[]} responses
 */
export const createSequencedAIProvider = (responses) => {
  const queue = [...responses];
  const next = () => (queue.length > 1 ? queue.shift() : queue[0]);
  return {
    complete: jest.fn(async () => asContent(next())),
    stream: jest.fn(async function* stream() {
      yield { content: typeof next() === "string" ? next() : JSON.stringify(next()) };
    }),
  };
};

/**
 * A provider that always rejects, for exercising the application's error paths.
 * Both methods reject when called rather than when iterated, which is how the
 * real provider behaves: opening the stream is an awaited request that can fail.
 */
export const createFailingAIProvider = (error = new Error("Groq API rate limit exceeded")) => ({
  complete: jest.fn(async () => { throw error; }),
  stream: jest.fn(async () => { throw error; }),
});

/** A provider that never settles, for exercising timeout handling. */
export const createHangingAIProvider = () => ({
  complete: jest.fn(() => new Promise(() => {})),
  stream: jest.fn(() => new Promise(() => {})),
});

/** A provider whose completion rejects with a timeout-shaped error. */
export const createTimeoutAIProvider = (ms = 15000) =>
  createFailingAIProvider(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT", timeout: ms }));

export default createMockAIProvider;
