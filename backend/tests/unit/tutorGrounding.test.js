/**
 * Grounding decision — contract tests
 * ===================================
 *
 * `tutorGrounding.js` is pure and total, so it is tested directly rather than
 * through the tutor services. The services' tests then assert that both paths
 * actually consult it, and that neither reaches the model when it refuses.
 *
 * The central property is that the decision has no tuned constant in it. Every
 * test here is a boundary case that a threshold-based implementation would get
 * differently, and the module comment records the distribution analysis that
 * ruled a threshold out.
 */

import {
  GROUNDING_REFUSAL,
  INSUFFICIENT_CONTEXT_MESSAGE,
  evaluateTutorGrounding,
  insufficientContextResponse,
} from "../../services/tutorGrounding.js";

const ctx = (score) => ({ score, chunkText: "text", sourceTitle: "Notes", chunkIndex: 0 });

describe("evaluateTutorGrounding", () => {
  describe("grounded", () => {
    test("a single clearly matching chunk grounds the answer", () => {
      const decision = evaluateTutorGrounding([ctx(0.42)]);

      expect(decision.grounded).toBe(true);
      expect(decision.reason).toBeNull();
      expect(decision.evidenceCount).toBe(1);
      expect(decision.consideredCount).toBe(1);
      expect(decision.bestScore).toBe(0.42);
    });

    test("grounds when only some of the retrieved chunks carry evidence", () => {
      // One usable chunk is enough. Refusing here would mean a single irrelevant
      // neighbour in the result set suppressed a real answer.
      const decision = evaluateTutorGrounding([ctx(0), ctx(0.31), ctx(0)]);

      expect(decision.grounded).toBe(true);
      expect(decision.evidenceCount).toBe(1);
      expect(decision.consideredCount).toBe(3);
      expect(decision.bestScore).toBe(0.31);
    });
  });

  describe("insufficient_context", () => {
    test("an empty result set is no context", () => {
      const decision = evaluateTutorGrounding([]);

      expect(decision.grounded).toBe(false);
      expect(decision.reason).toBe(GROUNDING_REFUSAL.NO_CONTEXT);
      expect(decision.consideredCount).toBe(0);
    });

    test("chunks that all score exactly zero are no lexical evidence", () => {
      // This is the case the gate exists for. The production retriever has no
      // refusal threshold and returns top-N regardless of score, so a wholly
      // unevidenced result set reaches the tutor as a normal-looking answer.
      const decision = evaluateTutorGrounding([ctx(0), ctx(0), ctx(0)]);

      expect(decision.grounded).toBe(false);
      expect(decision.reason).toBe(GROUNDING_REFUSAL.NO_LEXICAL_EVIDENCE);
      expect(decision.consideredCount).toBe(3);
    });

    test("a single zero-score chunk with no others is refused", () => {
      const decision = evaluateTutorGrounding([ctx(0)]);

      expect(decision.grounded).toBe(false);
      expect(decision.reason).toBe(GROUNDING_REFUSAL.NO_LEXICAL_EVIDENCE);
    });
  });

  describe("there is no score threshold, and the boundaries prove it", () => {
    // The measured distribution is why there is no constant. These are the exact
    // cases a `MIN_TUTOR_SCORE = 0.35`-style implementation would decide
    // differently, in both directions.
    test("an arbitrarily small non-zero score still grounds", () => {
      // Observed top-1 scores for correctly answered questions run down to 0.168,
      // but there is no lower bound the data supports. If 0.0001 were refused, a
      // real match would be discarded over a difference no evidence justifies.
      expect(evaluateTutorGrounding([ctx(0.0001)]).grounded).toBe(true);
      expect(evaluateTutorGrounding([ctx(0.001)]).grounded).toBe(true);
      expect(evaluateTutorGrounding([ctx(0.01)]).grounded).toBe(true);
    });

    test("a high score alone does not certify the chunk is the right one", () => {
      // The gate is not a quality filter, and this asserts the boundary of what
      // it claims. A confidently-scored wrong chunk is grounded by definition:
      // the retrieval evaluation showed no score separates correct from incorrect
      // retrieval, so nothing downstream of the score can either.
      const decision = evaluateTutorGrounding([ctx(0.61)]);

      expect(decision.grounded).toBe(true);
      expect(decision.bestScore).toBe(0.61);
    });

    test("exactly zero is refused and any positive value is not", () => {
      // The only boundary that exists. 0 means no shared token and no collision;
      // everything above it means at least one.
      expect(evaluateTutorGrounding([ctx(0)]).grounded).toBe(false);
      expect(evaluateTutorGrounding([ctx(Number.MIN_VALUE)]).grounded).toBe(true);
    });
  });

  describe("the decision is total", () => {
    // A grounding gate that can itself throw is worse than no gate, because the
    // failure lands on the request path rather than on a guarded branch.
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["a non-array", { score: 0.5 }],
      ["a string", "contexts"],
      ["a number", 7],
    ])("treats %s as no context rather than throwing", (_label, input) => {
      const decision = evaluateTutorGrounding(input);

      expect(decision.grounded).toBe(false);
      expect(decision.reason).toBe(GROUNDING_REFUSAL.NO_CONTEXT);
    });

    test("a missing or non-numeric score counts as absence, not as evidence", () => {
      const decision = evaluateTutorGrounding([{}, { score: null }, { score: undefined }]);

      expect(decision.grounded).toBe(false);
      expect(decision.reason).toBe(GROUNDING_REFUSAL.NO_LEXICAL_EVIDENCE);
    });

    test("a NaN score does not produce a NaN best score", () => {
      const decision = evaluateTutorGrounding([{ score: Number.NaN }, ctx(0.2)]);

      expect(decision.grounded).toBe(true);
      expect(decision.bestScore).toBe(0.2);
      expect(Number.isNaN(decision.bestScore)).toBe(false);
    });

    test("a negative score is absence, since it carries no lexical evidence", () => {
      // Defensive rather than observed: the retriever never returns a negative
      // score, but a negative one would be meaningless as evidence.
      expect(evaluateTutorGrounding([ctx(-0.1)]).grounded).toBe(false);
    });
  });

  test("is deterministic", () => {
    const contexts = [ctx(0), ctx(0.2), ctx(0)];
    const runs = Array.from({ length: 20 }, () => evaluateTutorGrounding(contexts));

    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });
});

