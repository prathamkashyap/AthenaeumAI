import { createContext, useContext, useState, useCallback, ReactNode } from "react";
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
  generateQuiz: (file: File, difficulty: string, count?: number) => Promise<QuizData>;
  fetchQuiz: (id: string) => Promise<QuizData>;
  setResult: (result: AttemptResult) => void;
  saveAttempt: (quizId: string, score: number, total: number, answers: number[], durationSeconds?: number) => Promise<{ mistakeAnalyses?: MistakeAnalysis[] } | void>;
  clearError: () => void;
  clearQuiz: () => void;
}

const QuizContext = createContext<QuizContextType | null>(null);

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export function QuizProvider({ children }: { children: ReactNode }) {
  const [currentQuiz, setCurrentQuiz] = useState<QuizData | null>(null);
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [backgroundProcessing, setBackgroundProcessing] = useState<BackgroundProcessing | null>(null);

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
        generateQuiz, fetchQuiz, setResult, saveAttempt, clearError, clearQuiz }}
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
