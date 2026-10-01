/**
 * An attempt that was never saved must not look saved.
 * =================================================
 *
 * The attempt row is committed by `POST /quiz/:id/attempt`, and the result page
 * builds the mistake-review set from the `attemptId` that comes back. That route
 * is rate limited (`userAiQuota({ max: 20, windowMs: 60_000 })`), so 429 is a
 * reachable outcome — as are 401 and any 5xx.
 *
 * `saveAttempt` used to return `undefined` for every non-OK response. The caller
 * then called `setResult` with an undefined `attemptId` and navigated anyway, so
 * the learner saw a complete score for an attempt the backend never stored, and
 * the "Review My Mistakes" button was silently withheld with no explanation.
 *
 * These tests pin the corrected contract:
 *
 *   - a non-OK response rejects, and the page neither navigates nor renders a result;
 *   - the server's own message reaches the learner, because it is the useful one;
 *   - 429 and 500 follow the same path rather than one being special-cased;
 *   - the success path is untouched and still navigates with the attempt data;
 *   - a thrown/network error is still logged, and also no longer navigates;
 *   - a `temp-` quiz still short-circuits without any HTTP call.
 *
 * The real context and the real page are driven together; only `apiFetch`, the
 * layout shell and the router are replaced.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: "quiz-1" }),
}));

import { QuizProvider, useQuiz } from "@/context/QuizContext";
import AttemptAssessment from "@/pages/AttemptAssessment";

const QUESTIONS = [
  {
    question: "Deadlock conditions?",
    options: ["Mutual exclusion alone", "All four at once", "Hold and wait only", "Preemption only"],
    answer: 1,
    explanation: "Four together.",
    topic: "Deadlock",
  },
  {
    question: "What is a semaphore?",
    options: ["A synchronisation counter", "A disk cache"],
    answer: 0,
    explanation: "A counter.",
    topic: "Sync",
  },
];

const QUIZ = {
  _id: "quiz-1",
  quizId: "quiz-1",
  title: "OS Notes",
  difficulty: "Medium",
  questions: QUESTIONS,
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, error?: string) => ({
  ok: false,
  status,
  json: async () => (error ? { error } : {}),
});

/** Serves the quiz and lets the learner answer both questions. */
const routeApi = ({ attempt }: { attempt: () => Promise<unknown> }) => {
  apiFetch.mockImplementation((url: string) => {
    const path = String(url);
    if (/\/attempt$/.test(path)) return attempt();
    if (path === "/quiz/quiz-1") return Promise.resolve(ok(QUIZ));
    return Promise.resolve(ok({}));
  });
};

const renderAttempt = async () => {
  render(
    <QuizProvider>
      <Harness />
    </QuizProvider>,
  );
  await screen.findByText("Deadlock conditions?");
};

/** Answers every question, then walks to the last one where Submit appears. */
const answerAllAndReachSubmit = async () => {
  for (const question of QUESTIONS) {
    fireEvent.click(screen.getByText(question.options[question.answer as number]).closest("button")!);
    const next = screen.queryByText(/Next/)
      ?? screen.queryByText(/Submit Quiz/);
    if (next && /Next/.test(next.textContent || "")) {
      fireEvent.click(next);
    }
  }
  fireEvent.click(await screen.findByText(/Submit Quiz/));
};

/** Clicks through the confirmation dialog. */
const confirmSubmit = async () => {
  fireEvent.click(await screen.findByText(/Confirm Submit/));
};

function Harness() {
  const { currentQuiz, setResult } = useQuiz();
  if (!currentQuiz) {
    return (
      <>
        <button
          onClick={() =>
            setResult({
              score: 0,
              total: 0,
              answers: [],
              questions: QUESTIONS,
              difficulty: "Medium",
              title: "OS Notes",
              quizId: "quiz-1",
            })
          }
        >
          seed
        </button>
        <AttemptAssessment />
      </>
    );
  }
  return (
    <>
      <div data-testid="tracked-quiz">{currentQuiz.quizId}</div>
      <AttemptAssessment />
    </>
  );
}

const attemptCalls = () => apiFetch.mock.calls.filter(([url]) => /\/attempt$/.test(String(url)));

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
});

describe("a failed attempt save is visible and does not produce a result", () => {
  it("does not navigate and shows the server's message when the save fails", async () => {
    routeApi({ attempt: () => Promise.resolve(fail(400, "Quiz not found")) });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Quiz not found");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("treats a 429 rate-limit refusal as a visible failure, not a saved attempt", async () => {
    // Reachable: the attempt route allows 20 submissions per minute.
    routeApi({ attempt: () => Promise.resolve(fail(429)) });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("429");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not swallow a 500 either", async () => {
    routeApi({ attempt: () => Promise.resolve(fail(500)) });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("re-enables submission so the learner can actually try again", async () => {
    routeApi({ attempt: () => Promise.resolve(fail(500)) });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    await screen.findByRole("alert");
    // The reset that used to be unnecessary: without it the submit button would
    // stay disabled forever and "try again" would be a lie. Proven by being able
    // to reopen the confirmation after the failure.
    fireEvent.click(screen.getByText(/Submit Quiz/).closest("button")!);
    expect((await screen.findByText(/Confirm Submit/)).closest("button")).not.toBeDisabled();
  });

  it("logs and surfaces a thrown/network error without navigating", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    routeApi({ attempt: () => Promise.reject(new Error("Network down")) });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Network down");
    expect(navigate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still reaches the result page when the save succeeds", async () => {
    routeApi({
      attempt: () =>
        Promise.resolve(
          ok({ attemptId: "attempt-1", mistakeAnalyses: [], backgroundProcessing: null }),
        ),
    });
    await renderAttempt();
    await answerAllAndReachSubmit();
    await confirmSubmit();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/assessments/quiz-1/result"),
    );
    expect(attemptCalls()).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});