import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, RotateCcw, Check, X, Sparkles, Loader2, Brain, CheckCircle2, AlertTriangle, Plus } from "lucide-react";
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

/**
 * One entry from `GET /flashcards/due`. The endpoint has already decided these
 * are due, and it tags each with the set it came from — a due session routinely
 * spans several decks, so the owning set has to travel with the card.
 */
interface DueCardEntry {
  setId: string;
  setTitle: string;
  nextReviewAt: string;
  card: Flashcard;
}

const Flashcards = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Due mode is opt-in via `?due=1`. Absent the param this page behaves exactly
  // as it always has: browse one selected set at a time.
  const dueMode = searchParams.get("due") === "1";

  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [dueCards, setDueCards] = useState<DueCardEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  // Why a weak-topic deck could not be built. Null when there is nothing to
  // report, including while a request is in flight.
  const [generateError, setGenerateError] = useState<string | null>(null);

  const selectedSet = useMemo(
    () => sets.find((set) => set._id === selectedSetId) || sets[0],
    [sets, selectedSetId]
  );

  // In due mode the session list is the endpoint's own output, across sets. In
  // normal mode it stays the selected set's cards, unfiltered.
  const cards = useMemo<Flashcard[]>(
    () => (dueMode ? dueCards.map((entry) => entry.card) : selectedSet?.cards || []),
    [dueMode, dueCards, selectedSet]
  );
  const card = cards[idx];

  /**
   * The set that owns the current card. A due card can belong to any set, so it
   * is read from the entry rather than from the selected set, which in due mode
   * is not the card's owner and may not even be loaded.
   */
  const activeSetId = dueMode ? dueCards[idx]?.setId : selectedSet?._id;

  const loadSets = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      apiFetch("/flashcards").then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch("/flashcards/due?limit=100").then((response) => response.ok ? response.json() : { dueCount: 0 }),
    ])
      .then(([data, dueData]) => {
        setSets(data.sets || []);
        // The due payload is kept in due mode, not just counted. Keeping only the
        // count is what previously made it impossible to review what is actually
        // due without rebuilding the filter here.
        if (dueMode) setDueCards(dueData.cards || []);
        setDueCount(dueData.dueCount || 0);
        // The functional form deliberately. Reading `selectedSetId` from the
        // closure would make this callback depend on it, so auto-selecting the
        // first set would change the callback's identity and re-run the whole
        // fetch — blanking the page to the spinner on every mount. In due mode
        // there is no selected set to speak of, so that refetch bought nothing.
        setSelectedSetId((current) => current || data.sets?.[0]?._id || "");
      })
      .catch(() => setSets([]))
      .finally(() => setIsLoading(false));
  }, [dueMode]);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  useEffect(() => {
    setIdx(0);
    setFlipped(false);
    setSessionDone(false);
  }, [selectedSetId, dueMode]);

  const next = () => {
    if (!cards.length) return;
    // In due mode the session ends on the last card instead of wrapping.
    // Wrapping would restart today's queue, and since a rating advances the
    // schedule immediately, re-rating the same card twice in one sitting would
    // count against it twice. Normal browsing still wraps, as it always has.
    if (dueMode && idx >= cards.length - 1) {
      setSessionDone(true);
      return;
    }
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
    setGenerateError(null);
    try {
      const response = await apiFetch("/flashcards/generate", {
        method: "POST",
        body: JSON.stringify({ sourceType: "weak-topics", count: 12 }),
      });
      if (!response.ok) {
        // The endpoint's `error` field is part of the error contract, and the
        // service puts learner-facing copy there — for example, that there are
        // no weak topics yet because no assessment has been taken. Showing it
        // directly avoids teaching this page to recognise an internal string, and
        // avoids a second place where the same advice is worded differently.
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Could not generate a deck. Please try again.");
      }
      const data = await response.json();
      setSets((existing) => [data.set, ...existing]);
      setSelectedSetId(data.set._id);
    } catch (err) {
      // Previously there was no catch at all, so this rejection was unhandled:
      // the spinner stopped and nothing was rendered, leaving the button looking
      // inert with no explanation.
      setGenerateError(err instanceof Error ? err.message : "Could not generate a deck.");
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * The four grades the learning model already supports. `good` is the neutral
   * one: the scheduler gives it the same interval as `hard` but leaves the card's
   * ease untouched, where `hard` lowers it and `easy` raises it *and* takes a
   * 1.3x interval bonus. Without it a learner who recalled correctly but with
   * hesitation had to pick between penalising the card and over-rewarding it.
   */
  const review = async (rating: "hard" | "again" | "good" | "easy") => {
    if (!card || !activeSetId) return;
    // In due mode `activeSetId` is the set that owns this card, which is not
    // necessarily the selected set — a due session spans decks. In normal mode
    // it stays the selected set, so the same endpoint and payload apply.
    apiFetch(`/flashcards/${activeSetId}/cards/${card._id}/review`, {
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
            <h1 className="font-serif text-4xl">{dueMode ? "Today's Review" : "Flashcards"}</h1>
            <p className="text-sm text-muted-foreground">
              {dueMode
                ? "Every card scheduled for today, across all your decks."
                : "AI-generated recall decks connected to your materials and weak topics."}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Badge variant="outline" className="border-accent/40 text-accent justify-center py-2">
              {dueMode ? cards.length : dueCount} due today
            </Badge>
            {/* Generating a new deck is a browsing action and has no place in the
                middle of a due session. */}
            {!dueMode && (
              <Button onClick={generateWeakTopicSet} disabled={isGenerating} className="bg-accent text-primary-foreground hover:bg-accent/90">
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
                Generate Weak-Topic Deck
              </Button>
            )}
          </div>
        </div>

        {/*
          A rejected generation is an expected state, not a fault — a learner with
          no attempts has no weak topics to build a deck from. The service already
          refuses to persist an empty set, so this only has to explain why nothing
          was created and where to go next.
        */}
        {generateError && !dueMode && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <p className="min-w-0 flex-1 text-sm text-foreground">{generateError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/assessments/create")}
              className="border-accent text-accent hover:bg-accent/10"
            >
              <Plus className="mr-2 h-4 w-4" /> Create Assessment
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : sessionDone ? (
          // A due session that has run out ends here. Wrapping would put today's
          // cards back in front of the learner, and rating one twice in a sitting
          // would advance its schedule twice.
          <Card className="academic-card p-10 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h2 className="font-serif text-2xl">Today&apos;s review is done</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                You rated all {cards.length} due {cards.length === 1 ? "card" : "cards"}. The next
                ones unlock as their scheduled dates arrive.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate("/review")}
              className="border-border hover:border-accent hover:text-accent"
            >
              Back to Today&apos;s Review
            </Button>
          </Card>
        ) : !cards.length ? (
          <Card className="academic-card p-10 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Brain className="h-7 w-7 text-accent" />
            </div>
            <div>
              {/* An empty due session and an empty library are different states
                  with different next steps, so they are not given the same copy. */}
              <h2 className="font-serif text-2xl">
                {dueMode ? "Nothing due right now" : "No flashcards yet"}
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                {dueMode
                  ? "Every scheduled card has been reviewed. New ones appear here as their review date arrives."
                  : "Generate a deck from weak topics after attempts, or create flashcards from a quiz/material in the learning flow."}
              </p>
            </div>
          </Card>
        ) : (
          <>
            {/* Set chips are a browsing control. In due mode the session is
                already determined, so offering them would invite a learner to
                switch decks mid-session. */}
            {!dueMode && (
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
            )}

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="shrink-0">Card {idx + 1} of {cards.length}</span>
              <div className="flex min-w-0 items-center gap-2">
                {/* In due mode a card can come from any deck, so naming the deck
                    tells the learner where the material behind it lives. Outside
                    due mode the set is already visible in the chips above. */}
                {dueMode && dueCards[idx]?.setTitle && (
                  <span className="truncate">{dueCards[idx].setTitle}</span>
                )}
                <Badge variant="outline" className="shrink-0 border-accent/40 text-accent font-mono text-[10px]">
                  {card.topic}
                </Badge>
              </div>
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
                <Button variant="outline" size="sm" onClick={() => review("good")} className="border-border">
                  Good
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
