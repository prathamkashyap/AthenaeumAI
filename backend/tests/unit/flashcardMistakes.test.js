/**
 * Mistake-review flashcards
 * ==========================
 *
 * The mistake → learning loop was already connected: an attempt records
 * `mistakeAnalyses`, the `SYNC_ATTEMPT` worker applies them durably and enqueues
 * `failed_question` review items. The gap this covers is narrower and specific —
 * a wrong answer had no path to a flashcard, and a quiz-sourced flashcard set
 * was generated from every question including the ones the learner got right.
 *
 * The service runs in full. Only the three Mongoose models and the AI generator
 * are replaced, so the branch under test is the real one and the assertions are
 * about which questions reached the set, not about a stub's behaviour.
 *
 * Two properties are treated as load-bearing and pinned directly:
 *
 *   - only wrong answers become cards, because a review set that rehearses
 *     correct answers is not a response to a mistake;
 *   - `sourceQuestionIndex` is the quiz's index, not the filtered list's, because
 *     that index is how a card is traced back to the question it came from.
 */

import { jest } from "@jest/globals";

const QUIZ = {
  _id: "quiz-1",
  title: "OS Notes",
  studyMaterial: "mat-1",
  subject: "Operating Systems",
  questions: [
    { question: "What are the deadlock conditions?", options: ["a", "b", "c", "d"], answer: 1, explanation: "Mutual exclusion, hold and wait, no preemption, circular wait.", topic: "Deadlock" },
    { question: "What is a semaphore?", options: ["a", "b"], answer: 0, explanation: "A counter with wait and signal.", topic: "Synchronisation" },
    { question: "What is a page fault?", options: ["a", "b"], answer: 0, explanation: "A trap raised on a missing translation.", topic: "Memory" },
  ],
};

const attemptWith = (answers) => ({
  _id: "attempt-1",
  quiz: "quiz-1",
  user: "user-1",
  answers,
  mistakeAnalyses: answers
    .filter((a) => a.isCorrect === false)
    .map((a) => ({ questionIndex: a.questionIndex, topic: "Deadlock", misconception: "Confused the conditions", clarification: "Four conditions must hold together." })),
});

// Wrong answers at indices 0 and 2, so a renumbered index would be detectable.
const MIXED_ANSWERS = [
  { questionIndex: 0, selected: 2, isCorrect: false, topic: "Deadlock" },
  { questionIndex: 1, selected: 0, isCorrect: true, topic: "Synchronisation" },
  { questionIndex: 2, selected: 1, isCorrect: false, topic: "Memory" },
];

let currentAttempt = null;
// Set to a different learner to simulate an id belonging to somebody else. Reset
// in `beforeEach`, because a per-test override of a shared mock otherwise leaks
// into every later test in the file.
let ownerId = "user-1";
let quizOverride = null;

const findOne = jest.fn(async (filter) => {
  if (filter.user !== ownerId) return null;
  if (filter._id === "attempt-1") return currentAttempt;
  if (filter._id === "quiz-1") return quizOverride || QUIZ;
  return null;
});

jest.unstable_mockModule("../../models/QuizAttempt.js", () => ({ default: { findOne } }));
jest.unstable_mockModule("../../models/Quiz.js", () => ({ default: { findOne } }));
jest.unstable_mockModule("../../models/StudyMaterial.js", () => ({
  default: { findOne, findByIdAndUpdate: jest.fn(async () => ({})) },
}));
jest.unstable_mockModule("../../models/UserProgress.js", () => ({
  default: { findOne: jest.fn(async () => ({ lean: async () => ({ topics: [] }) })) },
}));

const create = jest.fn(async (doc) => ({ _id: "set-1", ...doc }));
jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({ default: { create } }));

const updateMany = jest.fn(async () => ({ modifiedCount: 2 }));
jest.unstable_mockModule("../../models/ReviewQueue.js", () => ({ default: { updateMany } }));

// The AI generator is replaced so the tests assert the *selection* logic. The
// fallback path is what runs when it is absent, and that path is derived from the
// same questions.
const generateFlashcardsFromAI = jest.fn(async () => { throw new Error("no key in tests"); });
jest.unstable_mockModule("../../services/aiQuizService.js", () => ({ generateFlashcardsFromAI }));

