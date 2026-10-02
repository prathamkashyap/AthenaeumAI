/**
 * Result page — the attempt's background job state
 * ================================================
 *
 * The attempt is committed before `SYNC_ATTEMPT` is scheduled, so an attempt and
 * its score exist whether or not the job ever ran. `saveAttempt` declared only
 * `attemptId` and `mistakeAnalyses`, so the response's `backgroundProcessing`
 * field was discarded and the result page had no attempt-job state to render.
 *
 * The consequence is quiet and permanent. Unlike `INDEX_MATERIAL` — which
 * self-heals, because retrieval lazily re-indexes on search, which is why the
 * material UI can honestly advise asking a question to retry — there is no
 * read-time path that applies an attempt's learner effects. A job that was never
 * scheduled means topic progress, learning events and the review-queue rebuild
 * permanently omit that attempt.
 *
 * So this suite pins disclosure. The properties treated as load-bearing:
 *
 *   - the field survives `saveAttempt` and reaches the result;
 *   - `failed` and `not_scheduled` stay apart, because they are different faults
 *     with different consequences;
 *   - a *tracking* failure is never rendered as a job failure, and the last
 *     known status is kept rather than overwritten with a conclusion the server
 *     never drew;
 *   - an unapplied attempt is never described as applied, and no repair is
 *     promised;
 *   - the existing score and mistake-review content is untouched by all of it.
 *
 * The real context, the real submit handler and the real result page are driven
 * together. Only `apiFetch`, the layout shell and the router are replaced.
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
import ResultAssessment from "@/pages/ResultAssessment";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

// Option text is deliberately distinctive: the option buttons are queried by
// their label, and single-letter options would not be uniquely addressable.
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

const MISTAKE_ANALYSES = [
  { questionIndex: 0, topic: "Deadlock", misconception: "Confused", clarification: "Four.", revisionSuggestion: "Re-read." },
];

/** What the attempt endpoint reports for a job that was never scheduled. */
const NOT_SCHEDULED = {
  message: "Attempt saved",
  attemptId: "attempt-1",
  mistakeAnalyses: MISTAKE_ANALYSES,
  backgroundProcessing: { task: "SYNC_ATTEMPT", status: "not_scheduled" },
};

const mockQuizAndAttempt = (attemptPayload: unknown) => {
  apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/attempt")) return Promise.resolve(ok(attemptPayload));
    if (String(url).startsWith("/jobs/")) {
      void init;
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    if (String(url).includes("/quiz/")) {
      return Promise.resolve(ok({ _id: "quiz-1", quizId: "quiz-1", title: "OS Notes", difficulty: "Medium", questions: QUESTIONS }));
    }
    if (String(url).startsWith("/flashcards/due")) {
      return Promise.resolve(ok({ cards: [], dueCount: 0 }));
    }
    if (String(url).startsWith("/analytics/dashboard")) {
      return Promise.resolve(ok({ weakTopics: [] }));
    }
    if (String(url).startsWith("/review-queue")) {
      return Promise.resolve(ok({ items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } }));
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
};

/**
 * Drives the real submit handler and then the real result page, so the assertion
 * is about the field surviving both the context boundary and the page, not about
 * a prop passed in directly.
 */
const submitAndViewResult = async () => {
  function Harness() {
    const { lastResult, setResult } = useQuiz();
    return (
      <>
        <AttemptAssessment />
        {lastResult ? (
          <>
            <div data-testid="carried">{JSON.stringify(lastResult.backgroundProcessing ?? null)}</div>
            <ResultAssessment />
          </>
        ) : null}
        <button onClick={() => setResult({ score: 0, total: 1, answers: [], questions: [], difficulty: "Easy", title: "t", quizId: "" })}>
          set
        </button>
      </>
    );
  }

  render(
    <QuizProvider>
      <Harness />
    </QuizProvider>
  );

  // Answer both questions incorrectly-ish, then submit through the real
  // confirmation modal, so the assertion is about the whole real flow.
  fireEvent.click(await screen.findByRole("button", { name: /preemption only/i }));
  fireEvent.click(await screen.findByRole("button", { name: /^next/i }));
  fireEvent.click(await screen.findByRole("button", { name: /a disk cache/i }));
  fireEvent.click(await screen.findByRole("button", { name: /submit quiz/i }));
  fireEvent.click(await screen.findByRole("button", { name: /confirm submit/i }));

  return screen.findByRole("button", { name: /export csv/i });
};

/**
 * Compile-time half of the contract.
 *
 * `saveAttempt`'s declared return type is where this defect actually lived: the
 * field was present in the response and absent from the type. A runtime assertion
 * cannot observe a type at all — dropping `backgroundProcessing` from the
 * signature changes nothing the browser executes — so a mutation that removes it
 * is invisible to every other test in this file.
 *
 * `tsc --noEmit` is what checks it, and only because this is an object literal
 * assigned to the extracted type: excess-property checking rejects the extra key
 * if the field is no longer declared.
 */
type QuizActions = ReturnType<typeof useQuiz>;
type SaveAttemptResult = NonNullable<Awaited<ReturnType<QuizActions["saveAttempt"]>>>;
const _saveAttemptMustDeclareTheField: SaveAttemptResult = {
  attemptId: "attempt-1",
  mistakeAnalyses: [],
  backgroundProcessing: { task: "SYNC_ATTEMPT", status: "not_scheduled" },
};
void _saveAttemptMustDeclareTheField;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the field survives the saveAttempt boundary", () => {
  it("reaches lastResult rather than being discarded", async () => {
    mockQuizAndAttempt(NOT_SCHEDULED);
    await submitAndViewResult();

    // The defect: this was `null` for every attempt regardless of the response.
    const carried = await screen.findByTestId("carried");
    expect(carried.textContent).toContain('"status":"not_scheduled"');
  });

  it("keeps the attempt id and mistake analyses alongside it", async () => {
    mockQuizAndAttempt(NOT_SCHEDULED);
    await submitAndViewResult();

    // Task 21's fields must survive this change; dropping either would be a
    // regression in a different feature.
    expect(await screen.findByRole("button", { name: /review my 2 mistakes/i })).toBeTruthy();
  });
});

