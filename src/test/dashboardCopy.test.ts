/**
 * Contextual dashboard language
 * ============================
 *
 * The dashboard used to greet every learner identically. These tests pin the two
 * properties that make the replacement an improvement rather than a novelty:
 *
 *   - the line is chosen because it is **true** of the learner's state, with the
 *     most specific signal winning;
 *   - variation is **deterministic**, so the copy rotates across days but does not
 *     churn between renders of the same day.
 *
 * Pure functions, so no rendering is needed to test the selection logic.
 */

import { describe, expect, it } from "vitest";
import {
  dashboardCopy,
  dayIndex,
  HERO_LINES,
  pickForDay,
  resolveState,
  SUPPORT_LINES,
  type DashboardState,
} from "@/lib/dashboardCopy";

const DAY = 86_400_000;
// Midnight UTC, so any offset below 24h is unambiguously the same day.
const T0 = Date.UTC(2026, 0, 15, 0, 0, 0);

describe("state resolution prefers the most specific truth", () => {
  it("a new learner with no signals", () => {
    expect(resolveState({})).toBe("new");
  });

  it("attempt history alone means attempting", () => {
    expect(resolveState({ quizzesTaken: 3 })).toBe("attempting");
  });

  it("weak topics outrank plain attempt history", () => {
    expect(resolveState({ quizzesTaken: 3, weakTopicCount: 2 })).toBe("weak");
  });

  it("due reviews outrank everything — they are actionable now", () => {
    expect(resolveState({ quizzesTaken: 9, weakTopicCount: 4, reviewDueToday: 2 })).toBe("due");
  });

  it("falls back to recent quizzes when totals are absent", () => {
    expect(resolveState({ recentQuizCount: 1 })).toBe("attempting");
  });

  it("treats an explicit zero as no signal", () => {
    expect(resolveState({ reviewDueToday: 0, weakTopicCount: 0 })).toBe("new");
  });
});

describe("rotation is deterministic, not random", () => {
  it("is stable for every render within the same day", () => {
    const a = dashboardCopy({ quizzesTaken: 2 }, T0);

    // 01:00, 12:00 and 23:00 on the same UTC day.
    expect(dashboardCopy({ quizzesTaken: 2 }, T0 + 3_600_000).hero).toBe(a.hero);
    expect(dashboardCopy({ quizzesTaken: 2 }, T0 + 43_200_000).hero).toBe(a.hero);
    expect(dashboardCopy({ quizzesTaken: 2 }, T0 + 82_800_000).hero).toBe(a.hero);
  });

  it("moves on when the day turns over", () => {
    const today = dashboardCopy({ quizzesTaken: 2 }, T0);
    const tomorrow = dashboardCopy({ quizzesTaken: 2 }, T0 + DAY);

    expect(tomorrow.hero).not.toBe(today.hero);
  });

  it("visits every line in a pool over consecutive days", () => {
    const pool = HERO_LINES.due;
    const seen = new Set<string>();
    for (let d = 0; d < pool.length; d++) {
      seen.add(pickForDay(pool, d));
    }
    expect(seen.size).toBe(pool.length);
  });

  it("wraps safely for negative indices", () => {
    const pool = ["a", "b", "c"] as const;
    expect(pickForDay(pool, -1)).toBe("c");
    expect(pickForDay(pool, -4)).toBe("c");
  });

  it("counts days from the epoch", () => {
    expect(dayIndex(T0)).toBe(Math.floor(T0 / DAY));
  });
});

describe("every state has real copy to show", () => {
  const states: DashboardState[] = ["new", "attempting", "due", "weak"];

  it.each(states)("%s has at least three hero and support lines", (state) => {
    expect(HERO_LINES[state].length).toBeGreaterThanOrEqual(3);
    expect(SUPPORT_LINES[state].length).toBeGreaterThanOrEqual(3);
  });

  it.each(states)("%s never shows the old static line", (state) => {
    for (const line of [...HERO_LINES[state], ...SUPPORT_LINES[state]]) {
      expect(line).not.toBe("Your adaptive workspace is ready.");
    }
  });

  it("returns a line belonging to the resolved state", () => {
    const now = Date.now();
    const copy = dashboardCopy({ reviewDueToday: 4 }, now);

    expect(copy.state).toBe("due");
    expect(HERO_LINES.due).toContain(copy.hero);
    expect(SUPPORT_LINES.due).toContain(copy.support);
  });

  it("hero and support rotate independently so they do not echo", () => {
    const now = Date.now();
    // Every state, across enough days to cover the pools.
    for (let d = 0; d < 6; d++) {
      const at = now + d * DAY;
      for (const signals of [{}, { quizzesTaken: 2 }, { reviewDueToday: 1 }, { weakTopicCount: 1 }]) {
        expect(dashboardCopy(signals, at).hero).not.toBe(dashboardCopy(signals, at).support);
      }
    }
  });
});
