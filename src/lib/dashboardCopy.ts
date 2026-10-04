/**
 * Dashboard language
 * ==================
 *
 * The dashboard used to open with the same two sentences for every learner
 * regardless of their state — "Your adaptive workspace is ready." — which is the
 * tell of a template rather than a product that knows anything about the person
 * using it.
 *
 * Two rules shape this module:
 *
 * 1. **Context before variety.** A line is chosen because it is true of the
 *    learner's state, not because it is a nice-sounding string. Four states, each
 *    with its own pool.
 * 2. **Deterministic rotation.** Variation comes from the day index, so the copy
 *    changes as the day turns over and is stable within a day. Picking at random
 *    per render would make the dashboard feel unstable and would churn the DOM
 *    and any assistive tech reading it.
 *
 * Pure functions with no React or fetch dependency, so the selection logic is
 * testable on its own.
 */

export type DashboardState = "new" | "attempting" | "due" | "weak";

export interface LearnerSignals {
  /** Assessments completed, from analytics totals. */
  quizzesTaken?: number;
  /** Open review items due now. */
  reviewDueToday?: number;
  /** Weak topics detected from real attempts. */
  weakTopicCount?: number;
  /** Assessments listed on the dashboard. Used as an attempts fallback. */
  recentQuizCount?: number;
}

const DAY_MS = 86_400_000;

/** Days since the epoch — the rotation key. */
export const dayIndex = (now: number): number => Math.floor(now / DAY_MS);

/** Stable within a day, varies across days. */
export const pickForDay = <T,>(pool: readonly T[], day: number): T =>
  pool[((day % pool.length) + pool.length) % pool.length];

/**
 * The most specific true thing about the learner wins.
 *
 * Due reviews outrank weak topics because they are time-sensitive and actionable
 * right now; weak topics outrank plain attempt history because they are the
 * result of real attempts rather than a signal of having tried something.
 */
export const resolveState = (s: LearnerSignals): DashboardState => {
  if ((s.reviewDueToday ?? 0) > 0) return "due";
  if ((s.weakTopicCount ?? 0) > 0) return "weak";
  const attempts = s.quizzesTaken ?? s.recentQuizCount ?? 0;
  return attempts > 0 ? "attempting" : "new";
};

export const HERO_LINES: Record<DashboardState, readonly string[]> = {
  new: [
    "Bring your notes. We'll turn them into a study loop.",
    "Start with one chapter. We'll build the rest around it.",
    "Your next study session starts here.",
    "Upload a chapter and let Athenaeum map what matters.",
    "One PDF is enough to get started.",
  ],
  attempting: [
    "Your recent attempts are shaping today's review.",
    "Your mastery map is starting to take shape.",
    "A few topics need more attention. Let's work through them.",
    "Your latest answers have changed your review priorities.",
    "Your next review is built from what you actually struggled with.",
  ],
  due: [
    "Your review queue is ready.",
    "A few concepts are due for another pass.",
    "Today's session is waiting in your review queue.",
    "Let's reinforce what is starting to fade.",
    "Short pass, but an important one.",
  ],
  weak: [
    "Your weakest topics are ready for another pass.",
    "Athenaeum found a few areas worth revisiting.",
    "Your recent mistakes point to today's best study targets.",
    "These are the topics costing you the most right now.",
    "Focused work here will move your readiness fastest.",
  ],
};

export const SUPPORT_LINES: Record<DashboardState, readonly string[]> = {
  new: [
    "Generate an assessment from a PDF and we'll take it from there.",
    "Everything here is built from attempts, not guesswork.",
    "Upload material and we'll map what to revise first.",
  ],
  attempting: [
    "Accuracy, mastery and confidence are tracked per topic.",
    "Review items come from the questions you actually got wrong.",
    "Spacing is scheduled from your retention, not a fixed calendar.",
  ],
  due: [
    "Each item is drawn from your own attempts.",
    "Short and focused — these are the ones close to fading.",
    "Finish these and we'll re-plan what's next.",
  ],
  weak: [
    "We rank these by how much they are costing you.",
    "Clear a topic and it drops down the list.",
    "These are measured, not guessed.",
  ],
};

export interface DashboardCopy {
  state: DashboardState;
  hero: string;
  support: string;
}

/** Resolves both lines for a learner at a point in time. */
export const dashboardCopy = (
  signals: LearnerSignals,
  now: number,
): DashboardCopy => {
  const state = resolveState(signals);
  const day = dayIndex(now);
  return {
    state,
    hero: pickForDay(HERO_LINES[state], day),
    support: pickForDay(SUPPORT_LINES[state], day + 1),
  };
};
