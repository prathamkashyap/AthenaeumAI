import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { apiFetch } from "@/lib/api";

const API_BASE = "/quiz";

export interface Question {
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
  topic?: string;
}

export interface QuizData {
  quizId: string;
  title: string;
  difficulty: string;
  questionCount: number;
  quiz: Question[];
  materialId?: string;
  /**
   * The indexing job reported by the generation response, or absent.
   *
   * Declared because `generateQuiz` reads it, and reading a field the type does
   * not describe is a type error. This is the `INDEX_MATERIAL` counterpart to
   * `AttemptResult.backgroundProcessing`; the generate response has carried the
   * field since the job-status work, and only the type was missing.
   */
  backgroundProcessing?: BackgroundProcessing | null;
}

export interface AttemptResult {
  score: number;
  total: number;
  answers: number[];
  questions: Question[];
  difficulty: string;
  title: string;
  quizId: string;
  mistakeAnalyses?: MistakeAnalysis[];
  /**
   * The id of the saved attempt, when the server accepted it.
   *
   * The attempt is what mistake-review cards are generated from, so the result
   * page needs this to offer a review set. Absent when the attempt was not
   * persisted, which is also when a review set cannot be built — the two cases
   * are the same condition, so the UI can key off this being present.
   */
  attemptId?: string;
  /**
   * The background job that applies this attempt's learner effects, as reported
   * by the attempt response.
   *
   * The attempt is written before `SYNC_ATTEMPT` is scheduled, so the attempt and
   * its score exist whether or not the job ever ran. This field previously had no
   * home on the result at all: `saveAttempt` declared only `attemptId` and
   * `mistakeAnalyses`, so a job that was never scheduled — meaning topic
   * progress, learning events and the review-queue rebuild were silently never
   * applied — reached the learner as an ordinary-looking score.
   *
   * `SYNC_ATTEMPT` has no read-time recovery the way material indexing has, so
   * this state cannot resolve itself. It is disclosed, not repaired.
   */
  backgroundProcessing?: BackgroundProcessing | null;
}

export interface MistakeAnalysis {
  questionIndex: number;
  topic: string;
  misconception: string;
  clarification: string;
  distractorReason?: string;
  revisionSuggestion: string;
  relatedFlashcards?: string[];
}

/**
 * The retrieval-indexing job attached to a successful upload.
 *
 * `POST /quiz/generate` commits the material and the quiz, then schedules
 * `INDEX_MATERIAL` so the tutor can retrieve from it. That second half is
 * asynchronous, and the response says so explicitly: the material exists whether
 * or not the indexing was ever scheduled.
 *
 * The field is optional because the response only carries it when a job was
 * tracked. A response without it means no job was scheduled at all, which is a
 * different thing from a job that is scheduled and still running — and neither
 * is the same as a job that failed. Keeping them distinct is the whole point of
 * the additive field, so the type does not collapse them into a boolean.
 */
export interface BackgroundProcessing {
  task: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "not_scheduled";
  jobId?: string;
  error?: { code: string | null; message: string | null } | null;
  /**
   * Set when status could not be read, as distinct from the job failing.
   *
   * A failed request tells us nothing about the job. The index may well be
   * running fine, and reporting a tracking failure as a failed index would invent
   * a conclusion the server never drew — and would tell a learner their material
   * is unusable when it may be perfectly searchable.
   */
  trackingError?: string | null;
}

/**
 * A job status as returned by `GET /api/v1/jobs/:id`.
 *
 * That endpoint's projection names the task `type`, not `task`, so the two
 * responses describing the same job do not share a shape. The mapping is done
 * explicitly in one place rather than spread across callers, because a field read
 * from the wrong shape is silently `undefined` and would leave the panel unable
 * to say what it is tracking.
 */
interface JobStatusResponse {
  jobId?: string;
  type?: string;
  status?: BackgroundProcessing["status"];
  error?: { code: string | null; message: string | null } | null;
}

