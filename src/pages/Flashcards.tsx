import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, RotateCcw, Check, X, Sparkles, Loader2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Flashcard {
  _id: string;
  topic: string;
  front: string;
  back: string;
}

interface FlashcardSet {
  _id: string;
  title: string;
  sourceType: string;
  cards: Flashcard[];
  createdAt: string;
}

const Flashcards = () => {
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dueCount, setDueCount] = useState(0);

  const selectedSet = useMemo(
    () => sets.find((set) => set._id === selectedSetId) || sets[0],
    [sets, selectedSetId]
  );
  const cards = selectedSet?.cards || [];
  const card = cards[idx];

  const loadSets = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      apiFetch("/flashcards").then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch("/flashcards/due?limit=100").then((response) => response.ok ? response.json() : { dueCount: 0 }),
    ])
      .then(([data, dueData]) => {
        setSets(data.sets || []);
        setDueCount(dueData.dueCount || 0);
        if (!selectedSetId && data.sets?.[0]?._id) setSelectedSetId(data.sets[0]._id);
      })
      .catch(() => setSets([]))
      .finally(() => setIsLoading(false));
  }, [selectedSetId]);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  useEffect(() => {
    setIdx(0);
    setFlipped(false);
  }, [selectedSetId]);

  const next = () => {
    if (!cards.length) return;
    setFlipped(false);
    setTimeout(() => setIdx((idx + 1) % cards.length), 180);
  };

  const prev = () => {
    if (!cards.length) return;
    setFlipped(false);
    setTimeout(() => setIdx((idx - 1 + cards.length) % cards.length), 180);
  };

  const generateWeakTopicSet = async () => {
    setIsGenerating(true);
    try {
      const response = await apiFetch("/flashcards/generate", {
        method: "POST",
        body: JSON.stringify({ sourceType: "weak-topics", count: 12 }),
      });
      if (!response.ok) throw new Error("Flashcard generation failed");
      const data = await response.json();
      setSets((existing) => [data.set, ...existing]);
      setSelectedSetId(data.set._id);
    } finally {
      setIsGenerating(false);
    }
  };

  const review = async (rating: "hard" | "again" | "easy") => {
    if (!selectedSet || !card) return;
    apiFetch(`/flashcards/${selectedSet._id}/cards/${card._id}/review`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }).catch(() => undefined);
    next();
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
              <Sparkles className="h-3 w-3" /> Active Recall
            </div>
            <h1 className="font-serif text-4xl">Flashcards</h1>
            <p className="text-sm text-muted-foreground">AI-generated recall decks connected to your materials and weak topics.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Badge variant="outline" className="border-accent/40 text-accent justify-center py-2">
              {dueCount} due today
            </Badge>
            <Button onClick={generateWeakTopicSet} disabled={isGenerating} className="bg-accent text-primary-foreground hover:bg-accent/90">
              {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Generate Weak-Topic Deck
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : !cards.length ? (
          <Card className="academic-card p-10 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Brain className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h2 className="font-serif text-2xl">No flashcards yet</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Generate a deck from weak topics after attempts, or create flashcards from a quiz/material in the learning flow.
              </p>
            </div>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {sets.map((set) => (
                <button
                  key={set._id}
                  onClick={() => setSelectedSetId(set._id)}
                  className={`px-3 py-2 rounded-md border text-xs transition-colors ${
                    selectedSet?._id === set._id
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-card/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {set.title}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Card {idx + 1} of {cards.length}</span>
              <Badge variant="outline" className="border-accent/40 text-accent font-mono text-[10px]">
                {card.topic}
              </Badge>
            </div>

            <div className="flip-card h-[420px] cursor-pointer" onClick={() => setFlipped(!flipped)}>
              <div className={cn("flip-inner relative h-full w-full", flipped && "flipped")}>
                <div className="flip-face absolute inset-0 academic-card flex flex-col items-center justify-center p-10 text-center">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-6">Question</span>
                  <p className="font-serif text-2xl md:text-3xl leading-snug text-foreground max-w-xl">{card.front}</p>
                  <span className="absolute bottom-6 text-[11px] text-muted-foreground/70 italic">click to flip</span>
                </div>
                <div className="flip-face flip-back absolute inset-0 academic-card border-accent/30 bg-gradient-hero flex flex-col items-center justify-center p-10 text-center">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-accent mb-6">Answer</span>
                  <p className="text-base leading-relaxed text-foreground/90 max-w-xl">{card.back}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={prev} className="border-border hover:border-accent hover:text-accent">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => review("hard")} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                  <X className="mr-2 h-3.5 w-3.5" /> Hard
                </Button>
                <Button variant="outline" size="sm" onClick={() => review("again")} className="border-border">
                  Again
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFlipped(false)} className="border-border">
                  <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset
                </Button>
                <Button size="sm" onClick={() => review("easy")} className="bg-accent text-primary-foreground hover:bg-accent/90">
                  <Check className="mr-2 h-3.5 w-3.5" /> Got it
                </Button>
              </div>
              <Button variant="outline" size="icon" onClick={next} className="border-border hover:border-accent hover:text-accent">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5 justify-center pt-4">
              {cards.map((_, i) => (
                <div
                  key={i}
                  className={cn("h-1 rounded-full transition-all", i === idx ? "w-8 bg-accent" : "w-2 bg-border")}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Flashcards;
