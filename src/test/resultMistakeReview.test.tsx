/**
 * Result page — mistake review decks
 * ===================================
 *
 * The result page already offered a "Make Flashcards" action, but it asked the
 * backend for `sourceType: "quiz"`, which generates cards from *every* question
 * in the quiz — including the ones the learner just answered correctly. After a
 * scored attempt that rehearses the wrong material, and the learner's actual
 * mistakes were not the input to anything.
 *
 * These tests pin the narrower action that was added alongside it: a deck built
 * from the attempt's recorded wrong answers. The properties treated as
 * load-bearing are
 *
 *   - the action is offered only when there is genuinely something to review;
 *   - the request names the attempt, so the server selects from the attempt's
 *     own record of wrong answers rather than re-deriving from the quiz;
 *   - a failure is reported and leaves the recorded result visibly intact.
 *
 * The component is driven through the real request path with only the API client,
 * the layout shell and the quiz context replaced. Assertions use accessible role
 * and text rather than class names, so restyling cannot make a wrong state look
 * right and a copy edit cannot make a right state look wrong.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { useQuiz, navigate } = vi.hoisted(() => ({ useQuiz: vi.fn(), navigate: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("@/context/QuizContext", () => ({ useQuiz }));

import ResultAssessment from "@/pages/ResultAssessment";

const QUESTIONS = [
  { question: "Deadlock conditions?", options: ["a", "b", "c", "d"], answer: 1, explanation: "Four together.", topic: "Deadlock" },
  { question: "What is a semaphore?", options: ["a", "b"], answer: 0, explanation: "A counter.", topic: "Sync" },
];

// Two wrong answers, so the mistake deck has something to build from.
const mixedResult = {
  score: 0,
  total: 2,
  answers: [2, 1],
  questions: QUESTIONS,
  difficulty: "Medium",
  title: "OS Notes",
  quizId: "quiz-1",
  attemptId: "attempt-1",
  mistakeAnalyses: [
    { questionIndex: 0, topic: "Deadlock", misconception: "Confused", clarification: "Four.", revisionSuggestion: "Re-read." },
    { questionIndex: 1, topic: "Sync", misconception: "Confused", clarification: "A counter.", revisionSuggestion: "Re-read." },
  ],
};

const renderWith = (result: unknown) => {
  useQuiz.mockReturnValue({ lastResult: result, clearQuiz: vi.fn() });
  return render(<ResultAssessment />);
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ ok: true, status: 201 });
});

describe("the offer to review mistakes", () => {
  it("is offered when the attempt recorded wrong answers", () => {
    renderWith(mixedResult);

    expect(screen.getByRole("button", { name: /review my 2 mistakes/i })).toBeTruthy();
  });

  it("is withheld on a perfect attempt, where it would only rehearse correct answers", () => {
    // Both answers correct. A deck from here would be built from questions the
    // learner has just demonstrated they know, so the action is not offered.
    renderWith({ ...mixedResult, score: 2, answers: [1, 0] });

    expect(screen.queryByRole("button", { name: /review my \d+ mistakes?/i })).toBeNull();
  });

  it("is withheld when the attempt was not persisted, since there is nothing to build from", () => {
    // `attemptId` is absent whenever the save request did not succeed. Offering the
    // action then could only produce a guaranteed failure.
    const { attemptId, ...withoutAttempt } = mixedResult;
    renderWith(withoutAttempt);

    expect(screen.queryByRole("button", { name: /review my \d+ mistakes?/i })).toBeNull();
  });

  it("uses the singular for a single mistake", () => {
    renderWith({ ...mixedResult, answers: [2, 0] });

    expect(screen.getByRole("button", { name: /review my 1 mistake$/i })).toBeTruthy();
  });
});

describe("what the request asks for", () => {
  it("names the attempt and the mistakes source, not the quiz", async () => {
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /review my 2 mistakes/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe("/flashcards/generate");

    const body = JSON.parse(options.body);
    // The attempt is what records which answers were wrong, so naming it lets the
    // server select from the attempt's own record. `sourceType: "quiz"` would
    // have regenerated every question and discarded the distinction entirely.
    expect(body).toMatchObject({ sourceType: "mistakes", sourceId: "attempt-1" });
  });

  it("leaves the whole-quiz action as a separate, unchanged request", async () => {
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /make flashcards/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    // The pre-existing action keeps its old behaviour: the full quiz.
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({
      sourceType: "quiz",
      sourceId: "quiz-1",
    });
  });
});

describe("a failure is reported and does not disturb the result", () => {
  it("reports a server fault and leaves the score standing", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /review my 2 mistakes/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/unaffected/i);

    // The recorded result is untouched: the attempt was saved by an earlier
    // request, and the deck is built after the fact. The wrong-answer count the
    // page was already showing still reads the same, which is the observable form
    // of "the result is unaffected".
    expect(screen.getByText("2 wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: /review my 2 mistakes/i })).toBeTruthy();
  });

  it("reports a refusal to build a set as nothing-to-review", async () => {
    // The server declines a 400 when the attempt turns out to have no incorrect
    // answers, which the client could not know if the analysis had degraded.
    apiFetch.mockResolvedValue({ ok: false, status: 400 });
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /review my 2 mistakes/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing to review/i);
  });

  it("reports an unreachable server without blaming the attempt", async () => {
    apiFetch.mockRejectedValue(new Error("network down"));
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /review my 2 mistakes/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/unaffected/i);
  });

  it("does not report a failure that did not happen", async () => {
    renderWith(mixedResult);

    fireEvent.click(screen.getByRole("button", { name: /review my 2 mistakes/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/flashcards"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("re-enables the action after a failure so it can be retried", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    renderWith(mixedResult);

    const button = screen.getByRole("button", { name: /review my 2 mistakes/i });
    fireEvent.click(button);
    await screen.findByRole("alert");

    // Left disabled, a transient fault would strand the learner with no way to
    // try again.
    expect(button).not.toBeDisabled();
  });
});