describe("insufficientContextResponse", () => {
  test("preserves the response shape the client renders", () => {
    // The client declares question, answer, groundedSources, personalizedNotes,
    // revisionPlan, suggestedFollowUps and retrievedContext. A refusal missing
    // any of them would crash the renderer rather than read as a refusal.
    const payload = insufficientContextResponse({
      question: "What is a trap?",
      grounding: { grounded: false, reason: "no_context" },
    });

    expect(Object.keys(payload).sort()).toEqual([
      "answer",
      "groundedSources",
      "grounding",
      "personalizedNotes",
      "question",
      "retrievedContext",
      "revisionPlan",
      "suggestedFollowUps",
    ]);
    expect(payload.question).toBe("What is a trap?");
  });

  test("cites nothing and returns no retrieved context", () => {
    // Returning the rejected chunks would let a client present them as citations
    // for an answer that was never produced.
    const payload = insufficientContextResponse({
      question: "q",
      grounding: { grounded: false, reason: "no_lexical_evidence" },
    });

    expect(payload.groundedSources).toEqual([]);
    expect(payload.retrievedContext).toEqual([]);
  });

  test("explains the absence without claiming a model declined", () => {
    const payload = insufficientContextResponse({
      question: "q",
      grounding: { grounded: false, reason: "no_context" },
    });

    expect(payload.answer).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
    expect(payload.answer).toMatch(/could not find anything/i);
    // The message must not imply the model tried and gave up: it never ran.
    expect(payload.answer).not.toMatch(/\bI (?:could not|cannot) (?:answer|help)\b/i);
  });

  test("offers next steps rather than a bare refusal", () => {
    const payload = insufficientContextResponse({ question: "q", grounding: {} });

    expect(payload.revisionPlan.length).toBeGreaterThan(0);
    expect(payload.suggestedFollowUps.length).toBeGreaterThan(0);
  });

  test("carries the grounding decision through to the client", () => {
    const grounding = { grounded: false, reason: "no_lexical_evidence", consideredCount: 6 };
    const payload = insufficientContextResponse({ question: "q", grounding });

    expect(payload.grounding).toEqual(grounding);
  });
});
