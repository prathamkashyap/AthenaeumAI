import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuiz } from "@/context/QuizContext";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Home,
  Trophy,
  Target,
  Clock,
  Sparkles,
  BookOpen,
} from "lucide-react";

const ResultAssessment = () => {
  const navigate = useNavigate();
  const { lastResult, clearQuiz } = useQuiz();
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!lastResult) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4 animate-fade-in">
            <Trophy className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No results available</p>
            <Button
              variant="outline"
              onClick={() => navigate("/assessments/create")}
              className="border-accent text-accent hover:bg-accent/10"
            >
              Take a Quiz
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { score, total, answers, questions, difficulty, title, quizId } = lastResult;
  const percentage = Math.round((score / total) * 100);

  // Performance analysis
  const { grade, gradeColor, message } = useMemo(() => {
    if (percentage >= 90) return { grade: "A+", gradeColor: "text-emerald-400", message: "Outstanding! You've mastered this material." };
    if (percentage >= 80) return { grade: "A", gradeColor: "text-emerald-400", message: "Excellent work! Strong understanding." };
    if (percentage >= 70) return { grade: "B", gradeColor: "text-amber-400", message: "Good performance. A few areas to review." };
    if (percentage >= 60) return { grade: "C", gradeColor: "text-amber-400", message: "Fair result. Consider revisiting key topics." };
    if (percentage >= 50) return { grade: "D", gradeColor: "text-orange-400", message: "Below average. More practice recommended." };
    return { grade: "F", gradeColor: "text-rose-400", message: "Needs improvement. Review the material thoroughly." };
  }, [percentage]);

  const diffColors: Record<string, string> = {
    Easy: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    Medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    Hard: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  };

  // Topic-wise analysis
  const topicAnalysis = useMemo(() => {
    const topics: Record<string, { correct: number; total: number }> = {};
    questions.forEach((q, i) => {
      const topic = q.topic || "General";
      if (!topics[topic]) topics[topic] = { correct: 0, total: 0 };
      topics[topic].total++;
      if (answers[i] === q.answer) topics[topic].correct++;
    });
    return Object.entries(topics).map(([topic, data]) => ({
      topic,
      ...data,
      percentage: Math.round((data.correct / data.total) * 100),
    }));
  }, [questions, answers]);

  const displayedQuestions = showAll ? questions : questions.slice(0, 5);

  // SVG ring parameters
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage / 100);

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
        {/* Score Header */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-hero p-8 lg:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,hsl(38_55%_58%/0.08),transparent_50%)]" />
          <div className="relative flex flex-col lg:flex-row items-center gap-8">
            {/* Animated Score Ring */}
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60" cy="60" r={radius}
                  fill="none"
                  stroke="hsl(var(--border))"
                  strokeWidth="8"
                />
                <circle
                  cx="60" cy="60" r={radius}
                  fill="none"
                  stroke="hsl(var(--accent))"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  className="transition-all duration-1000 ease-out"
                  style={{ animationDelay: "300ms" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-serif text-4xl ${gradeColor} leading-none`}>{grade}</span>
                <span className="text-xs text-muted-foreground mt-1">{percentage}%</span>
              </div>
            </div>

            <div className="flex-1 text-center lg:text-left space-y-3">
              <Badge className={`${diffColors[difficulty] || diffColors.Easy} text-[10px] font-mono`}>
                {difficulty}
              </Badge>
              <h1 className="font-serif text-3xl lg:text-4xl text-foreground">{title}</h1>
              <p className="text-muted-foreground">{message}</p>

              <div className="flex flex-wrap gap-6 pt-2 justify-center lg:justify-start">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-accent" />
                  <span className="text-sm">
                    <span className="text-foreground font-medium">{score}</span>
                    <span className="text-muted-foreground">/{total} correct</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">{score} right</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-rose-400" />
                  <span className="text-sm text-rose-400">{total - score} wrong</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Topic Analysis */}
        {topicAnalysis.length > 1 && (
          <section>
            <h2 className="font-serif text-xl text-foreground mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-accent" /> Topic Performance
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topicAnalysis.map((t) => (
                <Card key={t.topic} className="academic-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-foreground truncate">{t.topic}</p>
                    <span
                      className={`text-xs font-mono ${
                        t.percentage >= 70 ? "text-emerald-400" : t.percentage >= 50 ? "text-amber-400" : "text-rose-400"
                      }`}
                    >
                      {t.percentage}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        t.percentage >= 70 ? "bg-emerald-500" : t.percentage >= 50 ? "bg-amber-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${t.percentage}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {t.correct}/{t.total} correct
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Question Review */}
        <section>
          <h2 className="font-serif text-xl text-foreground mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> Question Review
          </h2>
          <div className="space-y-3">
            {displayedQuestions.map((q, i) => {
              const userAnswer = answers[i];
              const isCorrect = userAnswer === q.answer;
              const isExpanded = expandedQ === i;

              return (
                <Card
                  key={i}
                  className={`academic-card overflow-hidden transition-all duration-300 ${
                    isCorrect ? "border-emerald-500/20" : "border-rose-500/20"
                  }`}
                >
                  <button
                    onClick={() => setExpandedQ(isExpanded ? null : i)}
                    className="w-full p-4 flex items-start gap-3 text-left"
                  >
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isCorrect
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {isCorrect ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-muted-foreground">Q{i + 1}</span>
                        {q.topic && (
                          <Badge variant="outline" className="text-[9px] border-border/60 text-muted-foreground">
                            {q.topic}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{q.question}</p>
                    </div>

                    <div className="flex-shrink-0 text-muted-foreground">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border/50 animate-fade-in">
                      <div className="space-y-2 mt-3">
                        {q.options.map((opt: string, oi: number) => {
                          const isCorrectOpt = oi === q.answer;
                          const isUserPick = oi === userAnswer;
                          return (
                            <div
                              key={oi}
                              className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                                isCorrectOpt
                                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                                  : isUserPick
                                  ? "bg-rose-500/10 border border-rose-500/20 text-rose-300"
                                  : "bg-muted/20 text-muted-foreground"
                              }`}
                            >
                              <span className="font-mono text-xs w-5">
                                {String.fromCharCode(65 + oi)}
                              </span>
                              <span className="flex-1">{opt}</span>
                              {isCorrectOpt && (
                                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                              )}
                              {isUserPick && !isCorrectOpt && (
                                <XCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {q.explanation && (
                        <div className="mt-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                          <p className="text-[11px] uppercase tracking-wider text-accent mb-1 font-medium">
                            Explanation
                          </p>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {q.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {questions.length > 5 && (
            <Button
              variant="ghost"
              className="w-full mt-3 text-accent hover:text-accent hover:bg-accent/5"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <>Show Less <ChevronUp className="h-4 w-4 ml-1" /></>
              ) : (
                <>Show All {questions.length} Questions <ChevronDown className="h-4 w-4 ml-1" /></>
              )}
            </Button>
          )}
        </section>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-4 pb-8">
          <Button
            variant="outline"
            onClick={() => {
              clearQuiz();
              navigate("/assessments/create");
            }}
            className="border-border hover:border-accent hover:text-accent"
          >
            <RotateCcw className="h-4 w-4 mr-2" /> New Quiz
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="border-border hover:border-accent hover:text-accent"
          >
            <Home className="h-4 w-4 mr-2" /> Dashboard
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default ResultAssessment;