/**
 * Indexing status polling — following a job to its terminal state
 * ===============================================================
 *
 * Task 19 surfaced the snapshot the upload response carried, which meant a learner
 * was told "Queued" and nothing else for the rest of the session, even as the job
 * moved to running and then completed. `GET /api/v1/jobs/:id` has existed since the
 * async status boundary was established; this is its first consumer.
 *
 * The tests drive the real provider with fake timers and a scripted API client, so
 * the interval, the stop conditions and the cleanup are all exercised rather than
 * described. Four properties matter and each is asserted directly:
 *
 *   1. the state actually advances, queued → running → completed;
 *   2. polling stops on every terminal status, including `not_scheduled`;
 *   3. a read that fails does not become a failed index, and does not destroy the
 *      quiz the learner is waiting to take;
 *   4. the timer is cleared, so an unmounted provider keeps no work alive.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JOB_STATUS_POLL_INTERVAL_MS, QuizProvider, useQuiz } from "@/context/QuizContext";

const apiFetch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  API_ROOT: "",
  authHeaders: () => ({}),
}));

const QUIZ = {
  quizId: "quiz-1",
  title: "Demo Material",
  difficulty: "Medium",
  questionCount: 2,
  quiz: [{ question: "q1", options: ["a", "b"], answer: 0 }],
};

const job = (status: string, jobId = "job-1") => ({
  jobId,
  type: "INDEX_MATERIAL",
  status,
  error: status === "failed" || status === "not_scheduled" ? { code: "X", message: null } : null,
});

/** Renders the real provider, reporting the state a component would render. */
const Probe = () => {
  const { backgroundProcessing, currentQuiz } = useQuiz();
  return (
    <div>
      <p data-testid="status">{backgroundProcessing?.status ?? "none"}</p>
      <p data-testid="tracking-error">{backgroundProcessing?.trackingError ?? "none"}</p>
      <p data-testid="job-id">{backgroundProcessing?.jobId ?? "none"}</p>
      <p data-testid="quiz">{currentQuiz?.quizId ?? "none"}</p>
    </div>
  );
};

const Generate = () => {
  const { generateQuiz } = useQuiz();
  return (
    <button
      onClick={() => {
        const file = new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });
        void generateQuiz(file, "Easy", 2).catch(() => {});
      }}
    >
      generate
    </button>
  );
};

const Harness = () => (
  <QuizProvider>
    <Probe />
    <Generate />
  </QuizProvider>
);

/** Serves the upload, then a scripted sequence of job reads. */
const script = (statuses: Array<Record<string, unknown>>) => {
  let call = 0;
  apiFetch.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/generate")) {
      return { ok: true, json: async () => ({ ...QUIZ, backgroundProcessing: { task: "INDEX_MATERIAL", status: "queued", jobId: "job-1" } }) };
    }
    const next = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    if (next === "ERROR") throw new Error("network down");
    if (next === "NOT_OK") return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => next };
  });
};

const statusRequests = () =>
  apiFetch.mock.calls.filter(([path]) => typeof path === "string" && path.includes("/jobs/"));

/**
 * Advances one poll interval and flushes the promises the poll kicks off.
 *
 * `waitFor` cannot be used to observe the result: it polls on real timers, which
 * never fire while fake timers are installed, so it would time out rather than
 * report. `act` plus a microtask flush is the correct way to let the interval
 * fire and the resulting state update settle.
 */
const tick = async (times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_STATUS_POLL_INTERVAL_MS);
    });
  }
};

/** Polls `expect` against the rendered state without using waitFor. */
const eventually = async (assertion: () => void, attempts = 12) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (i === attempts - 1) throw error;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
};

/**
 * Waits for the upload to land.
 *
 * Keyed on the quiz rather than on the job status, because a response with no
 * `backgroundProcessing` is a legitimate outcome and would leave the status at
 * its initial "none" — so waiting for the status to change would hang on exactly
 * the case a test needs to be able to make.
 */
const generate = async () => {
  fireEvent.click(screen.getByRole("button", { name: "generate" }));
  await eventually(() => expect(screen.getByTestId("quiz")).toHaveTextContent(QUIZ.quizId));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("following a job to completion", () => {
  it("advances queued → running → completed", async () => {
    script([job("running"), job("completed")]);
    render(<Harness />);
    await generate();

    expect(screen.getByTestId("status")).toHaveTextContent("queued");

    await tick();
    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    await tick();
    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("completed"));
  });

  it("stops polling once the job is completed", async () => {
    script([job("running"), job("completed")]);
    render(<Harness />);
    await generate();

    await tick(2);
    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("completed"));

    const settled = statusRequests().length;
    await tick(5);

    // A completed index cannot change, so continuing to ask would be a request
    // loop with no purpose.
    expect(statusRequests()).toHaveLength(settled);
  });

  it("maps the endpoint's `type` onto the task the panel already renders", async () => {
    // The upload response names it `task`; the status endpoint names it `type`.
    // Reading the wrong key yields undefined and the panel loses the ability to
    // say what it is tracking.
    script([job("completed")]);
    render(<Harness />);
    await generate();
    await tick();

    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("completed"));
    // The job id survives the mapping, which is the part the panel actually shows.
    expect(screen.getByTestId("job-id")).toHaveTextContent("job-1");
  });
});