const { createFlashcardSet } = await import("../../services/flashcardService.js");

const makeSet = () => create.mock.calls[0][0];
const build = (over = {}) =>
  createFlashcardSet({ userId: "user-1", sourceType: "mistakes", sourceId: "attempt-1", ...over });

beforeEach(() => {
  jest.clearAllMocks();
  currentAttempt = attemptWith(MIXED_ANSWERS);
  ownerId = "user-1";
  quizOverride = null;
  generateFlashcardsFromAI.mockRejectedValue(new Error("no key in tests"));
});

describe("only wrong answers become cards", () => {
  test("a correct answer does not produce a card", async () => {
    await build();

    const cards = makeSet().cards;
    const indices = cards.map((card) => card.sourceQuestionIndex);

    expect(indices).toContain(0);
    expect(indices).toContain(2);
    // Index 1 was answered correctly. A review set that rehearses it is not a
    // response to a mistake.
    expect(indices).not.toContain(1);
    expect(cards).toHaveLength(2);
  });

  test("every card traces back to a question the learner got wrong", async () => {
    await build();

    const wrongIndices = new Set(
      MIXED_ANSWERS.filter((answer) => answer.isCorrect === false).map((a) => a.questionIndex),
    );
    for (const card of makeSet().cards) {
      expect(wrongIndices.has(card.sourceQuestionIndex)).toBe(true);
    }
  });

  test("preserves the quiz's own question index rather than the filtered position", async () => {
    await build();

    const indices = makeSet().cards.map((card) => card.sourceQuestionIndex).sort();
    // The wrong answers are at 0 and 2. Renumbering them to 0 and 1 would make
    // the second card claim to be the second question of the quiz, silently
    // breaking the link back to the source.
    expect(indices).toEqual([0, 2]);
  });
});

describe("the card preserves the concept it reviews", () => {
  test("uses the question as the prompt and the explanation as the answer", async () => {
    await build();

    const [first] = makeSet().cards;
    expect(first.front).toBe(QUIZ.questions[0].question);
    expect(first.back).toBe(QUIZ.questions[0].explanation);
  });

  test("keeps the question's topic", async () => {
    await build();

    const topics = makeSet().cards.map((card) => card.topic);
    expect(topics).toContain("Deadlock");
    expect(topics).toContain("Memory");
  });

  test("falls back to the mistake analysis when the question has no explanation", async () => {
    currentAttempt = attemptWith([{ questionIndex: 0, selected: 1, isCorrect: false, topic: "Deadlock" }]);
    quizOverride = { ...QUIZ, questions: [{ ...QUIZ.questions[0], explanation: undefined }] };

    await build();

    const [card] = makeSet().cards;
    expect(card.back).toBe("Four conditions must hold together.");
  });
});

describe("the set is attributable to its attempt", () => {
  test("records the attempt and the quiz it came from", async () => {
    await build();

    expect(makeSet()).toMatchObject({
      sourceType: "mistakes",
      quiz: QUIZ._id,
      attempt: "attempt-1",
      studyMaterial: QUIZ.studyMaterial,
    });
  });

  test("links the new set onto the review items that same attempt created", async () => {
    await build();

    // The review items already exist and already name the attempt, so the cards
    // can be reached from the review queue rather than being a separate list.
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toMatchObject({
      user: "user-1",
      itemType: "failed_question",
      status: "open",
      "source.attempt": "attempt-1",
    });
    expect(update.$set["source.flashcardSet"]).toBe("set-1");
  });

  test("does not touch the review queue for a non-mistake set", async () => {
    // No attempt registered, so the quiz lookup resolves and the quiz branch runs.
    currentAttempt = null;

    await createFlashcardSet({ userId: "user-1", sourceType: "quiz", sourceId: "quiz-1" });

    // A quiz-sourced set belongs to no attempt, so there is nothing to link.
    expect(updateMany).not.toHaveBeenCalled();
    expect(makeSet().attempt).toBeNull();
  });
});