/**
 * True when the status is one the backend will not move away from.
 *
 * The three terminal statuses are a property of the backend's lifecycle rather
 * than of any one component: they are the states `BackgroundJob` refuses to
 * transition out of, so anything asking "is this job still going to change"
 * needs the same answer the server gives. `IndexingStatus` owns it, because it is
 * the only consumer, and a component module that exports helpers defeats React
 * Fast Refresh.
 */
const isTerminalJobStatus = (status: BackgroundProcessing["status"]) =>
  status === "completed" || status === "failed" || status === "not_scheduled";

interface QuizContextType {
  currentQuiz: QuizData | null;
  lastResult: AttemptResult | null;
  isGenerating: boolean;
  generationProgress: string;
  error: string | null;
  /**
   * The indexing job reported by the last successful upload, or `null`.
   *
   * Previously the response's `backgroundProcessing` field was read and thrown
   * away. That made the asynchronous half of an upload invisible: a learner was
   * redirected to their quiz with no way to learn that retrieval indexing had
   * been queued, had failed, or had never been scheduled at all — and indexing is
   * exactly what lets the tutor answer from that material later.
   */
  backgroundProcessing: BackgroundProcessing | null;
  /**
   * Reads the current status of a tracked job.
   *
   * Exposed rather than only used internally so the polling loop and its tests
   * drive the same request the loop makes, and so a caller holding a job id from
   * elsewhere can read it without reaching into the context's internals.
   */
  fetchJobStatus: (jobId: string) => Promise<BackgroundProcessing | null>;
  /**
   * Asks the backend to re-run the tracked terminal job, once.
   *
   * `null` means the attempt was made and rejected, or the request itself did not
   * complete; the tracked job state is left exactly as it was either way, because
   * a failed retry is not evidence about the job itself.
   */
  retryBackgroundJob: (jobId: string) => Promise<BackgroundProcessing | null>;
  generateQuiz: (file: File, difficulty: string, count?: number) => Promise<QuizData>;
  fetchQuiz: (id: string) => Promise<QuizData>;
  setResult: (result: AttemptResult) => void;
  saveAttempt: (quizId: string, score: number, total: number, answers: number[], durationSeconds?: number) => Promise<{ attemptId?: string; mistakeAnalyses?: MistakeAnalysis[]; backgroundProcessing?: BackgroundProcessing | null } | void>;
  clearError: () => void;
  clearQuiz: () => void;
}

const QuizContext = createContext<QuizContextType | null>(null);

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

/**
 * How often a non-terminal job is re-read.
 *
 * A fixed interval, deliberately. The states being watched change over seconds, the
 * cost is a single authenticated read of a small document, and a schedule that
 * adapts would be a second thing to get wrong for no measurable benefit. A poll
 * that stops early is bounded by the first terminal state; one that never stops
 * would be a bug in the loop, not a reason to slow it down.
 */
export const JOB_STATUS_POLL_INTERVAL_MS = 1000;

/** Statuses the backend will not move away from. */
const TERMINAL_STATUSES = new Set<BackgroundProcessing["status"]>([
  "completed",
  "failed",
  "not_scheduled",
]);

/**
 * Wording for a status read that failed. Deliberately says nothing about the job
 * itself, because a transport failure is not a job outcome, and this text is
 * shown whether it is an `INDEX_MATERIAL` or a `SYNC_ATTEMPT` job being followed.
 */
const TRACKING_ERROR = "Could not read the latest background status.";

const isTerminalStatus = (status: BackgroundProcessing["status"]) => TERMINAL_STATUSES.has(status);

