import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ArrowUpRight,
  Clock,
  Flame,
  Target,
  BookMarked,
  Sparkles,
  TrendingUp,
  Loader2,
  BookOpen,
  Plus,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const API_BASE = "http://localhost:3001/api/quiz";

interface SubjectInfo {
  subject: string;
  shortName: string;
  icon: string;
  quizCount: number;
  defaultQuizId: string | null;
  questionCount: number;
}

interface RecentQuiz {
  _id: string;
  title: string;
  difficulty: string;
  questionCount: number;
  subject: string;
  attemptCount: number;
  bestScore: number | null;
  createdAt: string;
}

const stats = [
  { label: "Quizzes Taken", value: "—", delta: "Upload PDFs to start", icon: BookMarked },
  { label: "Avg. Accuracy", value: "—", delta: "Track your progress", icon: Target },
  { label: "Subjects", value: "8", delta: "Available now", icon: Flame },
  { label: "AI Model", value: "70B", delta: "Llama 3", icon: Clock },
];

const SUBJECT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "Operating Systems": { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
  "Data Structures & Algorithms": { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
  "Computer Networks": { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400" },
  "DBMS": { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400" },
  "Data Mining": { bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-400" },
  "Deep Learning": { bg: "bg-rose-500/10", border: "border-rose-500/20", text: "text-rose-400" },
  "Natural Language Processing": { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400" },
  "Computer Vision": { bg: "bg-pink-500/10", border: "border-pink-500/20", text: "text-pink-400" },
};

const Index = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [recentQuizzes, setRecentQuizzes] = useState<RecentQuiz[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Fetch subjects
  useEffect(() => {
    fetch(`${API_BASE}/subjects`)
      .then((r) => r.json())
      .then((data) => setSubjects(data.subjects || []))
      .catch(() => setSubjects([]))
      .finally(() => setLoadingSubjects(false));
  }, []);

  // Fetch recent quizzes
  useEffect(() => {
    fetch(`${API_BASE}/history?limit=4`)
      .then((r) => r.json())
      .then((data) => setRecentQuizzes(data.quizzes || []))
      .catch(() => setRecentQuizzes([]))
      .finally(() => setLoadingRecent(false));
  }, []);

  const handleSubjectClick = (subject: SubjectInfo) => {
    if (subject.defaultQuizId) {
      navigate(`/assessments/${subject.defaultQuizId}`);
    } else {
      navigate("/assessments/create");
    }
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
      <div className="px-6 lg:px-10 py-8 max-w-7xl mx-auto space-y-10">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-hero p-8 lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,hsl(38_55%_58%/0.12),transparent_50%)]" />
          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
                <Sparkles className="h-3.5 w-3.5" /> Intelligent Learning System
              </div>

              <h1 className="font-serif text-4xl lg:text-6xl leading-[1.2] tracking-tight text-foreground break-words">
                Welcome back,{" "}
                <span className="gold-text italic inline-block">Pratham</span>.
                <br /> Your study deck awaits.
              </h1>

              <p className="text-muted-foreground max-w-xl">
                {subjects.length} subjects loaded from your curriculum. Upload new PDFs or practice from preloaded quizzes.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild size="lg" className="bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow">
                <Link to="/assessments/create">Generate Quiz <ArrowUpRight className="ml-1 h-4 w-4" /></Link>
              </Button>

              <Button asChild size="lg" variant="outline" className="border-border hover:border-accent hover:text-accent">
                <Link to="/assessments">View All Quizzes</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Stats Row */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <Card key={s.label} className="academic-card p-5 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
                  <p className="font-serif text-3xl mt-2 text-foreground">{s.value}</p>
                  <p className="text-[11px] text-accent mt-1">{s.delta}</p>
                </div>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          ))}
        </section>

        {/* Subject Cards */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-serif text-2xl">Subjects</h2>
              <p className="text-xs text-muted-foreground mt-1">Your curriculum — click to start practicing</p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-accent hover:text-accent"
            >
              <Link to="/assessments/create">
                <Plus className="h-3.5 w-3.5 mr-1" /> Upload Custom
              </Link>
            </Button>
          </div>

          {loadingSubjects ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {subjects.map((s, i) => {
                const colors = SUBJECT_COLORS[s.subject] || {
                  bg: "bg-accent/10",
                  border: "border-accent/20",
                  text: "text-accent",
                };
                return (
                  <button
                    key={s.subject}
                    onClick={() => handleSubjectClick(s)}
                    className={`group relative p-5 rounded-xl border ${colors.border} ${colors.bg} text-left transition-all duration-300 hover:shadow-[0_0_30px_hsl(38_55%_58%/0.1)] hover:scale-[1.02] animate-fade-in-up`}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span className="text-2xl mb-3 block">{s.icon}</span>
                    <p className={`font-medium text-sm ${colors.text}`}>{s.shortName}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.subject}</p>
                    {s.defaultQuizId ? (
                      <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                        {s.questionCount}Q ready
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground/60 mt-2">
                        No quiz yet
                      </p>
                    )}
                    <ArrowUpRight className={`absolute top-4 right-4 h-3.5 w-3.5 ${colors.text} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Quizzes + Weekly Goal */}
        <section className="grid lg:grid-cols-3 gap-6">
          <Card className="academic-card p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-serif text-2xl">Recent Quizzes</h2>
                <p className="text-xs text-muted-foreground mt-1">Your latest attempts</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-accent hover:text-accent">
                <Link to="/assessments">View all</Link>
              </Button>
            </div>

            {loadingRecent ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 text-accent animate-spin" />
              </div>
            ) : recentQuizzes.length > 0 ? (
              <div className="divide-y divide-border">
                {recentQuizzes.map((r) => (
                  <div
                    key={r._id}
                    className="flex items-center justify-between py-4 group cursor-pointer"
                    onClick={() => navigate(`/assessments/${r._id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] border-border/60 text-muted-foreground font-mono">
                          {r.difficulty}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{formatDate(r.createdAt)}</span>
                      </div>
                      <p className="text-sm font-medium truncate group-hover:text-accent transition-colors">{r.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{r.questionCount} questions</p>
                    </div>

                    <div className="flex items-center gap-4 ml-4">
                      {r.bestScore !== null && (
                        <>
                          <div className="text-right">
                            <p className="font-serif text-2xl text-foreground">
                              {r.bestScore}<span className="text-sm text-muted-foreground">%</span>
                            </p>
                          </div>
                          <div className="w-20 hidden sm:block">
                            <Progress value={r.bestScore} className="h-1.5" />
                          </div>
                        </>
                      )}
                      {r.bestScore === null && (
                        <span className="text-xs text-muted-foreground">Not attempted</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No quizzes yet</p>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="mt-3 border-accent text-accent hover:bg-accent/10"
                >
                  <Link to="/assessments/create">Create your first quiz</Link>
                </Button>
              </div>
            )}
          </Card>

          <Card className="academic-card p-6 space-y-6">
            <div>
              <h2 className="font-serif text-2xl">Quick Start</h2>
              <p className="text-xs text-muted-foreground mt-1">Get practicing in seconds</p>
            </div>

            <div className="space-y-3">
              <Button
                asChild
                className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 shadow-glow justify-start"
              >
                <Link to="/assessments/create">
                  <ArrowUpRight className="h-4 w-4 mr-2" /> Upload PDF & Generate
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                className="w-full border-border hover:border-accent hover:text-accent justify-start"
              >
                <Link to="/assessments">
                  <BookMarked className="h-4 w-4 mr-2" /> Browse All Quizzes
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                className="w-full border-border hover:border-accent hover:text-accent justify-start"
              >
                <Link to="/analytics">
                  <TrendingUp className="h-4 w-4 mr-2" /> View Analytics
                </Link>
              </Button>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span>Powered by Llama 3 70B via Groq</span>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
};

export default Index;