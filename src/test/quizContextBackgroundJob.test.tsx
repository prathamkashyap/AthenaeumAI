/**
 * QuizContext — the indexing job must survive the response
 * ========================================================
 *
 * The original defect: `generateQuiz` received `backgroundProcessing` from the
 * upload response and discarded it. Nothing else in the client was affected, no
 * test failed, and the asynchronous half of every upload was invisible.
 *
 * A test that stubs this provider cannot catch that, because stubbing the
 * provider also stubs the line that drops the field — the mock would faithfully
 * reproduce the bug. So this suite renders the real `QuizProvider` and drives it
 * through a stubbed API client, which is the only level at which the assignment
 * is observable.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  API_ROOT: "",
  authHeaders: () => ({}),
}));

import { QuizProvider, useQuiz } from "@/context/QuizContext";

const QUIZ = {
  quizId: "6abbf2e9b01acd4afb38b1dd",
  title: "Demo Material",
  difficulty: "Medium",
  questionCount: 2,
  quiz: [{ question: "q1", options: ["a", "b"], answer: 0 }],
};

/** Renders the real provider and reports what it retained. */
const Probe = () => {
  const { backgroundProcessing, currentQuiz, clearQuiz } = useQuiz();

  return (
    <div>
      <p data-testid="job">
        {backgroundProcessing ? JSON.stringify(backgroundProcessing) : "none"}
      </p>
      <p data-testid="quiz">{currentQuiz?.quizId ?? "none"}</p>
      <button onClick={() => clearQuiz()}>clear</button>
    </div>
  );
};

const Generate = () => {
  const { generateQuiz, isGenerating } = useQuiz();

  return (
    <button
      disabled={isGenerating}
      onClick={() => {
        const form = new FormData();
        form.append("file", new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" }));
        void generateQuiz(form.get("file") as unknown as File, "Easy", 2).catch(() => {});
      }}
    >
      generate
    </button>
  );
};

/** The stubbed client returns this payload from the upload endpoint. */
const respondWith = (payload: unknown) => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => payload });
};

const generate = async () => {
  fireEvent.click(screen.getByRole("button", { name: "generate" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateQuiz retains the background job", () => {
  it("keeps the indexing status the backend reported", async () => {
    // The defect itself. The field was read from the response and dropped, so the
    // provider held nothing and every downstream consumer saw no job at all.
    respondWith({
      ...QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "queued", jobId: "j-1" },
    });

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();

    await waitFor(() =>
      expect(screen.getByTestId("job")).toHaveTextContent('"status":"queued"'),
    );
    expect(screen.getByTestId("job")).toHaveTextContent('"jobId":"j-1"');
  });

  it("retains a not_scheduled report rather than normalising it away", async () => {
    // The status that most needs to survive: the material and quiz are committed
    // but the index will never be built, and a learner who cannot see that will
    // later meet a tutor that refuses every question for no visible reason.
    respondWith({
      ...QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "not_scheduled", jobId: "j-2" },
    });

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();

    await waitFor(() => expect(screen.getByTestId("job")).toHaveTextContent('"not_scheduled"'));
  });

  it("holds no job when the response reported none", async () => {
    respondWith(QUIZ);

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();

    await waitFor(() => expect(screen.getByTestId("quiz")).toHaveTextContent(QUIZ.quizId));
    expect(screen.getByTestId("job")).toHaveTextContent("none");
  });

  it("still returns the quiz when the upload succeeds", async () => {
    // The provider's existing contract must survive: retaining a field is not a
    // reason to stop doing what it already did.
    respondWith({ ...QUIZ, backgroundProcessing: { task: "INDEX_MATERIAL", status: "running" } });

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();

    await waitFor(() => expect(screen.getByTestId("quiz")).toHaveTextContent(QUIZ.quizId));
  });

  it("reports no job when the upload fails outright", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();

    // A failed upload committed nothing, so there is no job to report and none
    // may be invented.
    await waitFor(() => expect(screen.getByTestId("job")).toHaveTextContent("none"));
    expect(screen.getByTestId("quiz")).toHaveTextContent("none");
  });
});

describe("clearQuiz", () => {
  it("clears the job with the quiz, so a stale status cannot be shown", async () => {
    respondWith({
      ...QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "completed", jobId: "j-3" },
    });

    render(
      <QuizProvider>
        <Probe />
        <Generate />
      </QuizProvider>,
    );
    await generate();
    await waitFor(() => expect(screen.getByTestId("job")).toHaveTextContent("completed"));

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    // A terminal status from a previous upload shown against the current one
    // would be indistinguishable from a fresh result.
    expect(screen.getByTestId("job")).toHaveTextContent("none");
    expect(screen.getByTestId("quiz")).toHaveTextContent("none");
  });
});