export function QuizProvider({ children }: { children: ReactNode }) {
  const [currentQuiz, setCurrentQuiz] = useState<QuizData | null>(null);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [backgroundProcessing, setBackgroundProcessing] = useState<BackgroundProcessing | null>(null);

  const fetchJobStatus = useCallback(async (jobId: string): Promise<BackgroundProcessing | null> => {
    try {
      const res = await apiFetch(`/jobs/${jobId}`);
      if (!res.ok) return null;
      const data = (await res.json()) as JobStatusResponse;
      // A response without a recognisable status is not a status. Returning null
      // keeps the last known state rather than overwriting it with a guess.
      if (!data?.status) return null;
      return {
        task: data.type || "INDEX_MATERIAL",
        status: data.status,
        jobId: data.jobId || jobId,
        error: data.error ?? null,
      };
    } catch {
      // A read that failed says nothing about the job. The caller keeps the last
      // known state and records that tracking failed, rather than concluding the
      // index failed.
      return null;
    }
  }, []);

  /**
   * The job currently being followed, whichever surface reported it.
   *
   * `INDEX_MATERIAL` is tracked on the create-assessment page and `SYNC_ATTEMPT`
   * on the result page, so the two are never live at the same moment. Resolving
   * to one job here is what lets a single polling loop serve both, rather than
   * the result page growing a second interval that would duplicate the loop's
   * terminal-state and transport-failure handling — the two places most likely
   * to be got subtly differently.
   */
  const trackedJob = backgroundProcessing ?? lastResult?.backgroundProcessing ?? null;

  /**
   * Writes an updated job back to whichever slot reported it, so the page that
   * asked for the status is the one that sees it change.
   */
  const applyJobUpdate = useCallback(
    (update: (previous: BackgroundProcessing) => BackgroundProcessing) => {
      setBackgroundProcessing((previous) => (previous ? update(previous) : previous));
      setLastResult((previous) => {
        if (!previous?.backgroundProcessing) return previous;
        return { ...previous, backgroundProcessing: update(previous.backgroundProcessing) };
      });
    },
    []
  );

  /**
   * Re-runs the tracked job through `POST /api/v1/jobs/:id/retry`.
   *
   * It targets the job the page is already tracking, so the retry applies the
   * attempt that was already saved rather than creating a second one. No resource
   * identifiers are sent: the backend derives everything from the job record it
   * already owns, and accepting them from a client would be the one way this
   * endpoint could be pointed at somebody else's attempt.
   *
   * The response is written back through `applyJobUpdate`, which is what makes the
   * existing polling effect pick the job up again: a retried job comes back
   * non-terminal, and the loop is keyed on the status, so no second interval is
   * needed. Any `trackingError` from the failed state is dropped, because it
   * described the *previous* read failure and says nothing about this attempt.
   */
  const retryBackgroundJob = useCallback(
    async (jobId: string): Promise<BackgroundProcessing | null> => {
      try {
        const res = await apiFetch(`/jobs/${jobId}/retry`, { method: "POST" });
        if (!res.ok) return null;

        const data = (await res.json()) as JobStatusResponse;
        if (!data?.status) return null;

        const next: BackgroundProcessing = {
          task: data.type || "SYNC_ATTEMPT",
          status: data.status,
          jobId: data.jobId || jobId,
          error: data.error ?? null,
          trackingError: null,
        };

        applyJobUpdate((previous) => ({ ...next, trackingError: previous?.trackingError ?? null }));
        return next;
      } catch {
        // The terminal state the learner was looking at is still true, so it is
        // deliberately left in place rather than being replaced by a guess.
        return null;
      }
    },
    [applyJobUpdate],
  );

  /**
   * Follows the tracked job until it settles.
   *
   * Depends on the status as well as the job id, and that is load-bearing rather
   * than incidental. The interval's own callback cannot stop itself: by the time
   * a tick learns the job has completed, the timer that fired it is already
   * scheduled, and an effect keyed only on the job id would not re-run to clear
   * it. Keying on the status makes the terminal state tear the loop down through
   * the effect's own cleanup.
   *
   * The cost is that a non-terminal transition restarts the interval, which resets
   * the countdown. With a one-second period and a handful of transitions that is
   * irrelevant, and it is the reason the loop cannot outlive its job.
   */
  useEffect(() => {
    const jobId = trackedJob?.jobId;
    const status = trackedJob?.status;

    if (!jobId || !status || isTerminalStatus(status)) return;

    let cancelled = false;

    const poll = async () => {
      const latest = await fetchJobStatus(jobId);
      if (cancelled) return;

      if (!latest) {
        // Keep the status we already have; only the tracking is degraded. A read
        // that failed is not evidence the job failed, and writing `failed` here
        // would tell a learner their attempt was not applied when it may have been.
        applyJobUpdate((previous) =>
          previous.jobId === jobId
            ? { ...previous, trackingError: TRACKING_ERROR }
            : previous
        );
        return;
      }

      applyJobUpdate((previous) => (previous.jobId === jobId ? latest : previous));
    };

    const timer = setInterval(poll, JOB_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [trackedJob?.jobId, trackedJob?.status, fetchJobStatus, applyJobUpdate]);

  const generateQuiz = useCallback(async (file: File, difficulty: string, count: number = 5): Promise<QuizData> => {
    setIsGenerating(true);
    setError(null);
    setGenerationProgress("Uploading document...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("difficulty", difficulty);
      formData.append("count", String(count));
      setGenerationProgress("Extracting text from PDF...");
      const res = await apiFetch(`${API_BASE}/generate`, { method: "POST", body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Server error" }));
        throw new Error(errData.error || `Server error (${res.status})`);
      }
      setGenerationProgress("Generating AI questions...");
      const data: QuizData = await res.json();
      if (!data.quiz || data.quiz.length === 0) {
        throw new Error("No questions were generated. Try a different document.");
      }
      // Retained rather than discarded. The quiz and the material are already
      // committed at this point, so whatever this field reports is the only
      // signal the learner has about whether the retrieval index that makes their
      // material tutorable is being built, has failed, or was never scheduled.
      setBackgroundProcessing(data.backgroundProcessing ?? null);
      setCurrentQuiz(data);
      setGenerationProgress("");
      return data;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to generate quiz"));
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const fetchQuiz = useCallback(async (id: string): Promise<QuizData> => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/${id}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Quiz not found" }));
        throw new Error(errData.error || "Failed to fetch quiz");
      }
      const data = await res.json();
      const quizData: QuizData = {
        quizId: data._id,
        title: data.title,
        difficulty: data.difficulty,
        questionCount: data.questionCount,
        quiz: data.questions,
      };
      setCurrentQuiz(quizData);
      return quizData;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to fetch quiz"));
      throw err;
    }
  }, []);

  const setResult = useCallback((result: AttemptResult) => setLastResult(result), []);

  const saveAttempt = useCallback(async (quizId: string, score: number, total: number, answers: number[], durationSeconds: number = 0) => {
    try {
      if (quizId.startsWith("temp-")) return;
      const response = await apiFetch(`${API_BASE}/${quizId}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, total, answers, durationSeconds }),
      });
      if (response.ok) return response.json();
    } catch (err) {
      console.warn("Failed to save attempt:", err);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearQuiz = useCallback(() => {
    setCurrentQuiz(null);
    setLastResult(null);
    // Cleared with the quiz. A stale indexing status from a previous upload
    // would otherwise be shown against material the learner is no longer looking
    // at, and a terminal status from the last upload would be indistinguishable
    // from the current one.
    setBackgroundProcessing(null);
  }, []);

  return (
    <QuizContext.Provider
      value={{ currentQuiz, lastResult, isGenerating, generationProgress, error, backgroundProcessing,
        fetchJobStatus,
        retryBackgroundJob,
        generateQuiz,
        fetchQuiz,
        setResult,
        saveAttempt,
        clearError,
        clearQuiz,
      }}
    >
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() {
  const context = useContext(QuizContext);
  if (!context) throw new Error("useQuiz must be used within a QuizProvider");
  return context;
}
