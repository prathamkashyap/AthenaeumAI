/**
 * Result page — retrying a terminal attempt job
 * ==============================================
 *
 * The attempt and its score are committed before `SYNC_ATTEMPT` is scheduled,
 * and nothing re-enqueues a job that ended terminally. Retaking the quiz was
 * therefore the only offered remedy, and that is a poor one: it creates a *second*
 * attempt rather than applying the first, so a single lost background job quietly
 * became two records.
 *
 * The backend can now re-run the job that belongs to an existing attempt. This
 * suite pins the properties that make surfacing that safe:
 *
 *   - the action targets the job the page is already tracking, so the attempt on
 *     screen is the one that gets applied and no second attempt is created;
 *   - no resource identifiers are sent, because the backend derives them from the
 *     job record it already owns;
 *   - a retry hands the job back to the *existing* polling loop rather than
 *     starting another one, so there is exactly one place that decides when a job
 *     is settled and how a transport failure is reported;
 *   - an in-flight retry cannot be double-submitted;
 *   - a failed retry leaves the terminal state and the job id intact, because the
 *     attempt really is still unapplied and saying otherwise would be a lie;
 *   - retry availability is a property of the *job* state, so `completed` and an
 *     unreadable status are unaffected.
 *
 * The real context, the real retry call and the real result page are driven
 * together. Only `apiFetch`, the layout shell and the router are replaced.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  QuizProvider,
  useQuiz,
  JOB_STATUS_POLL_INTERVAL_MS,
  type AttemptResult,
} from "@/context/QuizContext";
import ResultAssessment from "@/pages/ResultAssessment";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const ATTEMPT = {
  score: 3,
  total: 5,
  answers: [0, 1, 2],
  questions: [
    { question: "Deadlock conditions?", options: ["a", "b", "c", "d"], answer: 1, explanation: "", topic: "Deadlock" },
  ],
  difficulty: "Medium",
  title: "OS Notes",
  quizId: "quiz-1",
  mistakeAnalyses: [],
  attemptId: "attempt-1",
};

const terminalJob = (status: "failed" | "not_scheduled"): AttemptResult["backgroundProcessing"] => ({
  task: "SYNC_ATTEMPT",
  status,
  jobId: "job-1",
});

/**
 * Routes the three things this page can ask for. The retry path is matched before
 * the generic job-status read so a retry is never mistaken for a poll.
 */
const routeApi = ({
  retryBody,
  statusBody,
  retryImpl,
}: {
  retryBody?: unknown;
  statusBody?: unknown;
  retryImpl?: () => Promise<unknown>;
} = {}) => {
  apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/retry")) {
      void init;
      return retryImpl ? retryImpl() : Promise.resolve(ok(retryBody));
    }
    if (path.startsWith("/jobs/")) {
      void init;
      return Promise.resolve(ok(statusBody ?? { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" }));
    }
    if (path.startsWith("/flashcards/due")) return Promise.resolve(ok({ cards: [], dueCount: 0 }));
    if (path.startsWith("/analytics/dashboard")) return Promise.resolve(ok({}));
    return Promise.resolve(ok({}));
  });
};

const renderResult = (backgroundProcessing: AttemptResult["backgroundProcessing"]) =>
  render(
    <QuizProvider>
      <Harness initial={{ ...ATTEMPT, backgroundProcessing }} />
    </QuizProvider>,
  );

function Harness({ initial }: { initial: AttemptResult }) {
  const { setResult, lastResult } = useQuiz();
  useEffect(() => {
    setResult(initial);
  }, [setResult, initial]);
  return (
    <>
      <div data-testid="tracked">{JSON.stringify(lastResult?.backgroundProcessing ?? null)}</div>
      <ResultAssessment />
    </>
  );
}

// Matches both the idle label and the in-flight one, so the button stays
// addressable while it is disabled and relabelled as "Retrying…".
const retryButton = () => screen.queryByRole("button", { name: /^retry/i });

const trackedJob = () => JSON.parse(screen.getByTestId("tracked").textContent || "null");

