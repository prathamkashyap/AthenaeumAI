/**
 * Indexing status — the asynchronous half of an upload
 * ======================================================
 *
 * Uploading a material and generating a quiz is synchronous: the learner waits and
 * gets questions. Making that material *retrievable* is not. `INDEX_MATERIAL`
 * chunks the text and embeds it in the background, and that job is what lets the
 * tutor answer from the material afterwards. The backend reports its state
 * truthfully — including `not_scheduled`, meaning the material and quiz are
 * committed but the index will never be built — and the client was discarding
 * that report, so every one of those outcomes looked identical to the learner.
 *
 * Each status is rendered as a distinct state rather than a progress bar with
 * different colours, because the states call for different things from the
 * learner: a queued index needs nothing, and an index that will never be built
 * needs to be known before the tutor later refuses every question with no
 * explanation. Nothing here infers state from timing, and nothing claims progress
 * the backend did not report.
 */

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  Search,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BackgroundProcessing } from "@/context/QuizContext";

/**
 * One entry per status the backend can report.
 *
 * `pending`, `queued` and `running` are all in-flight and share one treatment,
 * because from a learner's side they are the same situation: the work is under
 * way and there is nothing to do. `failed` and `not_scheduled` are deliberately
 * not merged. A job that failed ran and did not finish; one that was never
 * scheduled never started, and the fix is different — retry the work rather than
 * investigate a failure.
 */
const STATUS_PRESENTATION = {
  pending: {
    title: "Preparing your material",
    detail: "Your material is saved. Indexing has not started yet.",
    Icon: CircleDashed,
    iconClass: "text-muted-foreground",
    badgeClass: "border-border text-muted-foreground",
    badgeText: "Pending",
  },
  queued: {
    title: "Queued for indexing",
    detail: "Your material is saved and waiting for the indexer to pick it up.",
    Icon: Clock,
    iconClass: "text-muted-foreground",
    badgeClass: "border-border text-muted-foreground",
    badgeText: "Queued",
  },
  running: {
    title: "Indexing your material",
    detail: "Splitting your material into sections and making it searchable. You can start your quiz now — the tutor uses this index once it is ready.",
    Icon: Loader2,
    iconClass: "text-accent animate-spin",
    badgeClass: "border-accent/40 text-accent",
    badgeText: "In progress",
  },
  completed: {
    title: "Your material is indexed",
    detail: "The tutor can now answer questions using this material.",
    Icon: CheckCircle2,
    iconClass: "text-emerald-500",
    badgeClass: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    badgeText: "Ready",
  },
  failed: {
    title: "Indexing failed",
    detail:
      "Your material and quiz were saved, but the tutor will not be able to use this material for answers. You can still take the quiz.",
    Icon: XCircle,
    iconClass: "text-destructive",
    badgeClass: "border-destructive/40 text-destructive",
    badgeText: "Failed",
  },
  not_scheduled: {
    title: "Indexing was not scheduled",
    detail:
      "Your material and quiz were saved, but the indexing job was never started, so the tutor cannot use this material for answers. Re-upload it or ask a question in the tutor to retry.",
    Icon: AlertTriangle,
    iconClass: "text-amber-600 dark:text-amber-400",
    badgeClass: "border-amber-500/50 text-amber-600 dark:text-amber-400",
    badgeText: "Not scheduled",
  },
} as const;

/**
 * True when the status is one the backend will not move away from.
 *
 * The three terminal statuses are a property of the backend's lifecycle rather
 * than of any one component: they are the states `BackgroundJob` refuses to
 * transition out of, so anything asking "is this job still going to change"
 * needs the same answer the server gives. Owned here because this is the only
 * consumer, and a component module that exports helpers defeats Fast Refresh.
 */
const isTerminalJobStatus = (status: BackgroundProcessing["status"]) =>
  status === "completed" || status === "failed" || status === "not_scheduled";

type JobStatus = keyof typeof STATUS_PRESENTATION;

/** A status the panel has no presentation for is treated as unreported, not guessed. */
const resolvePresentation = (status: string) =>
  STATUS_PRESENTATION[status as JobStatus] ?? null;

interface IndexingStatusProps {
  backgroundProcessing: BackgroundProcessing | null;
}

export function IndexingStatus({ backgroundProcessing }: IndexingStatusProps) {
  // No field means no job was tracked. That is not a success and not a failure,
  // and rendering a panel that says either would be a claim the response never
  // made — so nothing is shown.
  if (!backgroundProcessing) return null;

  const presentation = resolvePresentation(backgroundProcessing.status);
  if (!presentation) return null;

  const { Icon, iconClass, badgeClass, badgeText } = presentation;
  const settled = isTerminalJobStatus(backgroundProcessing.status);
  // The backend's own message, shown when it sent one. It is application-level
  // text with no queue or infrastructure detail, and it is more specific than
  // anything this panel could infer.
  const backendMessage = backgroundProcessing.error?.message;
  // A tracking failure is about this client's ability to read the job, not about
  // the job. It is reported separately so it can never be mistaken for one.
  const trackingError = backgroundProcessing.trackingError;

  return (
    <Card
      className="academic-card p-5"
      // Announced rather than merely coloured, so the state is available to a
      // screen reader and survives a greyscale display.
      role="status"
      aria-live="polite"
      aria-label="Material indexing status"
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{presentation.title}</p>
            <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>
              {badgeText}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{presentation.detail}</p>
          {backendMessage && (
            <p className="text-xs text-muted-foreground">{backendMessage}</p>
          )}
          {trackingError && (
            // Deliberately separate from the title, the badge and the detail. A
            // failed read tells us nothing about the job, so this must not read as
            // "indexing failed" — the index may be running perfectly well. Saying
            // so would tell a learner their material is unusable on the strength of
            // a network hiccup.
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {trackingError} The status shown above is the last one read.
            </p>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Search className="h-3 w-3" aria-hidden="true" />
            This is what lets the tutor answer from your material.
          </p>
          {settled && backgroundProcessing.jobId && (
            <p className="text-[11px] text-muted-foreground font-mono">
              Job {backgroundProcessing.jobId}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
