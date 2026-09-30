import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Bot, Brain, FileCheck2, FileText, Info, Loader2, Send, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

interface Material {
  _id: string;
  title: string;
  originalFileName: string;
}

interface RetrievedSource {
  sourceNumber: number;
  sourceTitle: string;
  chunkIndex: number;
  score: number;
  preview: string;
  topics: string[];
}

/**
 * The backend's grounding decision, as of the explicit contract.
 *
 * Optional because a response predating the contract carries no such field, and
 * because treating a missing field as `grounded: false` would label every older
 * response a refusal. The absence is handled explicitly below rather than
 * defaulted into one of the two known states.
 */
interface GroundingDecision {
  grounded: boolean;
  reason: string | null;
  evidenceCount: number;
  consideredCount: number;
  bestScore: number;
}

interface TutorResponse {
  question: string;
  answer: string;
  groundedSources: { sourceNumber: number; sourceTitle: string; whyRelevant: string }[];
  personalizedNotes: string[];
  revisionPlan: string[];
  suggestedFollowUps: string[];
  retrievedContext: RetrievedSource[];
  grounding?: GroundingDecision;
}

/**
 * The three states the UI distinguishes.
 *
 * `unreported` exists because the field is additive: a response from before the
 * grounding contract, or from a deployment that has not shipped it, has no
 * decision at all. That is not the same as a refusal, and rendering it as one
 * would tell a learner the tutor declined to answer something it did answer.
 */
type TutorViewState = "grounded" | "insufficient" | "unreported";

const resolveViewState = (response: TutorResponse | null): TutorViewState => {
  if (!response?.grounding) return "unreported";
  // Only an explicit `false` is a refusal. A truthiness test here would classify
  // a malformed or partial decision — `{ grounded: undefined }` — as a refusal
  // and tell a learner the tutor declined to answer an answer it did give.
  return response.grounding.grounded === false ? "insufficient" : "grounded";
};

/**
 * Sources shown for a grounded answer.
 *
 * Empty for a refusal even though `retrievedContext` is populated, because the
 * backend returns the chunks it considered alongside a refusal for diagnostic
 * purposes. Presenting them as sources for an answer that was never given would
 * be the one thing this UI must never do.
 */
const citableSources = (response: TutorResponse | null, state: TutorViewState) =>
  state === "insufficient" ? [] : response?.retrievedContext ?? [];

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

  // The backend decision is the single source of truth for how the response is
  // presented. Nothing below infers grounding from the answer's wording, its
  // length, or how many sources came back: a model that answers confidently from
  // three irrelevant chunks looks identical to one that answers from the right
  // one, and only the server knows which happened.
  const viewState = resolveViewState(response);
  const isRefusal = viewState === "insufficient";
  const sources = citableSources(response, viewState);
  const sourcesWithReasons = useMemo(() => {
    const reasons = new Map(
      (response?.groundedSources ?? []).map((source) => [source.sourceNumber, source.whyRelevant]),
    );
    return sources.map((source) => ({ ...source, whyRelevant: reasons.get(source.sourceNumber) }));
  }, [sources, response?.groundedSources]);

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
                    {/* Grounding state is announced, not merely coloured: the icon and
                        the text both carry it, so it survives a screen reader and a
                        greyscale display. The wording claims only what the backend
                        established — that evidence was present — not that the answer
                        is correct, complete, or semantically understood. */}
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-2 flex-wrap"
                    >
                      {isRefusal ? (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400 gap-1.5">
                          <Info className="h-3 w-3" aria-hidden="true" />
                          No supporting material found
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-accent/40 text-accent gap-1.5">
                          <FileCheck2 className="h-3 w-3" aria-hidden="true" />
                          Based on your uploaded material
                        </Badge>
                      )}
                    </div>

                    {isRefusal && (
                      <p className="text-sm text-muted-foreground">
                        Your uploaded material did not provide evidence for this question, so the tutor
                        did not attempt an answer.
                      </p>
                    )}

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
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
                {isRefusal ? "No Sources" : "Sources Used"}
              </p>

              {isRefusal ? (
                // No source list at all on a refusal. The backend returns the chunks
                // it weighed so the refusal is auditable server-side, but they are
                // not sources for an answer, and listing them under any heading
                // invites the reader to treat them as one.
                <p className="text-sm text-muted-foreground">
                  No sources are shown because the tutor did not answer from your material.
                </p>
              ) : sources.length > 0 ? (
                <ol className="space-y-3" aria-label="Sources used for this answer">
                  {sourcesWithReasons.map((source) => (
                    <li
                      key={`${source.sourceNumber}-${source.sourceTitle}-${source.chunkIndex}`}
                      className="rounded-lg border border-border bg-card/30 p-3"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {/* The source number is the citation handle the answer can be
                            checked against, so it is given an accessible name rather
                            than being read as a bare digit. */}
                        <Badge
                          variant="outline"
                          className="text-[10px] border-border font-mono shrink-0"
                          aria-label={`Source ${source.sourceNumber}`}
                        >
                          [{source.sourceNumber}]
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{source.sourceTitle}</p>
                          {/* The chunk index is what the API actually supplies. There is
                              no page number, offset or location in the response, and
                              inventing one would send a learner looking for something
                              that does not exist. */}
                          <p className="text-[11px] text-muted-foreground font-mono">
                            Section {source.chunkIndex + 1}
                          </p>
                        </div>
                      </div>
                      {source.whyRelevant && (
                        <p className="text-xs text-muted-foreground mb-2">{source.whyRelevant}</p>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-4">{source.preview}</p>
                    </li>
                  ))}
                </ol>
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
