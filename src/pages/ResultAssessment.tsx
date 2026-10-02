import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuiz } from "@/context/QuizContext";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import {
  AlertTriangle,
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
  Layers,
  Loader2,
  Download
} from "lucide-react";

const ResultAssessment = () => {
  const navigate = useNavigate();
  const { lastResult, clearQuiz, retryBackgroundJob } = useQuiz();
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [isCreatingMistakeDeck, setIsCreatingMistakeDeck] = useState(false);
  const [isRetryingJob, setIsRetryingJob] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [mistakeDeckError, setMistakeDeckError] = useState<string | null>(null);


  const {
    score = 0,
    total = 1,
    answers = [],
    questions = [],
    difficulty = "Easy",
    title = "Quiz",
    quizId = "",
    mistakeAnalyses = [],
    attemptId = undefined,
    backgroundProcessing = null,
  } = lastResult || {};

  /**
   * Re-runs the background work for the attempt already on screen.
   *
   * The attempt itself is untouched: the backend retries the job that belongs to
   * it, so this repairs the first attempt rather than producing a second one. The
   * tracked job state is replaced by whatever the server returns, and the existing
   * polling effect resumes from there — there is no second interval here.
   *
   * `isRetryingJob` is what makes a double click harmless: the button is disabled
   * for the duration, and the guard below refuses a concurrent call even if the
   * event fires twice before React re-renders.
   */
  const handleRetryBackgroundJob = async () => {
    const jobId = backgroundProcessing?.jobId;
    if (!jobId || isRetryingJob) return;

    setIsRetryingJob(true);
    setRetryError(null);
    try {
      const updated = await retryBackgroundJob(jobId);
      // A null result means the request did not complete. The terminal state is
      // still true about the attempt, so it stays on screen and the learner is
      // told why nothing happened.
      if (!updated) {
        setRetryError("Could not start the retry. Please try again.");
      }
    } finally {
      setIsRetryingJob(false);
    }
  };

  /**
   * How each state of the attempt's background job is presented.
   *
   * The five states are kept apart on purpose, because collapsing any two of them
   * states something the server did not:
   *
   * - `failed` means the job ran and did not finish;
   * - `not_scheduled` means it never started, which is a different fault with a
   *   different consequence and is the one this page exists to surface;
   * - a `trackingError` means a status *read* failed, which says nothing at all
   *   about the job, so the underlying status is still what gets presented.
   *
   * None of the unapplied states claims the effects were applied, and none
   * promises a repair: nothing re-enqueues the job, so a retake is the only
   * honest remedy this page can point at.
   */
  const ATTEMPT_JOB_PRESENTATION = {
    pending: {
      title: "Applying this attempt",
      detail:
        "Your score is saved. Your topic progress and review queue are still being updated in the background.",
      Icon: Loader2,
      iconClass: "text-accent",
      badgeClass: "border-accent/40 text-accent",
      badgeText: "Applying",
      retryable: false,
    },
    queued: {
      title: "Applying this attempt",
      detail:
        "Your score is saved. Your topic progress and review queue are still being updated in the background.",
      Icon: Loader2,
      iconClass: "text-accent",
      badgeClass: "border-accent/40 text-accent",
      badgeText: "Queued",
      retryable: false,
    },
    running: {
      title: "Applying this attempt",
      detail:
        "Your score is saved. Your topic progress and review queue are still being updated in the background.",
      Icon: Loader2,
      iconClass: "text-accent",
      badgeClass: "border-accent/40 text-accent",
      badgeText: "Running",
      retryable: false,
    },
    completed: {
      title: "This attempt is fully applied",
      detail:
        "Your score, topic progress and review queue have all been updated with this attempt.",
      Icon: CheckCircle2,
      iconClass: "text-emerald-500",
      badgeClass: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
      badgeText: "Applied",
      retryable: false,
    },
    failed: {
      title: "This attempt's updates did not finish",
      detail:
        "Your score is saved, but the background job ran and did not complete, so this attempt is not reflected in your topic progress or review queue. Retrying continues processing this same attempt.",
      Icon: XCircle,
      iconClass: "text-destructive",
      badgeClass: "border-destructive/40 text-destructive",
      badgeText: "Failed",
      // The backend can re-run the job this attempt belongs to, so the learner is
      // offered that before anything that would create a second attempt.
      retryable: true,
    },
    not_scheduled: {
      title: "This attempt was not applied",
      detail:
        "Your score is saved, but the background job was never started, so this attempt is not reflected in your topic progress or review queue. It can be scheduled again, which applies this attempt rather than a new one.",
      Icon: AlertTriangle,
      iconClass: "text-amber-500",
      badgeClass: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      badgeText: "Not applied",
      retryable: true,
    },
  } as const;

  const attemptJob = backgroundProcessing?.status
    ? ATTEMPT_JOB_PRESENTATION[backgroundProcessing.status]
    : null;
  const percentage = Math.round((score / Math.max(total, 1)) * 100);

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

  const mistakeByQuestion = useMemo(() => {
    const map = new Map<number, typeof mistakeAnalyses[number]>();
    mistakeAnalyses.forEach((analysis) => map.set(analysis.questionIndex, analysis));
    return map;
  }, [mistakeAnalyses]);

  const displayedQuestions = showAll ? questions : questions.slice(0, 5);

  /**
   * The questions this attempt got wrong, derived from the same two arrays the
   * result is already showing rather than from `mistakeAnalyses`. The analyses
   * come from the AI and are absent when analysis was unavailable, whereas the
   * score itself is always known — so a learner is never denied the offer to
   * review a question they demonstrably missed because the AI call degraded.
   */
  const wrongQuestionIndices = useMemo(
    () =>
      questions
        .map((q, i) => ({ q, i }))
        .filter(({ q, i }) => answers[i] !== undefined && answers[i] !== q.answer)
        .map(({ i }) => i),
    [questions, answers]
  );

  // A mistake set is generated from the saved attempt, so it needs the attempt's
  // id. Without one there is nothing to generate from, and offering the action
  // would only produce a guaranteed failure.
  const canReviewMistakes = Boolean(attemptId) && wrongQuestionIndices.length > 0;

  const createFlashcardsFromQuiz = async () => {
    setIsCreatingDeck(true);
    try {
      const response = await apiFetch("/flashcards/generate", {
        method: "POST",
        body: JSON.stringify({ sourceType: "quiz", sourceId: quizId, count: 12 }),
      });
      if (response.ok) navigate("/flashcards");
    } finally {
      setIsCreatingDeck(false);
    }
  };

  /**
   * Builds a review set from the questions this attempt got wrong, rather than
   * from the whole quiz. The "Make Flashcards" action above rehearses every
   * question including the ones already answered correctly, which is a different
   * and much less useful thing after a scored attempt.
   *
   * This runs after the attempt is already recorded and the result is on screen,
   * so a failure here is reported to the learner and nothing else. It cannot
   * affect the attempt: the attempt was saved by a separate, earlier request, and
   * the score above is unaffected either way.
   */
  const createMistakeFlashcards = async () => {
    if (!attemptId) return;
    setIsCreatingMistakeDeck(true);
    setMistakeDeckError(null);
    try {
      const response = await apiFetch("/flashcards/generate", {
        method: "POST",
        body: JSON.stringify({ sourceType: "mistakes", sourceId: attemptId, count: 12 }),
      });
      if (response.ok) {
        navigate("/flashcards");
      } else {
        // A 400 is the server declining — e.g. the attempt turned out to have no
        // incorrect answers, which the client cannot rule out on its own when the
        // mistake analysis degraded. A 5xx is a fault. They are reported
        // differently because the learner's next step differs: one is "there is
        // nothing here", the other is "this failed, the result is fine".
        setMistakeDeckError(
          response.status === 400
            ? "There was nothing to review from this attempt."
            : "Could not build a review deck. Your result is unaffected — try again."
        );
      }
    } catch {
      setMistakeDeckError("Could not reach the server. Your result is unaffected — try again.");
    } finally {
      setIsCreatingMistakeDeck(false);
    }
  };

  const exportToCSV = () => {
    if (!questions || questions.length === 0) return;
    
    // Headers: Question, A, B, C, D, Correct Answer, Explanation
    const headers = ["Question", "Option A", "Option B", "Option C", "Option D", "Correct Answer", "User Answer", "Explanation"];
    
    const rows = questions.map((q, i) => {
      const opts = [
        q.options[0] || "",
        q.options[1] || "",
        q.options[2] || "",
        q.options[3] || ""
      ];
      const correctOpt = String.fromCharCode(65 + q.answer);
      const userOpt = answers[i] !== undefined ? String.fromCharCode(65 + answers[i]) : "Skipped";
      
      return [
        `"${(q.question || "").replace(/"/g, '""')}"`,
        `"${opts[0].replace(/"/g, '""')}"`,
        `"${opts[1].replace(/"/g, '""')}"`,
        `"${opts[2].replace(/"/g, '""')}"`,
        `"${opts[3].replace(/"/g, '""')}"`,
        `"${correctOpt}"`,
        `"${userOpt}"`,
        `"${(q.explanation || "").replace(/"/g, '""')}"`
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `quiz_results_${title.replace(/\s+/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // SVG ring parameters
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage / 100);

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

                      {mistakeByQuestion.has(i) && (
                        <div className="mt-3 p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
                          <p className="text-[11px] uppercase tracking-wider text-rose-300 mb-2 font-medium">
                            AI Mistake Analysis
                          </p>
                          <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                            <p><span className="text-foreground">Misconception:</span> {mistakeByQuestion.get(i)?.misconception}</p>
                            <p><span className="text-foreground">Clarification:</span> {mistakeByQuestion.get(i)?.clarification}</p>
                            {mistakeByQuestion.get(i)?.distractorReason && (
                              <p><span className="text-foreground">Why it looked plausible:</span> {mistakeByQuestion.get(i)?.distractorReason}</p>
                            )}
                            <p><span className="text-foreground">Revision:</span> {mistakeByQuestion.get(i)?.revisionSuggestion}</p>
                          </div>
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
          {!quizId.startsWith("temp-") && (
            <Button
              onClick={createFlashcardsFromQuiz}
              disabled={isCreatingDeck}
              className="bg-accent text-primary-foreground hover:bg-accent/90"
            >
              {isCreatingDeck ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Layers className="h-4 w-4 mr-2" />}
              Make Flashcards
            </Button>
          )}
          {/*
            Offered only when this attempt actually recorded a mistake and has an
            id to generate from. On a perfect attempt the review deck would be
            built from questions the learner already answered correctly, so the
            action is withheld rather than offered and then declined.
          */}
          {canReviewMistakes && (
            <Button
              onClick={createMistakeFlashcards}
              disabled={isCreatingMistakeDeck}
              className="bg-accent text-primary-foreground hover:bg-accent/90"
            >
              {isCreatingMistakeDeck ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Review My {wrongQuestionIndices.length}{" "}
              {wrongQuestionIndices.length === 1 ? "Mistake" : "Mistakes"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={exportToCSV}
            className="border-border hover:border-accent hover:text-accent"
          >
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
        {mistakeDeckError && (
          <p role="alert" className="mt-3 text-sm text-rose-400">
            {mistakeDeckError}
          </p>
        )}

        {/*
          Whether the attempt's adaptive effects were actually applied. The score
          above is correct either way — the attempt is committed before the job is
          scheduled — so this is additional information about what the score did and
          did not feed into, not a qualification of the score itself.

          Rendered for every reported state, including the healthy one, so a
          learner is not left wondering whether the absence of a warning means
          "applied" or merely "not reported".
        */}
        {attemptJob && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-lg border p-4 ${
              backgroundProcessing?.status === "completed"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : backgroundProcessing?.status === "failed" || backgroundProcessing?.status === "not_scheduled"
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border bg-muted/20"
            }`}
          >
            <attemptJob.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${attemptJob.iconClass}`} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium text-foreground">{attemptJob.title}</p>
              <p className="text-xs text-muted-foreground">{attemptJob.detail}</p>
              {attemptJob.retryable && backgroundProcessing?.jobId && (
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRetryingJob}
                    onClick={handleRetryBackgroundJob}
                  >
                    {isRetryingJob ? "Retrying\u2026" : "Retry updating my progress"}
                  </Button>
                  {retryError && (
                    <p className="mt-1 text-xs text-destructive">{retryError}</p>
                  )}
                </div>
              )}
              {backgroundProcessing?.trackingError && (
                <p className="text-xs text-muted-foreground/80">
                  {backgroundProcessing.trackingError} The status shown above is the last one
                  read, not a failure of the job itself.
                </p>
              )}
            </div>
            <Badge variant="outline" className={attemptJob.badgeClass}>
              {attemptJob.badgeText}
            </Badge>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ResultAssessment;