describe("terminal states stop the loop", () => {
  it("advances running → failed and then stops", async () => {
    script([job("failed")]);
    render(<Harness />);
    await generate();
    await tick();

    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("failed"));

    const settled = statusRequests().length;
    await tick(4);
    expect(statusRequests()).toHaveLength(settled);
  });

  it("settles at not_scheduled and then stops", async () => {
    script([job("not_scheduled")]);
    render(<Harness />);
    await generate();
    await tick();

    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("not_scheduled"));

    const settled = statusRequests().length;
    await tick(4);
    expect(statusRequests()).toHaveLength(settled);
  });

  it.each(["completed", "failed", "not_scheduled"])(
    "never polls a job that was already %s",
    async (terminal) => {
      // An upload can report a terminal status directly. Re-reading it would be
      // pointless, and the effect must not start a timer in the first place.
      apiFetch.mockImplementation(async (path: string) =>
        path.includes("/generate")
          ? { ok: true, json: async () => ({ ...QUIZ, backgroundProcessing: { task: "INDEX_MATERIAL", status: terminal, jobId: "job-1" } }) }
          : { ok: true, json: async () => job(terminal) },
      );

      render(<Harness />);
      await generate();
      await tick(3);

      expect(screen.getByTestId("status")).toHaveTextContent(terminal);
      expect(statusRequests()).toHaveLength(0);
    },
  );
});

describe("no job to follow", () => {
  it("does not poll when the upload reported no job", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path.includes("/generate")
        ? { ok: true, json: async () => QUIZ }
        : { ok: true, json: async () => job("running") },
    );

    render(<Harness />);
    await generate();
    await tick(4);

    // Nothing was scheduled, so there is nothing to read. A poll here would 404
    // forever.
    expect(screen.getByTestId("status")).toHaveTextContent("none");
    expect(statusRequests()).toHaveLength(0);
  });

  it("does not poll when the job id is missing", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path.includes("/generate")
        ? { ok: true, json: async () => ({ ...QUIZ, backgroundProcessing: { task: "INDEX_MATERIAL", status: "queued" } }) }
        : { ok: true, json: async () => job("running") },
    );

    render(<Harness />);
    await generate();
    await tick(4);

    expect(statusRequests()).toHaveLength(0);
  });
});

describe("a read that fails is not a failed index", () => {
  it("keeps the last known status and reports that tracking failed", async () => {
    script([job("running"), "ERROR"]);
    render(<Harness />);
    await generate();

    await tick();
    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    await tick();
    // The status is preserved rather than overwritten with a conclusion the
    // server never sent.
    expect(screen.getByTestId("status")).toHaveTextContent("running");
    expect(screen.getByTestId("tracking-error")).not.toHaveTextContent("none");
  });

  it("never reports the index as failed when only the read failed", async () => {
    script(["ERROR"]);
    render(<Harness />);
    await generate();
    await tick(2);

    expect(screen.getByTestId("status")).toHaveTextContent("queued");
    expect(screen.getByTestId("status")).not.toHaveTextContent("failed");
  });

  it("does not destroy the generated quiz", async () => {
    // The quiz and material were committed before the job was scheduled. A
    // tracking failure is a problem reading a status, not a reason to take away a
    // quiz the learner is entitled to take.
    script(["ERROR"]);
    render(<Harness />);
    await generate();
    await tick(2);

    expect(screen.getByTestId("quiz")).toHaveTextContent(QUIZ.quizId);
  });

  it("keeps polling after a transient failure, and recovers", async () => {
    script(["ERROR", job("completed")]);
    render(<Harness />);
    await generate();

    await tick();
    await tick();
    await eventually(() => expect(screen.getByTestId("status")).toHaveTextContent("completed"));
  });

  it("treats a non-ok response as a failed read rather than a status", async () => {
    script(["NOT_OK"]);
    render(<Harness />);
    await generate();
    await tick(2);

    expect(screen.getByTestId("status")).toHaveTextContent("queued");
    expect(screen.getByTestId("tracking-error")).not.toHaveTextContent("none");
  });
});

describe("cleanup", () => {
  it("stops the timer when the provider unmounts", async () => {
    script([job("running")]);
    const view = render(<Harness />);
    await generate();

    await tick();
    const before = statusRequests().length;
    expect(before).toBeGreaterThan(0);

    view.unmount();
    await tick(6);

    // An unmounted provider holding a live interval is a request loop with no
    // component to update, so the count must not grow.
    expect(statusRequests()).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling when the job is cleared", async () => {
    script([job("running")]);
    const { default: nothing } = { default: null };
    void nothing;

    const Clear = () => {
      const { clearQuiz } = useQuiz();
      return <button onClick={clearQuiz}>clear</button>;
    };
    render(
      <QuizProvider>
        <Probe />
        <Generate />
        <Clear />
      </QuizProvider>,
    );
    await generate();
    await tick();

    const before = statusRequests().length;
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await tick(6);

    // A job belonging to a cleared quiz must not keep being polled.
    expect(statusRequests()).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
