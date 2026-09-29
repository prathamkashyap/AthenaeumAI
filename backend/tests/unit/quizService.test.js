/**
 * Contract Tests — the quiz quality pipeline
 *
 * `quizService.generateQuiz` is the orchestrator that every generation path is
 * meant to share: it chunks the material, calls the AI service, then applies the
 * quality rules in `utils/qualityFilter.js` plus the service's own similarity
 * removal and ranking before returning the accepted set.
 *
 * Only the model is replaced, through the Task 8 provider seam, so the real
 * generation loop, the real filter and the real fallback all run offline.
 */

import { jest } from "@jest/globals";
import {
  createMockAIProvider,
  createSequencedAIProvider,
  createFailingAIProvider,
} from "../mocks/mockAIProvider.js";
import { setAIProvider, resetAIProvider } from "../../services/aiProvider.js";
import { calculateQualityScore } from "../../utils/qualityFilter.js";

const { generateQuiz } = await import("../../services/quizService.js");

/** Long enough to clear the pipeline's 500-character minimum. */
const MATERIAL = (
  "Deadlock is a state in which two processes are each waiting for an event that " +
  "can only occur after the other process proceeds. Deadlock requires mutual " +
  "exclusion, hold and wait, no preemption, and a circular wait. "
).repeat(8);

/**
 * A question that scores full marks, so it survives the quality filter and any
 * test failure can be attributed to the rule under test rather than to the
 * fixture being weak.
 */
const strongQuestion = (overrides = {}) => ({
  question: "Which condition must hold for the wait-for graph to contain a cycle?",
  options: [
    "Every process holds at least one resource",
    "The scheduler uses round-robin dispatch",
    "Memory is allocated contiguously",
    "The timer interrupt is masked",
  ],
  answer: 0,
  explanation: "A cycle appears only when each process in the cycle is holding a resource another needs.",
  topic: "Deadlock",
  cognitiveLevel: "Analyze",
  ...overrides,
});

/**
 * Questions that share almost no vocabulary. The similarity rule merges anything
 * with more than 60% word overlap, so tests that need several questions to
 * survive must use genuinely distinct wording.
 */
const DISTINCT_QUESTIONS = [
  "Which deadlock condition requires that no resource be preempted from a running process?",
  "What does the circular wait condition imply about ownership between blocked processes?",
  "How does hold and wait differ from preemption in deadlock avoidance strategies?",
  "Why does mutual exclusion alone fail to guarantee forward progress in a system?",
].map((question, index) => strongQuestion({
  question,
  options: [
    `The first plausible distractor for question ${index + 1} about deadlock`,
    `The second plausible distractor for question ${index + 1} about deadlock`,
    `The third plausible distractor for question ${index + 1} about deadlock`,
    `The fourth plausible distractor for question ${index + 1} about deadlock`,
  ],
  explanation: `A detailed explanation of deadlock reasoning for question ${index + 1} in this material.`,
}));

const useProvider = (provider) => {
  setAIProvider(provider);
  return provider;
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  resetAIProvider();
});