describe("each job state is presented as itself", () => {
  it("presents a not_scheduled attempt as saved but not applied", async () => {
    mockQuizAndAttempt(NOT_SCHEDULED);
    await submitAndViewResult();

    expect(await screen.findByText(/this attempt was not applied/i)).toBeTruthy();
    // The honest consequence: it is not in the adaptive state.
    expect(screen.getByText(/not reflected in your topic progress or review queue/i)).toBeTruthy();
  });

  it("never tells the learner a not_scheduled attempt was applied", async () => {
    mockQuizAndAttempt(NOT_SCHEDULED);
    await submitAndViewResult();

    await screen.findByText(/this attempt was not applied/i);
    expect(screen.queryByText(/have all been updated/i)).toBeNull();
  });

  it("does not promise an automatic repair, and offers only what it can do", async () => {
    // A job id is what makes the job re-runnable, so this case carries one.
    mockQuizAndAttempt({
      ...NOT_SCHEDULED,
      backgroundProcessing: {
        task: "SYNC_ATTEMPT",
        status: "not_scheduled",
        jobId: "job-1",
      },
    });
    await submitAndViewResult();

    await screen.findByText(/this attempt was not applied/i);
    // Retrying is now available and applies this same attempt, so it replaces the
    // retake instruction. What must not appear is a claim that the backend will
    // fix this on its own: nothing reschedules a terminal job by itself.
    expect(screen.getByRole("button", { name: /retry updating my progress/i })).toBeTruthy();
    expect(screen.getByText(/scheduled again, which applies this attempt/i)).toBeTruthy();
    expect(screen.queryByText(/taking the quiz again/i)).toBeNull();
    expect(screen.queryByText(/automatically/i)).toBeNull();
    expect(screen.queryByText(/we will retry/i)).toBeNull();
  });

  it("distinguishes a failed job from a not_scheduled one", async () => {
    mockQuizAndAttempt({
      ...NOT_SCHEDULED,
      backgroundProcessing: { task: "SYNC_ATTEMPT", status: "failed" },
    });
    await submitAndViewResult();

    expect(await screen.findByText(/did not finish/i)).toBeTruthy();
    // Different fault, different wording, and neither is called "applied".
    expect(screen.queryByText(/this attempt was not applied/i)).toBeNull();
    expect(screen.queryByText(/never started/i)).toBeNull();
  });

  it("presents a still-running job as in progress, not as a settled state", async () => {
    mockQuizAndAttempt({
      ...NOT_SCHEDULED,
      backgroundProcessing: { task: "SYNC_ATTEMPT", status: "queued", jobId: "job-1" },
    });
    await submitAndViewResult();

    expect(await screen.findByText(/still being updated in the background/i)).toBeTruthy();
    expect(screen.queryByText(/this attempt was not applied/i)).toBeNull();
    expect(screen.queryByText(/have all been updated/i)).toBeNull();
  });

  it("presents a completed job as applied", async () => {
    mockQuizAndAttempt({
      ...NOT_SCHEDULED,
      backgroundProcessing: { task: "SYNC_ATTEMPT", status: "completed", jobId: "job-1" },
    });
    await submitAndViewResult();

    expect(await screen.findByText(/this attempt is fully applied/i)).toBeTruthy();
  });
});

