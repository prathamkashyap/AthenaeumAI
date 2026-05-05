import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import {
  Plus,
  BookOpen,
  Clock,
  Trophy,
  Loader2,
  AlertCircle,
  ChevronRight,
  Sparkles,
  FileText,
} from "lucide-react";

interface QuizSummary {
  _id: string;
  title: string;
  difficulty: string;
  questionCount: number;
  sourceFileName: string;
  attemptCount: number;
  bestScore: number | null;
  lastAttempt: string | null;
  createdAt: string;
}

const API_BASE = "http://localhost:3001/api/quiz";

const Assessments = () => {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setQuizzes(data.quizzes || []);
      } catch (err: any) {
        setError(err.message);
        setQuizzes([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, []);

  const diffColors: Record<string, string> = {
    Easy: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    Medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    Hard: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-400";
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffHours < 48) return "Yesterday";
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
              <BookOpen className="h-3.5 w-3.5" /> Assessments
            </div>
            <h1 className="font-serif text-3xl lg:text-4xl text-foreground">Your Quizzes</h1>
            <p className="text-muted-foreground text-sm">
              {quizzes.length > 0
                ? `${quizzes.length} quiz${quizzes.length > 1 ? "zes" : ""} generated`
                : "No quizzes yet. Generate your first one!"}
            </p>
          </div>

          <Button
            asChild
            className="bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow h-11"
          >
            <Link to="/assessments/create">
              <Plus className="h-4 w-4 mr-2" /> New Assessment
            </Link>
          </Button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3 animate-fade-in">
              <Loader2 className="h-8 w-8 text-accent mx-auto animate-spin" />
              <p className="text-sm text-muted-foreground">Loading quizzes...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-amber-400 font-medium">Couldn't load quiz history</p>
              <p className="text-xs text-muted-foreground mt-1">
                The database may be unavailable. You can still create new quizzes.
              </p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && quizzes.length === 0 && (
          <Card className="academic-card p-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-accent" />
            </div>
            <h3 className="font-serif text-xl text-foreground mb-2">No quizzes yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Upload a PDF of your study material and AI will generate exam-style questions for you.
            </p>
            <Button
              asChild
              className="bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow"
            >
              <Link to="/assessments/create">
                <Plus className="h-4 w-4 mr-2" /> Create Your First Quiz
              </Link>
            </Button>
          </Card>
        )}

        {/* Quiz List */}
        {!isLoading && quizzes.length > 0 && (
          <div className="space-y-3">
            {quizzes.map((quiz, i) => (
              <Card
                key={quiz._id}
                className="academic-card p-0 overflow-hidden cursor-pointer group animate-fade-in-up"
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => navigate(`/assessments/${quiz._id}`)}
              >
                <div className="flex items-center gap-4 p-4 lg:p-5">
                  <div className="h-12 w-12 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/15 transition-colors">
                    <FileText className="h-5 w-5 text-accent" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${diffColors[quiz.difficulty] || diffColors.Easy} text-[9px] font-mono`}>
                        {quiz.difficulty}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(quiz.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors truncate">
                      {quiz.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {quiz.questionCount} questions
                      {quiz.attemptCount > 0 && ` · ${quiz.attemptCount} attempt${quiz.attemptCount > 1 ? "s" : ""}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {quiz.bestScore !== null && (
                      <div className="text-right hidden sm:block">
                        <p className={`font-serif text-xl ${scoreColor(quiz.bestScore)}`}>
                          {quiz.bestScore}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">Best Score</p>
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Assessments;