describe("generateQuiz", () => {
  test("returns accepted questions for a clean model response", async () => {
    useProvider(createMockAIProvider([strongQuestion()]));

    const questions = await generateQuiz(MATERIAL, "Medium", 3);

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ answer: 0, topic: "Deadlock" });
  });

  test("never returns more questions than were requested", async () => {
    // The pipeline asks for ceil(5 / 2) = 3 questions per chunk across the
    // material's two chunks, so six distinct questions can survive filtering and
    // deduplication while only five were requested. Trimming that last one is the
    // cap's job, which is why this fixture deliberately over-supplies.
    const SIX = [
      "Which deadlock condition forbids the system reclaiming a held resource?",
      "What does a cycle in the wait-for graph indicate about blocked work?",
      "How does the hold-and-wait requirement complicate long-running transactions?",
      "Why is mutual exclusion insufficient on its own to keep a system advancing?",
      "What advantage does preemption give a deadlock avoidance strategy?",
      "Which scheduling decision most easily provokes the convoy effect?",
    ].map((question, index) => strongQuestion({
      question,
      options: [
        `Distractor one for question ${index + 1} in this material`,
        `Distractor two for question ${index + 1} in this material`,
        `Distractor three for question ${index + 1} in this material`,
        `Distractor four for question ${index + 1} in this material`,
      ],
      explanation: `A detailed explanation of deadlock reasoning for question ${index + 1} in this material.`,
    }));

    let call = 0;
    useProvider({
      complete: jest.fn(async () => ({ content: JSON.stringify([SIX[call++ % SIX.length]]) })),
      stream: jest.fn(),
    });

    const questions = await generateQuiz(MATERIAL, "Medium", 5);

    expect(questions).toHaveLength(5);
  });

  test("drops questions rejected by the existing quality filter", async () => {
    // A duplicated-option question scores 4.0 and is therefore low quality.
    useProvider(createMockAIProvider([
      strongQuestion({ question: "An accepted question about circular wait conditions?" }),
      strongQuestion({
        question: "A rejected question whose options are all identical to each other?",
        options: ["Same option", "Same option", "Same option", "Same option"],
      }),
    ]));

    const questions = await generateQuiz(MATERIAL, "Medium", 5);

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toContain("accepted question");
  });

  test("a low-quality fixture really is low quality, so the filter is what removes it", async () => {
    // Guards the fixture above: if the filter ever stops rejecting this shape,
    // the previous test would pass for the wrong reason.
    const rejected = strongQuestion({
      question: "A rejected question whose options are all identical to each other?",
      options: ["Same option", "Same option", "Same option", "Same option"],
    });

    expect(calculateQualityScore(rejected)).toBeLessThan(5);
  });

  test("drops exact duplicate questions", async () => {
    const duplicate = "An accepted question about circular wait conditions?";
    useProvider(createMockAIProvider([
      strongQuestion({ question: duplicate }),
      strongQuestion({ question: duplicate }),
    ]));

    const questions = await generateQuiz(MATERIAL, "Medium", 5);

    expect(questions).toHaveLength(1);
  });

  // Each penalty below is isolated so that removing that single penalty flips the
  // question from rejected to accepted. Each is paired with a deliberately
  // unrelated good question, because a rejected fixture that merely resembles the
  // good one would be removed by deduplication before the filter ever saw it.
  const UNRELATED_GOOD = strongQuestion({
    question: "Which page replacement policy is most likely to thrash when frames are scarce?",
    options: [
      "Least recently used, which tracks temporal locality",
      "First in first out, which ignores future use",
      "Optimal, which would need clairvoyance",
      "Random, which has no locality at all",
    ],
    explanation: "LRU tracks temporal locality yet can still thrash when the working set exceeds the allocated frames.",
    topic: "Paging",
  });

  const rejectedBy = (overrides) => strongQuestion({
    question: "Which deadlock condition stops a runtime from reclaiming a resource it granted?",
    options: [
      "No preemption, because a holder releases only voluntarily",
      "Mutual exclusion, which grants to one process only",
      "Hold and wait, which permits holding while requesting",
      "Circular wait, which closes a loop between processes",
    ],
    explanation: "A cycle cannot be taken back when granted resources are never reclaimed by the system.",
    topic: "Deadlock",
    ...overrides,
  });

  const expectOnlyTheGoodOne = async (rejected) => {
    expect(calculateQualityScore(rejected)).toBeLessThan(5);
    expect(calculateQualityScore(UNRELATED_GOOD)).toBeGreaterThanOrEqual(5);

    useProvider(createMockAIProvider([rejected, UNRELATED_GOOD]));

    const questions = await generateQuiz(MATERIAL, "Medium", 8);

    expect(questions.map((q) => q.question)).toEqual([UNRELATED_GOOD.question]);
  };

  test("rejects a question whose explanation is too short", async () => {
    await expectOnlyTheGoodOne(rejectedBy({ explanation: "Too brief." }));
  });

  test("rejects a question with a degenerate one-character option", async () => {
    await expectOnlyTheGoodOne(rejectedBy({
      options: [
        "A",
        "Mutual exclusion, which grants to one process only",
        "Hold and wait, which permits holding while requesting",
        "Circular wait, which closes a loop between processes",
      ],
    }));
  });

  test("rejects a question offering an all-of-the-above option", async () => {
    await expectOnlyTheGoodOne(rejectedBy({
      options: [
        "No preemption, because a holder releases only voluntarily",
        "Mutual exclusion, which grants to one process only",
        "Hold and wait, which permits holding while requesting",
        "All of the above",
      ],
    }));
  });

  test("rejects a question whose options are duplicated", async () => {
    await expectOnlyTheGoodOne(rejectedBy({
      options: ["Same option", "Same option", "Same option", "Same option"],
    }));
  });

  test("keeps a question that only incurs a minor penalty", async () => {
    // A short stem costs 2 points, leaving 8.0: comfortably accepted, so this
    // pins that the threshold rejects on a major fault rather than any deduction.
    const minor = rejectedBy({ question: "Which condition forbids preemption?" });
    expect(calculateQualityScore(minor)).toBe(8);

    useProvider(createMockAIProvider([minor, UNRELATED_GOOD]));

    const questions = await generateQuiz(MATERIAL, "Medium", 8);

    expect(questions).toHaveLength(2);
  });

  test("drops near-duplicate questions that share most of their words", async () => {
    // The similarity rule rejects a question when more than 60% of the earlier
    // question's words reappear.
    useProvider(createMockAIProvider([
      strongQuestion({ question: "Which condition allows the wait-for graph to contain a cycle?" }),
      strongQuestion({ question: "Which condition allows the wait-for graph to contain a cycle today?" }),
    ]));

    const questions = await generateQuiz(MATERIAL, "Medium", 5);

    expect(questions).toHaveLength(1);
  });

  test("keeps questions that differ enough to be distinct", async () => {
    useProvider(createMockAIProvider(DISTINCT_QUESTIONS.slice(0, 2)));

    await expect(generateQuiz(MATERIAL, "Medium", 5)).resolves.toHaveLength(2);
  });

  test("normalizes topic strings before returning", async () => {
    useProvider(createMockAIProvider([strongQuestion({ topic: "  operating systems  " })]));

    const [question] = await generateQuiz(MATERIAL, "Medium", 5);

    expect(question.topic).toBe("Operating Systems");
  });

  test("returns fewer questions than requested rather than padding", async () => {
    useProvider(createMockAIProvider([strongQuestion()]));

    const questions = await generateQuiz(MATERIAL, "Medium", 10);

    expect(questions).toHaveLength(1);
  });

  test("orders questions by the ranking score", async () => {
    // Four questions that survive deduplication (deliberately unrelated
    // vocabulary) and differ only in the properties `scoreQuestion` rewards:
    //
    //   A  long stem, long distractor, long explanation          -> 6
    //   B  long stem, long distractor, "what is" opening         -> 4
    //   C  short stem, long distractor, long explanation         -> 4
    //   D  short stem, short distractors, long explanation       -> 2
    //
    // B and C tie, so a stable sort must keep their supplied relative order,
    // which makes the expected sequence sensitive to each individual bonus and
    // penalty rather than only to the presence of sorting.
    const A = strongQuestion({
      question: "Which deadlock condition stops the runtime from reclaiming a resource it already granted?",
      options: ["No preemption, because a holder releases only voluntarily", "Mutual exclusion", "Hold and wait", "Circular wait"],
      explanation: "A cycle cannot be broken by the system if granted resources are never taken back.",
    });
    const B = strongQuestion({
      question: "What is the banker's algorithm used for when allocating resources safely?",
      options: ["Avoiding unsafe allocation states before granting a request", "Choosing the shortest job", "Paging replacement", "Scheduling priority"],
      explanation: "The banker's algorithm simulates every completion order to keep the system in a safe state.",
    });
    const C = strongQuestion({
      question: "Which scheduling choice most provokes a convoy?",
      options: ["First come first served ahead of one long burst", "Shortest job first", "Round robin", "Multilevel feedback"],
      explanation: "A non-preemptive queue head delays every short process queued behind it.",
    });
    const D = strongQuestion({
      question: "Which page replacement policy can thrash?",
      options: ["LRU", "FIFO", "Optimal", "Random"],
      explanation: "LRU adapts to locality yet still thrashes when the working set exceeds the allocated frames.",
    });

    // Each must clear the quality filter, so ordering is the only differentiator.
    for (const q of [A, B, C, D]) expect(calculateQualityScore(q)).toBeGreaterThanOrEqual(5);

    // Supplied order is deliberately not the expected order. Eight are
    // requested so the AI service's per-chunk budget of ceil(8 / 2) = 4 does not
    // discard any of the four before the pipeline ever sees them.
    useProvider(createMockAIProvider([C, B, A, D]));

    const questions = await generateQuiz(MATERIAL, "Medium", 8);

    expect(questions.map((q) => q.question)).toEqual([A.question, C.question, B.question, D.question]);
  });

  test("ranks a question with a long distractor above an otherwise equal terse one", async () => {
    // The two questions differ only in whether any option exceeds 20 characters.
    // The lower-scoring one is supplied first, so if that bonus were removed the
    // pair would tie and the supplied order would survive — changing the result.
    const longOptions = strongQuestion({
      question: "Which page replacement policy is most likely to thrash when frames are scarce?",
      options: [
        "Least recently used, which tracks temporal locality",
        "First in first out, which ignores future use",
        "Optimal, which would need clairvoyance",
        "Random, which has no locality at all",
      ],
      explanation: "LRU tracks temporal locality yet can still thrash when the working set exceeds the allocated frames.",
    });
    const shortOptions = strongQuestion({
      question: "Which scheduling policy degrades badly under a sustained burst of CPU bound work?",
      options: ["FIFO", "SJF", "RR", "MLFQ"],
      explanation: "A non-preemptive queue lets one long burst delay every short process queued behind it.",
    });
    for (const q of [longOptions, shortOptions]) expect(calculateQualityScore(q)).toBeGreaterThanOrEqual(5);

    useProvider(createMockAIProvider([shortOptions, longOptions]));

    const questions = await generateQuiz(MATERIAL, "Medium", 8);

    expect(questions.map((q) => q.question)).toEqual([longOptions.question, shortOptions.question]);
  });

  test("ranks a question with a long explanation above an otherwise equal terse one", async () => {
    // The two questions differ only in whether the explanation exceeds 30
    // characters; again the lower-scoring one is supplied first.
    const longExplanation = strongQuestion({
      question: "Which database journaling mode permits recovery without blocking readers?",
      options: [
        "Multi-versioning, which keeps old row versions",
        "Contiguous allocation, which stores blocks",
        "Linked allocation, which chains them",
        "Single level index, which flattens keys",
      ],
      explanation: "Multi-versioning keeps previous row versions visible so a recovery or rollback can proceed without blocking concurrent readers.",
    });
    const shortExplanation = strongQuestion({
      question: "Which file allocation method suffers from external fragmentation over time?",
      options: [
        "Contiguous allocation, which leaves unusable gaps",
        "Indexed allocation, which stores pointers",
        "Linked allocation, which chains blocks",
        "Multi-level indexing, which adds a layer",
      ],
      // Exactly 30 characters: long enough to clear the quality filter, which
      // only penalises explanations shorter than 30, but not long enough to earn
      // the ranking bonus, which requires more than 30.
      explanation: "Extents fragment as files grow",
    });
    for (const q of [longExplanation, shortExplanation]) expect(calculateQualityScore(q)).toBeGreaterThanOrEqual(5);

    useProvider(createMockAIProvider([shortExplanation, longExplanation]));

    const questions = await generateQuiz(MATERIAL, "Medium", 8);

    expect(questions.map((q) => q.question)).toEqual([longExplanation.question, shortExplanation.question]);
  });

  test("falls back to source sentences when the model produces nothing usable", async () => {
    useProvider(createMockAIProvider("I am unable to generate a quiz from this material."));

    const questions = await generateQuiz(MATERIAL, "Medium", 2);

    // The fallback derives True/False-style questions from the source sentences.
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      options: ["True", "False", "Depends", "None"],
      answer: 0,
      explanation: "Generated from source text",
    });
  });

  test("falls back when the model provider fails outright", async () => {
    useProvider(createFailingAIProvider(new Error("model unavailable")));

    const questions = await generateQuiz(MATERIAL, "Medium", 2);

    expect(questions).toHaveLength(2);
    expect(questions[0].explanation).toBe("Generated from source text");
  });

  test("falls back without asking the model when the material is too short", async () => {
    // Below 500 characters the pipeline skips generation entirely, so the model
    // is never asked and the deterministic fallback supplies the questions.
    const short = (
      "A deadlock arises when two processes each hold a resource the other requires. " +
      "The circular wait condition describes this mutual dependency precisely. "
    );
    expect(short.length).toBeLessThan(500);

    const provider = useProvider(createMockAIProvider([strongQuestion()]));

    const questions = await generateQuiz(short, "Medium", 2);

    expect(provider.complete).not.toHaveBeenCalled();
    expect(questions).toHaveLength(2);
    expect(questions[0].explanation).toBe("Generated from source text");
  });

  test("throws when even the fallback cannot build a quiz", async () => {
    // Long enough to pass the 500-character gate, so generation is attempted and
    // fails, but the text contains no sentence the fallback can turn into a
    // question, so the failure surfaces to the caller.
    useProvider(createFailingAIProvider(new Error("model unavailable")));
    const unsplittable = "x".repeat(600);

    await expect(generateQuiz(unsplittable, "Medium", 2)).rejects.toThrow("Not enough meaningful content");
  });

  test("preserves the accepted questions across several chunks", async () => {
    // The pipeline asks the model once per chunk; the accepted set is the union.
    const provider = createSequencedAIProvider([
      [strongQuestion({ question: "An accepted question about mutual exclusion here?" })],
      [strongQuestion({ question: "An accepted question about hold and wait now?" })],
    ]);
    useProvider(provider);

    const questions = await generateQuiz(MATERIAL, "Medium", 5);

    expect(questions).toHaveLength(2);
  });
});
