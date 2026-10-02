import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Brain, CheckCircle2, CircleAlert, Layers, Loader2, Sparkles, Target } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * Today's Review
 * =============
 *
 * A composition page. Everything it shows is already computed by the backend and
 * already exposed — due cards by `GET /flashcards/due`, weak topics by
 * `GET /analytics/dashboard`, and the persistent failed-question backlog by
 * `GET /review-queue` — so this page adds no endpoint, no model and no
 * scheduling. It also deliberately contains no flashcard interaction: the actual
 * review is owned by `Flashcards.tsx`, entered through the `?due=1` CTA below.
 *
 * The three requests are independent. Neither can fail the other: a learner whose
 * dashboard request fails should still see what is due, and a learner with no
 * due cards should still see which topics are weak and which questions they keep
 * missing. Collapsing them into one loading and one error state would hide
 * whichever sections succeeded.
 *
 * Only `failed_question` items are shown. The queue also carries `weak_topic`,
 * `low_confidence_topic`, `due_flashcard` and `overdue_review`, but those are
 * already represented above and in `Flashcards.tsx`, and duplicating them here
 * would give the learner two places to look for the same work. The failed-question
 * backlog is the one persistent review surface that was previously invisible: the
 * result page shows mistakes only while the attempt is still in memory.
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

/**
 * A `failed_question` item, narrowed from the review-queue document.
 *
 * Deliberately limited to fields the endpoint actually returns. `source.quiz` and
 * `source.attempt` are bare ObjectIds with nothing populated, and the queue
 * carries no question text, so this type does not pretend to any of them. The
 * learner is told the topic and the misconception — not the question they missed.
 */
interface FailedQuestionItem {
  _id: string;
  itemType: string;
  topic: string;
  title: string;
  description: string;
  dueAt: string;
  metadata?: {
    questionIndex?: number;
    misconception?: string;
    clarification?: string;
    distractorReason?: string;
  };
}

// The largest page `listReviewQueue` accepts; it clamps to 100.
const QUEUE_PAGE_SIZE = 100;
// Matches the service default, so a snooze needs no choice to be made here.
const SNOOZE_HOURS = 24;

