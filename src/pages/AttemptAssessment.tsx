import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuiz, Question } from "@/context/QuizContext";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  Send,
  Loader2,
} from "lucide-react";

const AttemptAssessment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentQuiz, fetchQuiz, setResult, saveAttempt } = useQuiz();

  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch quiz if not in context
  useEffect(() => {
    if (!currentQuiz && id && !id.startsWith("temp-")) {
      setIsLoading(true);
      fetchQuiz(id).finally(() => setIsLoading(false));
    }
  }, [id, currentQuiz, fetchQuiz]);

  const questions = currentQuiz?.quiz || [];
  const difficulty = currentQuiz?.difficulty || "Easy";
  const title = currentQuiz?.title || "Quiz";

  // Initialize answers array
  useEffect(() => {
    if (questions.length > 0 && answers.length === 0) {
      setAnswers(new Array(questions.length).fill(null));
    }
  }, [questions.length, answers.length]);

  // Timer
  useEffect(() => {
    if (questions.length === 0) return;
    const timer = setInterval(() => setTimeElapsed((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [questions.length]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const answeredCount = useMemo(() => answers.filter((a) => a !== null).length, [answers]);

  const handleSelectOption = (optionIndex: number) => {
    setSelected(optionIndex);
    const updated = [...answers];
    updated[current] = optionIndex;
    setAnswers(updated);
  };

  const handlePrevious = () => {
    if (current > 0) {
      setCurrent(current - 1);
      setSelected(answers[current - 1]);
    }
  };

  const handleNext = () => {
    if (current < questions.length - 1) {
      setCurrent(current + 1);
      setSelected(answers[current + 1]);
    }
  };

  const handleJumpTo = (index: number) => {
    setCurrent(index);
    setSelected(answers[index]);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    let score = 0;
    const finalAnswers = answers.map((a) => (a === null ? -1 : a));

    finalAnswers.forEach((ans, i) => {
      if (ans === questions[i]?.answer) score++;
    });

    // Save attempt to backend
    if (currentQuiz?.quizId) {
      await saveAttempt(currentQuiz.quizId, score, questions.length, finalAnswers);
    }

    setResult({
      score,
      total: questions.length,
      answers: finalAnswers,
      questions,
      difficulty,
      title,
      quizId: currentQuiz?.quizId || "",
    });

    navigate(`/assessments/${id}/result`);
  };

  // Loading state
  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4 animate-fade-in">
            <Loader2 className="h-10 w-10 text-accent mx-auto animate-spin" />
            <p className="text-muted-foreground">Loading quiz...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  // No questions
  if (!questions.length) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4 animate-fade-in">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No quiz data available</p>
            <Button
              variant="outline"
              onClick={() => navigate("/assessments/create")}
              className="border-accent text-accent hover:bg-accent/10"
            >
              Create New Quiz
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const q = questions[current];

  const diffColors: Record<string, string> = {
    Easy: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    Medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    Hard: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-6 max-w-6xl mx-auto animate-fade-in">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Badge className={`${diffColors[difficulty] || diffColors.Easy} text-[10px] font-mono`}>
              {difficulty}
            </Badge>
            <h1 className="font-serif text-xl text-foreground truncate max-w-[300px]">{title}</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">{formatTime(timeElapsed)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="text-accent font-medium">{answeredCount}</span>/{questions.length} answered
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_240px] gap-6">
          {/* Main Question Area */}
          <div className="space-y-6">
            <Card className="academic-card p-6 lg:p-8">
              {/* Question Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-sm font-mono text-accent">
                  {current + 1}
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    Question {current + 1} of {questions.length}
                  </p>
                </div>
                {q.topic && (
                  <Badge variant="outline" className="text-[10px] border-border/60 text-muted-foreground font-mono">
                    {q.topic}
                  </Badge>
                )}
              </div>

              {/* Question Text */}
              <p className="text-lg lg:text-xl text-foreground leading-relaxed mb-8 font-serif">
                {q.question}
              </p>

              {/* Options */}
              <div className="space-y-3">
                {q.options.map((opt: string, i: number) => {
                  const isSelected = selected === i;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSelectOption(i)}
                      className={`w-full flex items-center gap-4 p-4 rounded-lg border text-left transition-all duration-200 group ${
                        isSelected
                          ? "border-accent/50 bg-accent/10 ring-1 ring-accent/20"
                          : "border-border hover:border-border/80 bg-card/30 hover:bg-card/60"
                      }`}
                    >
                      <div
                        className={`h-8 w-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-mono transition-colors ${
                          isSelected
                            ? "border-accent bg-accent text-primary-foreground"
                            : "border-border group-hover:border-muted-foreground text-muted-foreground"
                        }`}
                      >
                        {String.fromCharCode(65 + i)}
                      </div>
                      <span
                        className={`text-sm transition-colors ${
                          isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                        }`}
                      >
                        {opt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={current === 0}
                className="border-border hover:border-accent hover:text-accent"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>

              {current === questions.length - 1 ? (
                <Button
                  onClick={() => setShowConfirm(true)}
                  className="bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow"
                >
                  <Send className="h-4 w-4 mr-2" /> Submit Quiz
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleNext}
                  className="border-border hover:border-accent hover:text-accent"
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>

          {/* Question Navigator Sidebar */}
          <div className="hidden lg:block">
            <Card className="academic-card p-4 sticky top-24">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3 font-medium">
                Questions
              </p>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((_, i) => {
                  const isAnswered = answers[i] !== null;
                  const isCurrent = i === current;
                  return (
                    <button
                      key={i}
                      onClick={() => handleJumpTo(i)}
                      className={`h-9 w-full rounded-md flex items-center justify-center text-xs font-mono transition-all duration-200 ${
                        isCurrent
                          ? "bg-accent text-primary-foreground ring-2 ring-accent/30"
                          : isAnswered
                          ? "bg-accent/15 text-accent border border-accent/20"
                          : "bg-muted/40 text-muted-foreground border border-border hover:border-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <div className="h-3 w-3 rounded-sm bg-accent/15 border border-accent/20" />
                  <span>Answered ({answeredCount})</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <div className="h-3 w-3 rounded-sm bg-muted/40 border border-border" />
                  <span>Unanswered ({questions.length - answeredCount})</span>
                </div>
              </div>

              {answeredCount === questions.length && (
                <Button
                  onClick={() => setShowConfirm(true)}
                  size="sm"
                  className="w-full mt-4 bg-gradient-gold text-primary-foreground hover:opacity-90"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Submit All
                </Button>
              )}
            </Card>
          </div>
        </div>

        {/* Submit Confirmation Modal */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <Card className="academic-card p-6 max-w-md w-full mx-4 animate-scale-in">
              <h3 className="font-serif text-xl text-foreground mb-2">Submit Quiz?</h3>
              <p className="text-sm text-muted-foreground mb-1">
                You've answered <span className="text-accent font-medium">{answeredCount}</span> of{" "}
                <span className="text-foreground">{questions.length}</span> questions.
              </p>
              {answeredCount < questions.length && (
                <p className="text-xs text-amber-400 mb-4">
                  ⚠ {questions.length - answeredCount} question(s) left unanswered will be marked wrong.
                </p>
              )}
              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  className="flex-1 border-border"
                  onClick={() => setShowConfirm(false)}
                >
                  Review
                </Button>
                <Button
                  className="flex-1 bg-gradient-gold text-primary-foreground hover:opacity-90"
                  onClick={() => {
                    setShowConfirm(false);
                    handleSubmit();
                  }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Confirm Submit"
                  )}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default AttemptAssessment;