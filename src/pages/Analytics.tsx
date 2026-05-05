import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, PolarRadiusAxis,
} from "recharts";
import { TrendingUp, AlertTriangle, Award } from "lucide-react";

const series = [
  { day: "Mon", score: 62 }, { day: "Tue", score: 71 }, { day: "Wed", score: 68 },
  { day: "Thu", score: 78 }, { day: "Fri", score: 84 }, { day: "Sat", score: 81 },
  { day: "Sun", score: 89 },
];

const radar = [
  { topic: "OS", value: 88 }, { topic: "DBMS", value: 76 }, { topic: "CN", value: 64 },
  { topic: "DSA", value: 92 }, { topic: "ML", value: 58 }, { topic: "TOC", value: 70 },
];

const weak = [
  { topic: "Machine Learning · Backpropagation", acc: 42, q: 18 },
  { topic: "Computer Networks · Congestion Control", acc: 51, q: 22 },
  { topic: "Theory of Computation · Pumping Lemma", acc: 55, q: 14 },
];

const Analytics = () => {
  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-7xl mx-auto space-y-8">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-serif text-4xl">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-2">A measured look at the last 30 days.</p>
          </div>
          <div className="flex gap-2">
            {["7d", "30d", "90d", "All"].map(t => (
              <Badge key={t} variant="outline" className={t === "30d" ? "border-accent text-accent" : "border-border text-muted-foreground"}>
                {t}
              </Badge>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: TrendingUp, label: "Mastery Trend", value: "+11.4%", sub: "vs previous period" },
            { icon: Award, label: "Best Topic", value: "Data Structures", sub: "92% accuracy" },
            { icon: AlertTriangle, label: "Needs Attention", value: "3 topics", sub: "Below 60% accuracy" },
          ].map(k => (
            <Card key={k.label} className="academic-card p-5 flex items-center gap-4">
              <div className="h-10 w-10 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center">
                <k.icon className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <p className="font-serif text-xl text-foreground mt-0.5">{k.value}</p>
                <p className="text-[11px] text-muted-foreground">{k.sub}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="academic-card p-6 lg:col-span-2">
            <div className="mb-4">
              <h2 className="font-serif text-2xl">Accuracy Over Time</h2>
              <p className="text-xs text-muted-foreground mt-1">Weekly average across all quizzes</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="score" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="academic-card p-6">
            <div className="mb-4">
              <h2 className="font-serif text-2xl">Topic Mastery</h2>
              <p className="text-xs text-muted-foreground mt-1">Strength radar</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer>
                <RadarChart data={radar}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="topic" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <PolarRadiusAxis stroke="hsl(var(--border))" tick={false} axisLine={false} />
                  <Radar dataKey="value" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Weak topics */}
        <Card className="academic-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-serif text-2xl">Weak Topics</h2>
              <p className="text-xs text-muted-foreground mt-1">Recommended focus areas</p>
            </div>
            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
              Needs Review
            </Badge>
          </div>
          <div className="divide-y divide-border">
            {weak.map((w) => (
              <div key={w.topic} className="py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{w.topic}</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{w.q} questions attempted</p>
                </div>
                <div className="w-40">
                  <div className="flex justify-between text-[10px] font-mono mb-1">
                    <span className="text-muted-foreground">accuracy</span>
                    <span className="text-destructive">{w.acc}%</span>
                  </div>
                  <Progress value={w.acc} className="h-1" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Analytics;