const TodaysReview = () => {
  const navigate = useNavigate();

  const [dueCards, setDueCards] = useState<DueCardEntry[] | null>(null);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[] | null>(null);
  // `null` until the request settles, so a failure is never mistaken for empty.
  const [queueItems, setQueueItems] = useState<FailedQuestionItem[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [dueError, setDueError] = useState(false);
  const [weakError, setWeakError] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

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
    apiFetch(`/review-queue?limit=${QUEUE_PAGE_SIZE}`)
      .then((response) => {
        if (!response.ok) throw new Error("queue request failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        // Presentation-only selection. The endpoint has already decided what is
        // open and when it is due; no queue-selection rule is recomputed here.
        setQueueItems((data.items || []).filter((item: FailedQuestionItem) => item.itemType === "failed_question"));
        setQueueTotal(data.pagination?.total ?? 0);
      })
      .catch(() => {
        if (active) setQueueError(true);
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

  const failedQuestions = queueItems || [];
  const queueLoading = !queueError && queueItems === null;

  /**
   * A snoozed item is still open — `snoozeReviewQueueItem` moves `dueAt` and drops
   * the priority but leaves the status alone, so the list keeps returning it. A
   * future `dueAt` is therefore the only signal that it is snoozed, and it is not
   * something the learner can act on today.
   */
  const isSnoozed = (item: FailedQuestionItem) =>
    Boolean(item.dueAt) && new Date(item.dueAt).getTime() > Date.now();

  /**
   * Both mutations go through the endpoints that already exist. Completion removes
   * the item server-side, so it is dropped from local state to match; a snooze is
   * applied to the returned item rather than optimistically guessed, so the due
   * date shown is the one the server actually stored.
   */
  const completeItem = async (item: FailedQuestionItem) => {
    setPendingItemId(item._id);
    try {
      const response = await apiFetch(`/review-queue/${item._id}/complete`, { method: "POST" });
      if (!response.ok) return;
      setQueueItems((current) => (current || []).filter((entry) => entry._id !== item._id));
    } catch {
      // Left in place. Removing an item the server did not complete would tell the
      // learner it is done when it is not.
    } finally {
      setPendingItemId(null);
    }
  };

  const snoozeItem = async (item: FailedQuestionItem) => {
    setPendingItemId(item._id);
    try {
      const response = await apiFetch(`/review-queue/${item._id}/snooze`, {
        method: "POST",
        body: JSON.stringify({ hours: SNOOZE_HOURS }),
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      setQueueItems((current) =>
        (current || []).map((entry) => (entry._id === item._id ? { ...entry, ...data.item } : entry))
      );
    } catch {
      // Left untouched for the same reason as completion.
    } finally {
      setPendingItemId(null);
    }
  };
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

        {/*
          The persistent failed-question backlog. This is the one review surface
          that had nowhere to live: the result page renders mistakes only while the
          attempt is still in `QuizContext`, so a learner returning days later had
          no way to see what they keep getting wrong.
        */}
        <Card className="academic-card p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CircleAlert className="h-4 w-4 text-accent" />
                <h2 className="font-serif text-2xl">Failed Questions</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Questions you have answered incorrectly, kept until you deal with them.
              </p>
            </div>
            {!queueLoading && !queueError && failedQuestions.length > 0 && (
              <Badge variant="outline" className="border-accent/40 text-accent py-2">
                {failedQuestions.length} queued
              </Badge>
            )}
          </div>

          {queueError ? (
            <div role="status" className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Could not load your failed questions. Your due cards above are unaffected.</p>
            </div>
          ) : queueLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Loading your failed questions…
            </div>
          ) : failedQuestions.length === 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                No failed questions queued
              </div>
              <p className="text-sm text-muted-foreground">
                Nothing is waiting on you here. This is separate from the cards and topics
                above, which may still have work due.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {failedQuestions.map((item) => {
                const snoozed = isSnoozed(item);
                const busy = pendingItemId === item._id;
                return (
                  <div
                    key={item._id}
                    className="rounded-md border border-border bg-card/40 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.topic || item.title}
                        </p>
                        {item.metadata?.misconception && (
                          <p className="text-sm text-muted-foreground">
                            {item.metadata.misconception}
                          </p>
                        )}
                        {(item.metadata?.clarification || item.description) && (
                          <p className="text-xs text-muted-foreground">
                            {item.metadata?.clarification || item.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {typeof item.metadata?.questionIndex === "number" && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            Q{item.metadata.questionIndex + 1}
                          </span>
                        )}
                        {snoozed && (
                          <Badge variant="outline" className="border-border text-muted-foreground">
                            Snoozed until {new Date(item.dueAt).toLocaleDateString()}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {/*
                      A snoozed item is not offered the actions it is not ready for,
                      and is never described as completed. There is deliberately no
                      unsnooze: no such operation exists, and inventing a client-side
                      one would only look like it worked.
                    */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => completeItem(item)}
                        disabled={busy || snoozed}
                        className="border-accent text-accent hover:bg-accent/10"
                      >
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => snoozeItem(item)}
                        disabled={busy || snoozed}
                        className="border-border"
                      >
                        Snooze {SNOOZE_HOURS}h
                      </Button>
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                    </div>
                  </div>
                );
              })}
              {/*
                The endpoint caps a page at 100. If more are queued than arrived,
                say so rather than implying the list is the whole backlog.
              */}
              {queueTotal > failedQuestions.length && (
                <p className="text-xs text-muted-foreground">
                  Showing {failedQuestions.length} of {queueTotal} queued items. Older items are
                  not listed here.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
};

export default TodaysReview;
