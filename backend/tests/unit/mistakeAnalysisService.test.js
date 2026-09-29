/**
 * Contract Tests — mistake analysis against the provider seam
 *
 * This is the path the `SYNC_ATTEMPT` worker takes when an attempt has no stored
 * analyses, so its failure behaviour matters: a learner waiting on a quiz must
 * still get an analysis even when the model is unavailable. The fallback is
 * therefore tested as carefully as the model-backed branch.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createFailingAIProvider,
  createHangingAIProvider,
} from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";

const { analyzeMistakesForAttempt } = await import("../../services/mistakeAnalysisService.js");

const QUIZ = {
  _id: "quiz-1",
  title: "Operating Systems Fundamentals",
  difficulty: "Medium",
  questions: [
    {
      question: "Which scheduling behaviour lets a short process wait behind a long one?",
      options: ["Round Robin", "Priority Scheduling", "First Come First Served", "Shortest Job First"],
      explanation: "FCFS is non-preemptive and serves in arrival order.",
      topic: "Scheduling",
    },
    {
      question: "A process holds a lock while waiting for a second lock. What is this?",
      options: ["Starvation", "Deadlock", "Thrashing", "Preemption"],
      explanation: "Two processes each hold what the other needs.",
      topic: "Deadlock",
    },
  ],
};

const answers = [
  { questionIndex: 0, selected: 0, correct: 2, isCorrect: true, topic: "Scheduling" },
  { questionIndex: 1, selected: 0, correct: 1, isCorrect: false, topic: "Deadlock" },
];

const run = (overrides = {}) =>
  analyzeMistakesForAttempt({ quiz: QUIZ, normalizedAnswers: answers, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  resetAIProvider();
});

describe("analyzeMistakesForAttempt", () => {
  test("analyses only the wrong answers", async () => {
    const provider = createMockAIProvider([{
      questionIndex: 1,
      topic: "Deadlock",
      misconception: "Confusing deadlock with starvation.",
      clarification: "A deadlock is a circular wait.",
      distractorReason: "Starvation also means waiting indefinitely.",
      revisionSuggestion: "Re-derive the Coffman conditions.",
      relatedFlashcards: ["List the conditions."],
    }]);
    setAIProvider(provider);

    const analyses = await run();

    expect(analyses).toHaveLength(1);
    expect(analyses[0]).toMatchObject({
      questionIndex: 1,
      topic: "Deadlock",
      misconception: "Confusing deadlock with starvation.",
    });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  test("passes the wrong answer, its options and the quiz context to the model", async () => {
    const provider = createMockAIProvider([{
      questionIndex: 1, misconception: "m", clarification: "c", revisionSuggestion: "r",
    }]);
    setAIProvider(provider);

    await run();

    const request = provider.complete.mock.calls[0][0];
    const prompt = request.messages[1].content;
    expect(prompt).toContain("Operating Systems Fundamentals");
    expect(prompt).toContain("Medium");
    expect(prompt).toContain("Deadlock");
    expect(prompt).toContain("Starvation"); // the option the learner chose
  });

  test("returns nothing, and calls no model, when every answer was correct", async () => {
    const provider = createMockAIProvider([]);
    setAIProvider(provider);

    const allCorrect = answers.map((a) => ({ ...a, isCorrect: true }));

    await expect(run({ normalizedAnswers: allCorrect })).resolves.toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  test("honours the analysis limit", async () => {
    setAIProvider(createMockAIProvider([]));

    const manyWrong = [0, 1, 0, 1, 0, 1, 0].map((index, i) => ({
      questionIndex: index, selected: 0, correct: 1, isCorrect: false, topic: "T",
    }));

    await expect(run({ normalizedAnswers: manyWrong, limit: 2 })).resolves.toHaveLength(2);
  });

  test("falls back for a question the model did not cover", async () => {
    setAIProvider(createMockAIProvider([{
      questionIndex: 99, misconception: "unrelated", clarification: "unrelated", revisionSuggestion: "unrelated",
    }]));

    const [analysis] = await run();

    // The model answered a different question, so the deterministic fallback is
    // used rather than attaching an irrelevant analysis.
    expect(analysis.questionIndex).toBe(1);
    expect(analysis.misconception).toContain("concept boundary");
    expect(analysis.clarification).toBe(QUIZ.questions[1].explanation);
    expect(analysis.distractorReason).toContain("Starvation");
    expect(analysis.revisionSuggestion).toContain("Deadlock");
  });

  test("falls back for every mistake when the model returns nothing usable", async () => {
    setAIProvider(createMockAIProvider("I cannot help with that."));

    const analyses = await run();

    expect(analyses).toHaveLength(1);
    expect(analyses[0].misconception).toContain("concept boundary");
  });

  test("falls back when the model fails outright", async () => {
    setAIProvider(createFailingAIProvider(new Error("model overloaded")));

    const analyses = await run();

    expect(analyses).toHaveLength(1);
    expect(analyses[0].clarification).toBe(QUIZ.questions[1].explanation);
  });

  test("falls back for an unanswered question", async () => {
    setAIProvider(createMockAIProvider([]));

    const unanswered = [{ questionIndex: 1, selected: -1, correct: 1, isCorrect: false, topic: "Deadlock" }];
    const [analysis] = await run({ normalizedAnswers: unanswered });

    expect(analysis.distractorReason).toContain("No answer was selected");
  });

  test("tolerates a question with no matching quiz question", async () => {
    setAIProvider(createMockAIProvider([]));

    const outOfRange = [{ questionIndex: 42, selected: 0, correct: 0, isCorrect: false }];
    const [analysis] = await run({ normalizedAnswers: outOfRange });

    // A stale answer index yields empty question data rather than throwing, and
    // the fallback degrades to a generic prompt instead of emitting "undefined".
    expect(analysis.questionIndex).toBe(42);
    expect(analysis.topic).toBe("General");
    expect(analysis.clarification).toBe('The correct answer is "". Revisit the underlying concept and compare it with the chosen option.');
    expect(JSON.stringify(analysis)).not.toContain("undefined");
  });

  test("a model that never settles currently holds the request open", async () => {
    // Recorded as a known gap: `analyzeMistakesForAttempt` has no timeout of its
    // own, so a hung upstream also blocks the fallback. Bounding this belongs to
    // the operational hardening task.
    setAIProvider(createHangingAIProvider());

    const outcome = await Promise.race([
      run().then(() => "settled", () => "settled"),
      new Promise((resolve) => { setTimeout(() => resolve("still-pending"), 50); }),
    ]);

    expect(outcome).toBe("still-pending");
  });
});
