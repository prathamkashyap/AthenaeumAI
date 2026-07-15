import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Bot, Brain, FileText, Loader2, Send, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

interface Material {
  _id: string;
  title: string;
  originalFileName: string;
}

interface TutorResponse {
  question: string;
  answer: string;
  groundedSources: { sourceNumber: number; sourceTitle: string; whyRelevant: string }[];
  personalizedNotes: string[];
  revisionPlan: string[];
  suggestedFollowUps: string[];
  retrievedContext: {
    sourceNumber: number;
    sourceTitle: string;
    chunkIndex: number;
    score: number;
    preview: string;
    topics: string[];
  }[];
}

const Tutor = () => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialId, setMaterialId] = useState<string>("all");
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [response, setResponse] = useState<TutorResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/library")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => setMaterials(data.materials || []))
      .catch(() => setMaterials([]));
  }, []);

  const selectedMaterialTitle = useMemo(() => {
    if (materialId === "all") return "All indexed materials";
    return materials.find((material) => material._id === materialId)?.title || "Selected material";
  }, [materialId, materials]);

  const askTutor = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!question.trim()) return;

    setIsAsking(true);
    setError("");

    try {
      const res = await apiFetch("/tutor/ask", {
        method: "POST",
        body: JSON.stringify({
          question,
          materialId: materialId === "all" ? null : materialId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Tutor request failed");
      setResponse(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Tutor request failed");
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Contextual AI Tutor
            </div>
            <h1 className="font-serif text-4xl mt-2">Ask Your Materials</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Get grounded explanations from uploaded study materials, weak-topic history, prior mistakes, and related flashcards.
            </p>
          </div>

          <div className="w-full lg:w-72">
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger className="bg-muted/40">
                <SelectValue placeholder="Choose material" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All indexed materials</SelectItem>
                {materials.map((material) => (
                  <SelectItem key={material._id} value={material._id}>
                    {material.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <Card className="academic-card p-5">
              <form onSubmit={askTutor} className="space-y-4">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about deadlock avoidance, normalization, memory management, backpropagation..."
                  className="min-h-32 bg-muted/30 border-border/70 resize-none text-base"
                />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 text-accent" />
                    <span>{selectedMaterialTitle}</span>
                  </div>
                  <Button disabled={isAsking || !question.trim()} className="bg-accent text-primary-foreground hover:bg-accent/90">
                    {isAsking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Ask Tutor
                  </Button>
                </div>
              </form>
            </Card>

            {error && (
              <Card className="academic-card p-4 border-destructive/30 text-sm text-destructive">
                {error}
              </Card>
            )}

            {response ? (
              <Card className="academic-card p-6 space-y-6">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-accent" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <Badge variant="outline" className="border-accent/40 text-accent">Grounded response</Badge>
                    <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap">{response.answer}</p>
                  </div>
                </div>

                {!!response.personalizedNotes?.length && (
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-cyan-300 mb-3">Personalized Notes</p>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {response.personalizedNotes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </div>
                )}

                {!!response.revisionPlan?.length && (
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Revision Plan</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {response.revisionPlan.map((step, index) => (
                        <div key={step} className="rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground">
                          <span className="font-mono text-accent mr-2">{index + 1}</span>{step}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ) : (
              <Card className="academic-card p-10 text-center">
                <div className="mx-auto h-14 w-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
                  <Brain className="h-7 w-7 text-accent" />
                </div>
                <h2 className="font-serif text-2xl">Grounded tutoring starts with your library</h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                  Ask a concept question and AthenaeumAI will retrieve relevant chunks, connect weak topics, and produce a personalized explanation.
                </p>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card className="academic-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">Retrieved Sources</p>
              {response?.retrievedContext?.length ? (
                <div className="space-y-3">
                  {response.retrievedContext.map((source) => (
                    <div key={`${source.sourceTitle}-${source.chunkIndex}`} className="rounded-lg border border-border bg-card/30 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-medium truncate">{source.sourceTitle}</p>
                        <Badge variant="outline" className="text-[10px] border-border font-mono">
                          {Math.round(source.score * 100)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-4">{source.preview}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sources will appear after a tutor response.</p>
              )}
            </Card>

            <Card className="academic-card p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">Follow-Ups</p>
              {response?.suggestedFollowUps?.length ? (
                <div className="space-y-2">
                  {response.suggestedFollowUps.map((followUp) => (
                    <button
                      key={followUp}
                      onClick={() => setQuestion(followUp)}
                      className="w-full text-left rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground hover:border-accent/40 hover:text-foreground transition-colors"
                    >
                      {followUp}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Suggested follow-up prompts will appear here.</p>
              )}
            </Card>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
};

export default Tutor;