describe("repeated processing does not duplicate", () => {
  test("the link is scoped to items that are not yet linked", async () => {
    await build();

    // This filter is the idempotency mechanism, so it is asserted exactly rather
    // than through a simulation: after a first run every matching item carries a
    // set id and so no longer satisfies `flashcardSet: null`, leaving a repeated
    // run with nothing to update. It is not ReviewQueue's unique index that
    // provides this.
    const [filter] = updateMany.mock.calls[0];
    expect(filter).toHaveProperty(["source.flashcardSet"], null);
    expect(filter).toMatchObject({ "source.attempt": "attempt-1", status: "open" });
  });

  test("linking is a set, so a double match cannot duplicate the reference", async () => {
    await build();

    const [, update] = updateMany.mock.calls[0];
    // `$set` overwrites. A `$addToSet` or a push would be able to multiply the
    // reference; this cannot.
    expect(Object.keys(update)).toEqual(["$set"]);
    expect(Array.isArray(update.$set["source.flashcardSet"])).toBe(false);
  });

  test("builds a fresh set per request rather than reusing one", async () => {
    await build();
    await build();

    // A deliberate boundary, stated rather than assumed: the deck is a study
    // artefact the learner asked for, and a second request produces a second
    // artefact. Deduplicating these would mean inventing a policy — is a second
    // attempt on the same quiz a new set or the same one? — and silently refusing
    // to build would be the worse failure. What must not happen is a single set
    // gaining the same question twice, which the per-request selection prevents.
    expect(create).toHaveBeenCalledTimes(2);
    const first = create.mock.calls[0][0];
    const second = create.mock.calls[1][0];
    expect(first.attempt).toBe("attempt-1");
    expect(second.attempt).toBe("attempt-1");

    // Within either set, each wrong question appears exactly once.
    for (const doc of [first, second]) {
      const indices = doc.cards.map((card) => card.sourceQuestionIndex);
      expect(indices).toEqual([...new Set(indices)]);
    }
  });
});

describe("degenerate and hostile inputs", () => {
  test("refuses a perfect attempt rather than building a set from correct answers", async () => {
    currentAttempt = attemptWith([{ questionIndex: 1, selected: 0, isCorrect: true, topic: "Sync" }]);

    await expect(build()).rejects.toThrow(/no incorrect answers/i);
    // Nothing persisted, so a declined request leaves no empty set behind.
    expect(create).not.toHaveBeenCalled();
  });

  test("surfaces the refusal as a 400 rather than a server fault", async () => {
    currentAttempt = attemptWith([{ questionIndex: 1, selected: 0, isCorrect: true, topic: "Sync" }]);

    await expect(build()).rejects.toMatchObject({ status: 400 });
  });

  test("will not build a set from another learner's attempt", async () => {
    // The caller's id does not match the attempt's owner, so the scoped lookup
    // must not resolve.
    ownerId = "user-2";

    // Scoped by owner exactly as a quiz lookup is, so an id from elsewhere cannot
    // be used to read another learner's attempt.
    await expect(build()).rejects.toThrow(/Quiz attempt not found/i);
    expect(create).not.toHaveBeenCalled();
  });

  test("clamps the requested count to the service's floor", async () => {
    // `createFlashcardSet` clamps every source type to a 4..30 window, so a
    // request for fewer than four cannot be honoured and is not honoured here
    // either. Asserting the floor rather than the raw request keeps the test
    // describing the contract the service actually has.
    await build({ count: 1 });

    // Two wrong answers exist, so the floor of 4 is capped by what there is to
    // review rather than by the requested count.
    expect(makeSet().cards).toHaveLength(2);
  });

  test("never generates more cards than there are wrong answers", async () => {
    await build({ count: 30 });

    // A large request must not pad the set out with questions the learner
    // answered correctly.
    expect(makeSet().cards).toHaveLength(2);
  });

  test("leaves the attempt untouched", async () => {
    await build();

    // The service only reads the attempt. Review scheduling lives in the card
    // normalisation, so the attempt's own state is not this code's business.
    expect(findOne).toHaveBeenCalled();
    const attempt = currentAttempt;
    expect(attempt.mistakeAnalyses).toHaveLength(2);
  });
});
