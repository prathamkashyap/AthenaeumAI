/**
 * Groq AI Mock — returns deterministic, pre-defined responses for unit/integration tests.
 * Replace the real Groq SDK with this mock in test environments.
 */

export const MOCK_FLASHCARDS = [
  { front: "What is TCP/IP?", back: "A suite of communication protocols used to interconnect network devices.", topic: "Computer Networks" },
  { front: "What is a deadlock?", back: "A situation where two or more processes are blocked waiting for each other.", topic: "Operating Systems" },
  { front: "What is Big-O notation?", back: "A mathematical notation that describes the limiting behavior of a function.", topic: "Data Structures & Algorithms" },
];

export const MOCK_QUESTIONS = [
  {
    question: "Which layer of the OSI model is responsible for end-to-end communication and error recovery?",
    options: ["Network Layer", "Transport Layer", "Session Layer", "Data Link Layer"],
    answer: 1,
    explanation: "The Transport Layer (Layer 4) is responsible for end-to-end communication, reliability, and error recovery between hosts.",
    topic: "Computer Networks",
    difficulty: "medium",
  },
  {
    question: "What is the time complexity of binary search on a sorted array of n elements?",
    options: ["O(n)", "O(n log n)", "O(log n)", "O(1)"],
    answer: 2,
    explanation: "Binary search halves the search space at each step, resulting in O(log n) time complexity.",
    topic: "Data Structures & Algorithms",
    difficulty: "easy",
  },
  {
    question: "Which scheduling algorithm can lead to the convoy effect in operating systems?",
    options: ["Round Robin", "Shortest Job First", "First Come First Served", "Priority Scheduling"],
    answer: 2,
    explanation: "FCFS can cause the convoy effect where short processes wait behind long ones.",
    topic: "Operating Systems",
    difficulty: "medium",
  },
];

export const MOCK_TUTOR_RESPONSE = {
  reply: "Great question! Let me break this down step by step. The concept you are asking about relates to fundamental principles in computer science.",
  followUpQuestions: [
    "Can you explain how this applies in a real-world scenario?",
    "What are the trade-offs between different approaches?",
  ],
};

/**
 * Creates a mock Groq client that returns deterministic responses.
 */
export const createMockGroqClient = () => ({
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(MOCK_QUESTIONS),
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
      }),
    },
  },
});

/**
 * Creates a mock Groq client that simulates a network failure.
 */
export const createFailingGroqClient = () => ({
  chat: {
    completions: {
      create: jest.fn().mockRejectedValue(new Error("Groq API rate limit exceeded")),
    },
  },
});

export default createMockGroqClient;
