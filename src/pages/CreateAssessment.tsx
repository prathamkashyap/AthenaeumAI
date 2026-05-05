import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuiz } from "@/context/QuizContext";
import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  FileText,
  Sparkles,
  Zap,
  Brain,
  Flame,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const DIFFICULTIES = [
  {
    value: "Easy",
    label: "Easy",
    icon: Zap,
    description: "Recall & definitions",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    glow: "hover:shadow-[0_0_30px_hsl(150_60%_40%/0.15)]",
  },
  {
    value: "Medium",
    label: "Medium",
    icon: Brain,
    description: "Application & analysis",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    glow: "hover:shadow-[0_0_30px_hsl(38_60%_50%/0.15)]",
  },
  {
    value: "Hard",
    label: "Hard",
    icon: Flame,
    description: "Critical thinking & edge cases",
    color: "text-rose-400",
    border: "border-rose-500/30",
    bg: "bg-rose-500/10",
    glow: "hover:shadow-[0_0_30px_hsl(0_60%_50%/0.15)]",
  },
];

const QUESTION_COUNTS = [5, 10, 15, 20];

const CreateAssessment = () => {
  const [difficulty, setDifficulty] = useState("Easy");
  const [file, setFile] = useState<File | null>(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { generateQuiz, isGenerating, generationProgress, error, clearError } = useQuiz();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
      clearError();
    }
  }, [clearError]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (selected) {
      setFile(selected);
      clearError();
    }
  };

  const handleGenerate = async () => {
    if (!file) return;

    try {
      const quizData = await generateQuiz(file, difficulty, questionCount);
      navigate(`/assessments/${quizData.quizId}`);
    } catch (err) {
      // Error is handled by context
    }
  };

  const selectedDiff = DIFFICULTIES.find((d) => d.value === difficulty)!;

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Create New Assessment
          </div>
          <h1 className="font-serif text-3xl lg:text-4xl text-foreground">
            Generate AI-Powered Quiz
          </h1>
          <p className="text-muted-foreground max-w-lg">
            Upload your study material and let AI create exam-style questions with explanations.
          </p>
        </div>

        {/* Upload Zone */}
        <Card
          className={`academic-card p-0 overflow-hidden transition-all duration-300 ${
            isDragOver ? "border-accent ring-2 ring-accent/20" : ""
          } ${file ? "border-accent/40" : ""}`}
        >
          <div
            className={`relative p-8 lg:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors duration-200 ${
              isDragOver ? "bg-accent/5" : ""
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
              id="pdf-upload"
            />

            {file ? (
              <div className="space-y-3 animate-scale-in">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <FileText className="h-8 w-8 text-accent" />
                </div>
                <div>
                  <p className="text-foreground font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`mx-auto h-20 w-20 rounded-2xl border-2 border-dashed flex items-center justify-center transition-colors duration-200 ${
                  isDragOver ? "border-accent bg-accent/10" : "border-border"
                }`}>
                  <Upload className={`h-8 w-8 transition-colors ${isDragOver ? "text-accent" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="text-foreground font-medium">
                    Drop your PDF here, or{" "}
                    <span className="text-accent underline underline-offset-4">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports PDF files up to 10MB
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Difficulty Selection */}
        <div className="space-y-3">
          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Difficulty Level
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDifficulty(d.value)}
                className={`group relative p-4 rounded-lg border transition-all duration-300 text-left ${
                  difficulty === d.value
                    ? `${d.border} ${d.bg} ring-1 ${d.border}`
                    : "border-border hover:border-border/80 bg-card/50"
                } ${d.glow}`}
              >
                <div className="flex items-center gap-3">
                  <d.icon
                    className={`h-5 w-5 transition-colors ${
                      difficulty === d.value ? d.color : "text-muted-foreground"
                    }`}
                  />
                  <div>
                    <p className={`font-medium text-sm ${difficulty === d.value ? d.color : "text-foreground"}`}>
                      {d.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{d.description}</p>
                  </div>
                </div>
                {difficulty === d.value && (
                  <div className={`absolute top-3 right-3 h-2 w-2 rounded-full ${d.bg} ring-2 ${d.border}`}>
                    <CheckCircle2 className={`h-4 w-4 -mt-1 -ml-1 ${d.color}`} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Question Count */}
        <div className="space-y-3">
          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Number of Questions
          </label>
          <div className="flex gap-2">
            {QUESTION_COUNTS.map((c) => (
              <button
                key={c}
                onClick={() => setQuestionCount(c)}
                className={`px-5 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                  questionCount === c
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border bg-card/50 text-muted-foreground hover:border-border/80 hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5 animate-fade-in">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-destructive font-medium">Generation Failed</p>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
            </div>
            <button onClick={clearError} className="text-destructive/60 hover:text-destructive">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Generate Button */}
        <div className="pt-2">
          <Button
            onClick={handleGenerate}
            disabled={!file || isGenerating}
            size="lg"
            className="w-full sm:w-auto bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow disabled:opacity-40 disabled:shadow-none transition-all duration-300 h-12 px-8 text-base"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {generationProgress || "Generating..."}
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Generate {questionCount} Questions
              </>
            )}
          </Button>

          {isGenerating && (
            <div className="mt-4 space-y-2 animate-fade-in">
              <div className="h-1.5 w-full max-w-md rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-gradient-gold rounded-full animate-shimmer" style={{ width: "60%", backgroundSize: "200% 100%" }} />
              </div>
              <p className="text-xs text-muted-foreground">
                This may take 10–20 seconds depending on document length
              </p>
            </div>
          )}
        </div>

        {/* Info Cards */}
        <div className="grid sm:grid-cols-3 gap-3 pt-4">
          {[
            { icon: "📄", title: "PDF Analysis", desc: "Text is extracted and analyzed for key concepts" },
            { icon: "🧠", title: "AI Generation", desc: "Questions crafted using Llama 3 70B model" },
            { icon: "📝", title: "With Explanations", desc: "Each answer includes detailed reasoning" },
          ].map((info) => (
            <div key={info.title} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-lg">{info.icon}</span>
              <div>
                <p className="text-xs font-medium text-foreground">{info.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{info.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default CreateAssessment;