describe("a status read that fails is not a job that failed", () => {
  it("keeps the last known state and says the read failed", async () => {
    let reads = 0;
    apiFetch.mockImplementation((url: string) => {
      if (String(url).includes("/attempt")) {
        return Promise.resolve(
          ok({ ...NOT_SCHEDULED, backgroundProcessing: { task: "SYNC_ATTEMPT", status: "running", jobId: "job-1" } })
        );
      }
      if (String(url).startsWith("/jobs/")) {
        reads += 1;
        return Promise.reject(new Error("network down"));
      }
      if (String(url).includes("/quiz/")) {
        return Promise.resolve(ok({ _id: "quiz-1", quizId: "quiz-1", title: "OS Notes", difficulty: "Medium", questions: QUESTIONS }));
      }
      if (String(url).startsWith("/flashcards/due")) return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      if (String(url).startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: [] }));
      if (String(url).startsWith("/review-queue")) {
        return Promise.resolve(ok({ items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } }));
      }
      return Promise.reject(new Error("unexpected"));
    });

    await submitAndViewResult();

    // The loop must actually attempt a read for this to be meaningful.
    await waitFor(() => expect(reads).toBeGreaterThan(0), { timeout: 4000 });
    expect((await screen.findAllByText(/could not read the latest background status/i)).length).toBeGreaterThan(0);
    // Still running, emphatically not failed.
    expect(screen.getByText(/still being updated in the background/i)).toBeTruthy();
    expect(screen.queryByText(/did not finish/i)).toBeNull();
  });

  it("settles on completed once a read reports it", async () => {
    let reads = 0;
    apiFetch.mockImplementation((url: string) => {
      if (String(url).includes("/attempt")) {
        return Promise.resolve(
          ok({ ...NOT_SCHEDULED, backgroundProcessing: { task: "SYNC_ATTEMPT", status: "queued", jobId: "job-1" } })
        );
      }
      if (String(url).startsWith("/jobs/")) {
        reads += 1;
        return Promise.resolve(ok({ jobId: "job-1", type: "SYNC_ATTEMPT", status: "completed" }));
      }
      if (String(url).includes("/quiz/")) {
        return Promise.resolve(ok({ _id: "quiz-1", quizId: "quiz-1", title: "OS Notes", difficulty: "Medium", questions: QUESTIONS }));
      }
      if (String(url).startsWith("/flashcards/due")) return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      if (String(url).startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: [] }));
      if (String(url).startsWith("/review-queue")) {
        return Promise.resolve(ok({ items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } }));
      }
      return Promise.reject(new Error("unexpected"));
    });

    await submitAndViewResult();

    // Polling must be able to move the result page from in-progress to applied.
    await waitFor(() => expect(reads).toBeGreaterThan(0), { timeout: 4000 });
    expect(await screen.findByText(/this attempt is fully applied/i, {}, { timeout: 4000 })).toBeTruthy();
  });
});

describe("the existing result is unchanged", () => {
  it("still shows the score and the mistake review", async () => {
    mockQuizAndAttempt(NOT_SCHEDULED);
    await submitAndViewResult();

    // Task 21's mistake-review action and the score itself must both survive.
    expect(await screen.findByRole("button", { name: /review my 2 mistakes/i })).toBeTruthy();
    expect(screen.getByText(/2 wrong/i)).toBeTruthy();
  });

  it("works when the response reports no job at all", async () => {
    // A response without the field is legitimate and must not break the page.
    mockQuizAndAttempt({ message: "Attempt saved", attemptId: "attempt-1", mistakeAnalyses: MISTAKE_ANALYSES });
    await submitAndViewResult();

    expect(screen.getByText(/2 wrong/i)).toBeTruthy();
    // Nothing is claimed in either direction when nothing was reported.
    expect(screen.queryByText(/this attempt is fully applied/i)).toBeNull();
    expect(screen.queryByText(/this attempt was not applied/i)).toBeNull();
  });
});
