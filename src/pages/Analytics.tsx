import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/api";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, PolarRadiusAxis,
} from "recharts";
import { TrendingUp, AlertTriangle, Award, Loader2, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface AccuracyPoint {
  day: string;
  score: number | null;
}

interface WeakTopic {
  topic: string;
  attempted: number;
  accuracy: number;
  confidence: number;
  weaknessScore: number;
  recommendedDifficulty: string;
}

interface AnalyticsDashboard {
  totals?: {
    quizzesTaken?: number;
    estimatedReadiness?: number;
    retentionScore?: number;
    averageConfidence?: number;
    reviewDueToday?: number;
  };
  highlights?: {
    weakestTopic?: {
      topic: string;
      weaknessScore: number;
    } | null;
  };
  recommendedNextAction?: {
    message: string;
    type: string;
  };
  accuracyTrend?: AccuracyPoint[];
  topicMastery?: Array<{
    topic: string;
    value: number;
  }>;
  weakTopics?: WeakTopic[];
}

const Analytics = () => {
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch("/analytics/dashboard")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, []);

  const series = useMemo(
    () => (data?.accuracyTrend || []).map((point) => ({
      ...point,
      score: point.score ?? 0,
    })),
    [data]
  );

  const radar = data?.topicMastery || [];
  const weak = data?.weakTopics || [];
  const hasAttempts = (data?.totals?.quizzesTaken || 0) > 0;

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-7xl mx-auto space-y-8">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-serif text-4xl">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-2">Backend-derived mastery from your quiz attempts.</p>
          </div>
          <Badge variant="outline" className="border-accent text-accent">Live learner profile</Badge>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  icon: TrendingUp,
                  label: "Readiness",
                  value: `${data?.totals?.estimatedReadiness || 0}%`,
                  sub: "Mastery + confidence + retention",
                },
                {
                  icon: Award,
                  label: "Retention",
                  value: `${data?.totals?.retentionScore || 0}%`,
                  sub: `${data?.totals?.averageConfidence || 0}% confidence`,
                },
                {
                  icon: AlertTriangle,
                  label: "Weakest Topic",
                  value: data?.highlights?.weakestTopic?.topic || "No attempts yet",
                  sub: data?.highlights?.weakestTopic ? `${data.highlights.weakestTopic.weaknessScore}% weakness` : "Complete a quiz to unlock",
                },
                {
                  icon: Target,
                  label: "Due Reviews",
                  value: String(data?.totals?.reviewDueToday || 0),
                  sub: "Spaced repetition queue",
                },
              ].map(k => (
                <Card key={k.label} className="academic-card p-5 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center">
                    <k.icon className="h-4 w-4 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                    <p className="font-serif text-xl text-foreground mt-0.5 truncate">{k.value}</p>
                    <p className="text-[11px] text-muted-foreground">{k.sub}</p>
                  </div>
                </Card>
              ))}
            </div>

            {data?.recommendedNextAction && (
              <Card className="academic-card p-5 border-accent/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-accent">Recommended Next</p>
                    <p className="text-sm text-foreground mt-2">{data.recommendedNextAction.message}</p>
                  </div>
                  <Badge variant="outline" className="border-accent/40 text-accent w-fit">
                    {data.recommendedNextAction.type}
                  </Badge>
                </div>
              </Card>
            )}

            {!hasAttempts && (
              <Card className="academic-card p-8 flex items-start gap-4">
                <div className="h-11 w-11 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center">
                  <Target className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h2 className="font-serif text-2xl">Your mastery map is waiting for signal</h2>
                  <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                    Complete an assessment and AthenaeumAI will compute accuracy trends, weak topics, topic mastery, and adaptive revision recommendations from real attempts.
                  </p>
                </div>
              </Card>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              <Card className="academic-card p-6 lg:col-span-2">
                <div className="mb-4">
                  <h2 className="font-serif text-2xl">Accuracy Over Time</h2>
                  <p className="text-xs text-muted-foreground mt-1">Daily average across the last 30 days</p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="accuracyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Area type="monotone" dataKey="score" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#accuracyFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="academic-card p-6">
                <div className="mb-4">
                  <h2 className="font-serif text-2xl">Topic Mastery</h2>
                  <p className="text-xs text-muted-foreground mt-1">Strength radar from attempted topics</p>
                </div>
                <div className="h-72">
                  {radar.length ? (
                    <ResponsiveContainer>
                      <RadarChart data={radar}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="topic" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <PolarRadiusAxis domain={[0, 100]} stroke="hsl(var(--border))" tick={false} axisLine={false} />
                        <Radar dataKey="value" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.25} />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      No topic attempts yet
                    </div>
                  )}
                </div>
              </Card>
            </div>

            <Card className="academic-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif text-2xl">Weak Topics</h2>
                  <p className="text-xs text-muted-foreground mt-1">Adaptive recommendations from incorrect answers</p>
                </div>
                <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                  Needs Review
                </Badge>
              </div>
              <div className="divide-y divide-border">
                {weak.length ? weak.map((w) => (
                  <div key={w.topic} className="py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{w.topic}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {w.attempted} questions · {w.confidence}% confidence · weakness {w.weaknessScore} · next {w.recommendedDifficulty}
                      </p>
                    </div>
                    <div className="w-40">
                      <div className="flex justify-between text-[10px] font-mono mb-1">
                        <span className="text-muted-foreground">accuracy</span>
                        <span className="text-destructive">{w.accuracy}%</span>
                      </div>
                      <Progress value={w.accuracy} className="h-1" />
                    </div>
                  </div>
                )) : (
                  <div className="py-8 text-sm text-muted-foreground">
                    No weak topics detected yet. Submit assessments to build adaptive focus areas.
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Analytics;
