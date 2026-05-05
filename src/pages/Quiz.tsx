import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, X, ChevronRight, Eye, Flag, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const question = {
  index: 7,
  total: 20,
  topic: "Operating Systems",
  type: "Multiple Choice",
  text: "Which page replacement algorithm suffers from Belady's anomaly, where increasing the number of page frames can lead to more page faults?",
  options: [
    { id: "a", text: "Least Recently Used (LRU)" },
    { id: "b", text: "First-In-First-Out (FIFO)", correct: true },
    { id: "c", text: "Optimal Page Replacement (OPT)" },
    { id: "d", text: "Most Recently Used (MRU)" },
  ],
  explanation:
    "FIFO can exhibit Belady's anomaly because it does not consider page usage frequency. LRU and OPT are stack algorithms and are immune to this anomaly.",
};

const Quiz = () => {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = () => selected && setSubmitted(true);
  const isCorrect = submitted && question.options.find(o => o.id === selected)?.correct;

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto space-y-6">
        {/* Header strip */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-accent/40 text-accent font-mono text-[10px]">
              {question.topic}
            </Badge>
            <span className="text-muted-foreground text-xs">{question.type}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">12:34</span>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Question {question.index} of {question.total}</span>
            <span className="font-mono">{Math.round((question.index / question.total) * 100)}%</span>
          </div>
          <Progress value={(question.index / question.total) * 100} className="h-1" />
        </div>

        {/* Question card */}
        <Card className="academic-card p-8 lg:p-10 animate-fade-in-up">
          <div className="flex items-start gap-4 mb-8">
            <div className="font-serif text-5xl gold-text leading-none">{String(question.index).padStart(2, "0")}</div>
            <div className="flex-1 pt-2">
              <h2 className="font-serif text-2xl lg:text-3xl leading-snug text-foreground">
                {question.text}
              </h2>
            </div>
          </div>

          <div className="space-y-3">
            {question.options.map((opt) => {
              const isSel = selected === opt.id;
              const showCorrect = submitted && opt.correct;
              const showWrong = submitted && isSel && !opt.correct;
              return (
                <button
                  key={opt.id}
                  disabled={submitted}
                  onClick={() => setSelected(opt.id)}
                  className={cn(
                    "w-full text-left flex items-center gap-4 p-4 rounded-lg border transition-all duration-200",
                    "hover:border-accent/60 hover:bg-muted/40",
                    isSel && !submitted && "border-accent bg-accent/5",
                    !isSel && !submitted && "border-border bg-card/40",
                    showCorrect && "border-emerald-700/60 bg-emerald-950/30",
                    showWrong && "border-destructive/60 bg-destructive/10",
                    submitted && !isSel && !opt.correct && "opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "h-8 w-8 rounded-md border flex items-center justify-center font-mono text-xs uppercase shrink-0",
                      isSel && !submitted && "border-accent text-accent bg-accent/10",
                      !isSel && "border-border text-muted-foreground",
                      showCorrect && "border-emerald-600 text-emerald-400 bg-emerald-950/50",
                      showWrong && "border-destructive text-destructive bg-destructive/10"
                    )}
                  >
                    {opt.id}
                  </span>
                  <span className="flex-1 text-sm">{opt.text}</span>
                  {showCorrect && <Check className="h-4 w-4 text-emerald-400" />}
                  {showWrong && <X className="h-4 w-4 text-destructive" />}
                </button>
              );
            })}
          </div>

          {submitted && (
            <div className={cn(
              "mt-6 p-5 rounded-lg border animate-fade-in",
              isCorrect ? "border-emerald-700/40 bg-emerald-950/20" : "border-destructive/40 bg-destructive/5"
            )}>
              <div className="flex items-center gap-2 mb-2">
                {isCorrect ? <Check className="h-4 w-4 text-emerald-400" /> : <X className="h-4 w-4 text-destructive" />}
                <p className="text-sm font-semibold">
                  {isCorrect ? "Correct" : "Not quite."}
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{question.explanation}</p>
            </div>
          )}
        </Card>

        {/* Action bar */}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Flag className="mr-2 h-3.5 w-3.5" /> Flag question
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="border-border hover:border-accent hover:text-accent">
              <Eye className="mr-2 h-3.5 w-3.5" /> View All Answers
            </Button>
            {!submitted ? (
              <Button onClick={submit} disabled={!selected} className="bg-gradient-gold text-primary-foreground hover:opacity-90">
                Submit Answer
              </Button>
            ) : (
              <Button onClick={() => { setSubmitted(false); setSelected(null); }} className="bg-gradient-gold text-primary-foreground hover:opacity-90">
                Next Question <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Quiz;
