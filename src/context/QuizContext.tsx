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

interface QuizContextType {
  currentQuiz: QuizData | null;
  lastResult: AttemptResult | null;
  isGenerating: boolean;
  generationProgress: string;
  error: string | null;
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
  }, []);

  return (
    <QuizContext.Provider
      value={{ currentQuiz, lastResult, isGenerating, generationProgress, error,
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