const callsTo = (fragment: string) =>
  apiFetch.mock.calls.filter(([url]) => String(url).includes(fragment));

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("retrying a terminal attempt job from the result page", () => {
  it("offers the action for a failed job", async () => {
    routeApi();
    renderResult(terminalJob("failed"));

    expect(await screen.findByRole("button", { name: /^retry/i })).toBeTruthy();
    expect(screen.getByText(/retries? continues? processing this same attempt|continues processing this same attempt/i)).toBeTruthy();
  });

  it("offers the action for a not_scheduled job and explains the reschedule", async () => {
    routeApi();
    renderResult(terminalJob("not_scheduled"));

    expect(await screen.findByRole("button", { name: /^retry/i })).toBeTruthy();
    expect(screen.getByText(/scheduled again, which applies this attempt/i)).toBeTruthy();
  });

  it("does not offer the action for a completed job", async () => {
    routeApi();
    renderResult({ task: "SYNC_ATTEMPT", status: "completed", jobId: "job-1" });

    expect(await screen.findByText(/this attempt is fully applied/i)).toBeTruthy();
    expect(retryButton()).toBeNull();
  });

  it("targets the job id the page is already tracking", async () => {
    routeApi({ retryBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" } });
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));

    await waitFor(() => expect(callsTo("/jobs/job-1/retry")).toHaveLength(1));
    expect(callsTo("/jobs/job-1/retry")[0][0]).toBe("/jobs/job-1/retry");
  });

  it("sends no resource identifiers in the request body", async () => {
    routeApi({ retryBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" } });
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));

    await waitFor(() => expect(callsTo("/retry")).toHaveLength(1));
    const init = callsTo("/retry")[0][1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    // The attempt, quiz and user are all derived server-side from the job record.
    expect(init?.body).toBeUndefined();
  });

  it("writes the returned job state back into the tracked job", async () => {
    routeApi({ retryBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" } });
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));

    await waitFor(() => expect(trackedJob()?.status).toBe("queued"));
    // A retry clears the previous read failure: it described the old state.
    expect(trackedJob()?.trackingError ?? null).toBeNull();
  });

  it("resumes the existing polling loop instead of starting another", async () => {
    routeApi({
      retryBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" },
      statusBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "completed" },
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));
    await waitFor(() => expect(trackedJob()?.status).toBe("queued"));

    // Only intervals at the poll period are the application's; testing-library
    // schedules its own short timers, so counting every setInterval would measure
    // the harness rather than the page.
    const pollIntervals = () =>
      setIntervalSpy.mock.calls.filter(([, delay]) => delay === JOB_STATUS_POLL_INTERVAL_MS);

    // Exactly one polling loop exists for the whole page, and it is the context's.
    expect(pollIntervals()).toHaveLength(1);

    // The poll period is 1000ms, so the default 1000ms wait would race it.
    await vi.waitFor(() => expect(trackedJob()?.status).toBe("completed"), { timeout: 4000 });
    // A settled job tears its own loop down rather than leaving it running.
    expect(pollIntervals()).toHaveLength(1);
    setIntervalSpy.mockRestore();
  });

  it("does not create or navigate to a second attempt", async () => {
    routeApi({ retryBody: { jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" } });
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));
    await waitFor(() => expect(trackedJob()?.status).toBe("queued"));

    expect(callsTo("/attempt")).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cannot be double-submitted while the request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    routeApi({
      retryImpl: () => new Promise((resolve) => { release = resolve; }),
    });
    renderResult(terminalJob("failed"));

    const button = await screen.findByRole("button", { name: /^retry/i });
    fireEvent.click(button);

    await waitFor(() => expect(retryButton()).toBeDisabled());
    // A second click while disabled cannot produce a second request.
    fireEvent.click(retryButton()!);
    fireEvent.click(retryButton()!);

    expect(callsTo("/retry")).toHaveLength(1);

    release(ok({ jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" }));
    await waitFor(() => expect(trackedJob()?.status).toBe("queued"));
    expect(callsTo("/retry")).toHaveLength(1);
  });

  it("keeps the terminal state and shows an actionable error when the retry fails", async () => {
    routeApi();
    apiFetch.mockImplementation((url: string) => {
      const path = String(url);
      if (path.endsWith("/retry")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (path.startsWith("/jobs/")) return Promise.resolve(ok({ jobId: "job-1", type: "SYNC_ATTEMPT", status: "queued" }));
      return Promise.resolve(ok({}));
    });
    renderResult(terminalJob("failed"));

    fireEvent.click(await screen.findByRole("button", { name: /^retry/i }));

    expect(await screen.findByText(/could not start the retry/i)).toBeTruthy();
    // The attempt really is still unapplied, so nothing may claim otherwise and
    // the job must stay reachable for another attempt at the retry.
    expect(screen.getByText(/did not finish/i)).toBeTruthy();
    expect(trackedJob()?.status).toBe("failed");
    expect(trackedJob()?.jobId).toBe("job-1");
    expect(retryButton()).toBeTruthy();
  });

  it("keeps a tracking error distinct from a job failure", async () => {
    routeApi();
    renderResult({
      task: "SYNC_ATTEMPT",
      status: "failed",
      jobId: "job-1",
      trackingError: "Could not read the latest background status.",
    });

    // The retry action is still offered, and the read failure is still reported as
    // a read failure rather than being restated as the job failing.
    expect(await screen.findByRole("button", { name: /^retry/i })).toBeTruthy();
    expect(screen.getAllByText(/could not read the latest background status/i).length).toBeGreaterThan(0);
  });

  it("offers no action when the job could not be identified", async () => {
    routeApi();
    renderResult({ task: "SYNC_ATTEMPT", status: "not_scheduled" });

    expect(await screen.findByText(/this attempt was not applied/i)).toBeTruthy();
    // Without a job id there is nothing to retry, so no action is invented.
    expect(retryButton()).toBeNull();
  });
});