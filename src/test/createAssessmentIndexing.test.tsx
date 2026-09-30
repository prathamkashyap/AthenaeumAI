/**
 * Upload flow — surfacing the indexing job
 * ========================================
 *
 * The defect this covers is not in the panel but in what the page did with the
 * upload response. `generateQuiz` read `backgroundProcessing` and threw it away,
 * so the asynchronous half of an upload never reached the screen. The second half
 * of the defect is navigation: the page redirected the instant the quiz existed,
 * so even a rendered panel would have been on screen for zero frames.
 *
 * These tests drive the real page with a stubbed quiz context, so the assertions
 * are about the wiring — that the context's state is rendered, and that the
 * learner continues explicitly — rather than about the panel's copy, which
 * `indexingStatus.test.tsx` covers status by status.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateQuiz = vi.fn();
const navigate = vi.fn();
const contextState = {
  currentQuiz: null as unknown,
  backgroundProcessing: null as unknown,
  isGenerating: false,
  generationProgress: "",
  error: null as string | null,
};

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("@/context/QuizContext", async (importOriginal) => ({
  // Only the provider is stubbed. The panel also imports the real
  // `isTerminalJobStatus`, which decides whether a job id is worth showing, and
  // stubbing it here would mean testing the mock rather than the behaviour.
  ...(await importOriginal<Record<string, unknown>>()),
  useQuiz: () => ({
    ...contextState,
    generateQuiz,
    clearError: vi.fn(),
  }),
}));

import CreateAssessment from "@/pages/CreateAssessment";

const QUIZ = {
  quizId: "6abbf2e9b01acd4afb38b1dd",
  title: "Demo Material",
  difficulty: "Medium",
  questionCount: 5,
  quiz: [
    { question: "q1", options: ["a", "b"], answer: 0 },
    { question: "q2", options: ["a", "b"], answer: 1 },
  ],
};

const setContext = (over: Partial<typeof contextState>) =>
  Object.assign(contextState, {
    currentQuiz: null,
    backgroundProcessing: null,
    isGenerating: false,
    generationProgress: "",
    error: null,
    ...over,
  });

/** Selects a PDF, which is the only accepted drop type. */
const choosePdf = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["%PDF-1.4 test"], "notes.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
};

const clickGenerate = () =>
  fireEvent.click(screen.getByRole("button", { name: /generate 5 questions/i }));

beforeEach(() => {
  vi.clearAllMocks();
  generateQuiz.mockResolvedValue(QUIZ);
  setContext({});
});

describe("before a quiz exists", () => {
  it("shows no indexing panel and no continue action", () => {
    setContext({ backgroundProcessing: { task: "INDEX_MATERIAL", status: "queued", jobId: "j1" } });
    render(<CreateAssessment />);

    // A job for material that has not been committed yet is not a state the
    // backend can produce, and rendering one would imply an upload happened.
    expect(screen.queryByRole("status", { name: /material indexing status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start quiz/i })).not.toBeInTheDocument();
  });
});

describe("after a quiz is generated", () => {
  it("renders the indexing state from the context", async () => {
    setContext({
      currentQuiz: QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "not_scheduled", jobId: "j1" },
    });
    render(<CreateAssessment />);

    expect(screen.getByRole("status", { name: /material indexing status/i })).toBeInTheDocument();
    expect(screen.getByText(/indexing was not scheduled/i)).toBeInTheDocument();
  });

  it("does not navigate on its own, so the state is actually seen", async () => {
    // The original behaviour redirected the moment the quiz existed, which would
    // have unmounted the panel on the same tick it was rendered.
    setContext({
      currentQuiz: QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "running", jobId: "j1" },
    });
    render(<CreateAssessment />);

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /start quiz/i })).toBeInTheDocument();
  });

  it("navigates only when the learner continues", () => {
    setContext({
      currentQuiz: QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "queued", jobId: "j1" },
    });
    render(<CreateAssessment />);

    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));

    expect(navigate).toHaveBeenCalledWith(`/assessments/${QUIZ.quizId}`);
  });

  it("reassures the learner that indexing does not block the quiz", () => {
    setContext({
      currentQuiz: QUIZ,
      backgroundProcessing: { task: "INDEX_MATERIAL", status: "running", jobId: "j1" },
    });
    render(<CreateAssessment />);

    // The two panels make different promises, and both are true: the index is not
    // ready, and the quiz is.
    expect(screen.getByText(/does not\s+block taking the quiz/i)).toBeInTheDocument();
    expect(screen.getByText(/5 questions ready/i)).toBeInTheDocument();
  });
});

describe("a response with no background work reported", () => {
  it("still offers the quiz, with no indexing panel and no claim about indexing", () => {
    setContext({ currentQuiz: QUIZ, backgroundProcessing: null });
    render(<CreateAssessment />);

    expect(screen.getByRole("button", { name: /start quiz/i })).toBeInTheDocument();
    // No panel at all. Absence is not success and not failure, and either label
    // would be a claim the response did not make.
    expect(screen.queryByRole("status", { name: /material indexing status/i })).not.toBeInTheDocument();
  });
});

describe("generation still works end to end through the page", () => {
  it("passes the chosen file, difficulty and count to the context", async () => {
    render(<CreateAssessment />);
    choosePdf();
    clickGenerate();

    await waitFor(() => expect(generateQuiz).toHaveBeenCalledTimes(1));
    const [file, difficulty, count] = generateQuiz.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(difficulty).toBe("Easy");
    expect(count).toBe(5);
  });

  it("does not navigate even when generation succeeds", async () => {
    // Guards the specific regression: the redirect used to happen inside
    // handleGenerate, taking the indexing panel with it.
    render(<CreateAssessment />);
    choosePdf();
    clickGenerate();

    await waitFor(() => expect(generateQuiz).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
