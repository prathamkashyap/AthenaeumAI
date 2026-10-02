/**
 * Tutor grounding decision.
 * ==========================
 *
 * An explicit, deterministic answer to one question, asked before any model is
 * called: *is there any retrieved evidence to ground an answer in?*
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The tutor previously retrieved chunks, passed them to the model, and relied on
 * a prompt line reading "if context is insufficient, explain what is missing" to
 * decide whether to answer. That is not a contract. It makes the decision to
 * answer a question the model may answer anyway, and it means an ungrounded
 * answer is indistinguishable from a grounded one at every layer below.
 *
 * This module is the smallest decision that can be justified by evidence, and it
 * is deliberately weaker than the name "grounding" might suggest.
 *
 * ── Why there is no numeric threshold here ────────────────────────────────────
 *
 * A minimum score is the obvious design, and it was measured and rejected.
 *
 * The production retriever's combined score is `0.78 × cosine + 0.22 ×
 * keyword-overlap`. Across three independent query sets over the frozen
 * evaluation corpus, the top-1 score of a query whose answer is NOT retrieved
 * falls entirely inside the range of the top-1 score of a query whose answer IS
 * retrieved:
 *
 *   combined score, top-1, correct : 0.168 – 0.611
 *   combined score, top-1, wrong   : 0.136 – 0.507
 *
 * Sweeping every threshold from 0.00 to 0.65 in steps of 0.01, there is no value
 * that both rejects every wrong case and keeps every correct one. The highest
 * threshold that rejects all wrong cases discards 20 of 37 correct ones. Lexical
 * coverage and the top-1-minus-top-2 margin overlap the same way.
 *
 * A constant like 0.35 or 0.40 would therefore not be a calibration. It would be
 * a number that looks measured, would reject most correctly-answered questions,
 * and would still let through a confidently-ranked wrong chunk. It would convert
 * a visible failure into a silent one, which is worse than the current behaviour.
 *
 * ── What this decision can and cannot do ─────────────────────────────────────
 *
 * It distinguishes *no evidence* from *some evidence*. It does NOT distinguish
 * *right evidence* from *wrong evidence*, and it is not a quality filter.
 *
 * The retrieval evaluation established that the production retriever regularly
 * ranks a lexically adjacent, evidentially poorer chunk first. Nothing in the
 * score can detect that, so nothing here does either. A question answered from a
 * confidently-ranked wrong chunk still passes this gate and is still wrong.
 *
 * Closing that gap needs either a retriever whose scores separate correct from
 * incorrect retrieval — which the current one demonstrably does not — or a
 * verification step after generation. Both are out of scope here. The honest
 * position is that this gate prevents the system from claiming to be grounded
 * when it retrieved nothing at all, and that is all it should be claimed to do.
 */

/** Reasons the gate can refuse. Both mean "no evidence", never "bad evidence". */
export const GROUNDING_REFUSAL = Object.freeze({
  NO_CONTEXT: "no_context",
  NO_LEXICAL_EVIDENCE: "no_lexical_evidence",
});

/**
 * Whether a retrieved score counts as evidence of any lexical relationship.
 *
 * Zero is the only value treated as absence, because zero is the one value with
 * an unambiguous meaning for this retriever: a score of exactly 0 means the chunk
 * shares no surviving token with the query and collided with nothing. Every
 * non-zero score, however small, is treated as evidence.
 *
 * The distinction is deliberately not `score >= epsilon` for some epsilon: that
 * would reintroduce exactly the arbitrary constant the distribution analysis
 * ruled out, while being harder to reason about than an exact zero.
 */
const hasEvidence = (score) => Number.isFinite(score) && score > 0;

/**
 * Decides whether the retrieved context can ground an answer.
 *
 * Pure and total: any input, including null, undefined, malformed scores or a
 * non-array, produces a decision rather than throwing. A grounding gate that can
 * itself fail is worse than no gate, so a malformed score is treated as absence
 * rather than as an error.
 *
 * @param {Array<{ score?: number }>|null|undefined} materialContexts
 * @returns {{ grounded: boolean, reason: string|null, evidenceCount: number, consideredCount: number, bestScore: number }}
 */
export const evaluateTutorGrounding = (materialContexts) => {
  const contexts = Array.isArray(materialContexts) ? materialContexts : [];

  if (contexts.length === 0) {
    return {
      grounded: false,
      reason: GROUNDING_REFUSAL.NO_CONTEXT,
      evidenceCount: 0,
      consideredCount: 0,
      bestScore: 0,
    };
  }

  const scores = contexts.map((context) => context?.score);
  const evidenceCount = scores.filter(hasEvidence).length;
  const finiteScores = scores.filter((score) => Number.isFinite(score));
  const bestScore = finiteScores.length > 0 ? Math.max(...finiteScores) : 0;

  if (evidenceCount === 0) {
    return {
      grounded: false,
      reason: GROUNDING_REFUSAL.NO_LEXICAL_EVIDENCE,
      evidenceCount: 0,
      consideredCount: contexts.length,
      bestScore,
    };
  }

  return {
    grounded: true,
    reason: null,
    evidenceCount,
    consideredCount: contexts.length,
    bestScore,
  };
};

/**
 * The learner-facing refusal, used verbatim by both tutor paths.
 *
 * One string for both paths rather than one each, because a streaming refusal and
 * a non-streaming refusal that differ only in wording are two contracts to keep
 * aligned instead of one. It names what is missing and what would fix it, and it
 * does not apologise for the model or mention that one was not called.
 */
export const INSUFFICIENT_CONTEXT_MESSAGE =
  "I could not find anything in your uploaded material that matches this question, " +
  "so I have not attempted an answer. Upload or generate notes that cover this topic, " +
  "or rephrase the question using terms your material actually contains, then ask again.";

/**
 * A refusal payload shaped like a normal tutor response.
 *
 * The shape is preserved deliberately: the client renders `answer`,
 * `groundedSources`, `personalizedNotes`, `revisionPlan`, `suggestedFollowUps` and
 * `retrievedContext`, and a refusal that broke that shape would surface as a
 * client-side crash rather than as a tutor that declined to answer. `grounding` is
 * additive, and the client ignores fields it does not declare.
 *
 * `retrievedContext` is empty on purpose. Returning the rejected chunks would let
 * a client present them as citations for an answer that was never produced.
 */
export const insufficientContextResponse = ({ question, grounding }) => ({
  question,
  answer: INSUFFICIENT_CONTEXT_MESSAGE,
  groundedSources: [],
  personalizedNotes: [],
  revisionPlan: [
    "Upload or generate material that covers this topic.",
    "Re-read the relevant section of your notes.",
    "Ask again using the terminology your material uses.",
  ],
  suggestedFollowUps: [
    "Which of my materials covers this?",
    "Upload notes on this topic",
  ],
  retrievedContext: [],
  grounding,
});
