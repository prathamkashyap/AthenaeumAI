import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Brain, CheckCircle2, Layers, Loader2, Sparkles, Target } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * Today's Review
 * =============
 *
 * A composition page. Everything it shows is already computed by the backend and
 * already exposed — due cards by `GET /flashcards/due` and weak topics by
 * `GET /analytics/dashboard` — so this page adds no endpoint, no model and no
 * scheduling. It also deliberately contains no flashcard interaction: the actual
 * review is owned by `Flashcards.tsx`, entered through the `?due=1` CTA below.
 *
 * The two requests are independent. Neither can fail the other: a learner whose
 * dashboard request fails should still see what is due, and a learner with no
 * due cards should still see which topics are weak. Collapsing them into one
 * loading and one error state would hide whichever half succeeded.
 */

interface DueCardEntry {
  setId: string;
  setTitle: string;
  nextReviewAt: string;
  card: { _id: string; topic?: string };
}

interface WeakTopic {
  topic: string;
  subject?: string;
  accuracy?: number;
  confidence?: number;
  weaknessScore?: number;
  recommendedDifficulty?: string;
}

const TodaysReview = () => {
  const navigate = useNavigate();

  const [dueCards, setDueCards] = useState<DueCardEntry[] | null>(null);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[] | null>(null);
  const [dueError, setDueError] = useState(false);
  const [weakError, setWeakError] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch("/flashcards/due?limit=100")
      .then((response) => {
        if (!response.ok) throw new Error("due request failed");
        return response.json();
      })
      .then((data) => {
        if (active) setDueCards(data.cards || []);
      })
      .catch(() => {
        if (active) setDueError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch("/analytics/dashboard")
      .then((response) => {
        if (!response.ok) throw new Error("dashboard request failed");
        return response.json();
      })
      .then((data) => {
        if (active) setWeakTopics(data.weakTopics || []);
      })
      .catch(() => {
        if (active) setWeakError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // The endpoint has already filtered to due cards, so this is a presentation of
  // what it returned rather than a second due filter on the client. Grouping by
  // set is what tells the learner a session may span several decks.
  const dueBySet = (dueCards || []).reduce<Record<string, { title: string; count: number }>>(
    (groups, entry) => {
      const key = entry.setId || "unknown";
      groups[key] = groups[key] || { title: entry.setTitle || "Untitled deck", count: 0 };
      groups[key].count += 1;
      return groups;
    },
    {}
  );

  const dueCount = dueCards?.length || 0;
  const hasDueCards = !dueError && dueCards !== null && dueCount > 0;
  const dueLoading = !dueError && dueCards === null;

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
            <Sparkles className="h-3 w-3" /> Daily Review
          </div>
          <h1 className="font-serif text-4xl">Today&apos;s Review</h1>
          <p className="text-sm text-muted-foreground">
            What your scheduled cards ask for today, and where your understanding is weakest.
          </p>
        </div>

        {/* Due flashcards. A failure here is reported in place and leaves the weak
            topics below untouched. */}
        <Card className="academic-card p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent" />
                <h2 className="font-serif text-2xl">Due Flashcards</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Cards scheduled for review by your own ratings.
              </p>
            </div>
            {!dueLoading && !dueError && (
              <Badge variant="outline" className="border-accent/40 text-accent py-2">
                {dueCount} due
              </Badge>
            )}
          </div>

          {dueLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Loading your due cards…
            </div>
          ) : dueError ? (
            <div role="status" className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Could not load your due cards. Your weak topics below are unaffected.</p>
            </div>
          ) : !hasDueCards ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Nothing due right now
              </div>
              <p className="text-sm text-muted-foreground">
                You have worked through every scheduled card. New cards appear here as their
                review date arrives.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {Object.entries(dueBySet).map(([setId, group]) => (
                  <div
                    key={setId}
                    className="flex items-center justify-between rounded-md border border-border bg-card/40 px-3 py-2"
                  >
                    <span className="truncate text-sm text-foreground">{group.title}</span>
                    <span className="ml-3 shrink-0 font-mono text-xs text-muted-foreground">
                      {group.count} {group.count === 1 ? "card" : "cards"}
                    </span>
                  </div>
                ))}
              </div>
              {/*
                The CTA hands the session to the existing review UI rather than
                starting one here, so that rating a card goes through exactly one
                code path.
              */}
              <Button
                onClick={() => navigate("/flashcards?due=1")}
                className="bg-accent text-primary-foreground hover:bg-accent/90"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Start Review
              </Button>
            </>
          )}
        </Card>

        {/* Weak topics. Independent of the section above for the same reason. */}
        <Card className="academic-card p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-accent" />
                <h2 className="font-serif text-2xl">Weak Topics</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Derived from your attempt history, weakest first.
              </p>
            </div>
          </div>

          {weakError ? (
            <div role="status" className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Could not load weak topics. Your due cards above are unaffected.</p>
            </div>
          ) : weakTopics === null ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Loading your weak topics…
            </div>
          ) : weakTopics.length === 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                No weak topics detected
              </div>
              <p className="text-sm text-muted-foreground">
                Mastery is above the threshold across your topics. Attempts on new material will
                surface anything that needs attention.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {weakTopics.map((topic) => (
                <div
                  key={topic.topic}
                  className="flex items-center justify-between gap-4 rounded-md border border-border bg-card/40 px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm text-foreground">{topic.topic}</p>
                    {topic.subject && (
                      <p className="truncate text-xs text-muted-foreground">{topic.subject}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {topic.recommendedDifficulty && (
                      <Badge variant="outline" className="border-border text-muted-foreground">
                        {topic.recommendedDifficulty}
                      </Badge>
                    )}
                    <span className="font-mono text-xs text-muted-foreground">
                      {topic.weaknessScore ?? 0}% weak
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
};

export default TodaysReview;
