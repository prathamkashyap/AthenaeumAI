/**
 * Profile achievements
 * ====================
 *
 * The Profile page rendered two hard-coded achievement cards — "First Quiz
 * Completed" and "3 Day Streak" — as literal JSX. A brand-new production account
 * was therefore told it had completed an assessment and held a three-day streak
 * while the streak figures directly above it read 0.
 *
 * The page now lists only what the backend has actually awarded, and shows an
 * honest empty state with an unlock hint when nothing has been earned.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn();

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: {} }) }),
  API_ROOT: "http://localhost:5001/api/v1",
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

import Profile from "@/pages/Profile";

type Achievement = {
  id: string;
  title: string;
  description?: string;
  unlockedAt?: string;
};

let mockUser: {
  _id?: string;
  name: string;
  email: string;
  streak?: { current: number; longest: number; lastStudyDate: string };
  achievements?: Achievement[];
};

beforeEach(() => {
  mockUser = {
    _id: "u1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    streak: { current: 0, longest: 0, lastStudyDate: "" },
  };
});

describe("a learner who has earned nothing", () => {
  it("says so instead of showing achievements", () => {
    render(<Profile />);

    expect(screen.getByText("No achievements yet")).toBeInTheDocument();
  });

  it("explains how to unlock the first one", () => {
    render(<Profile />);

    // Motivating, and truthful: a hint, not a claim.
    expect(
      screen.getByText(/complete your first assessment to unlock/i),
    ).toBeInTheDocument();
  });

  it("shows none of the previously hard-coded entries", () => {
    render(<Profile />);

    expect(screen.queryByText("First Quiz Completed")).not.toBeInTheDocument();
    expect(screen.queryByText("3 Day Streak")).not.toBeInTheDocument();
    expect(screen.queryByText(/completed your first diagnostic/i)).not.toBeInTheDocument();
  });

  it("treats a missing achievements field as none earned", () => {
    // A user object stored before the field existed must not crash or invent any.
    delete mockUser.achievements;
    render(<Profile />);

    expect(screen.getByText("No achievements yet")).toBeInTheDocument();
  });
});

describe("a learner with real achievements", () => {
  it("renders the persisted titles and descriptions", () => {
    mockUser.achievements = [
      {
        id: "first_quiz",
        title: "First Steps",
        description: "Completed your first assessment.",
        unlockedAt: "2026-04-28T09:00:00.000Z",
      },
      {
        id: "streak_3",
        title: "3 Day Streak",
        description: "Studied for 3 consecutive days.",
        unlockedAt: "2026-04-30T09:00:00.000Z",
      },
    ];

    render(<Profile />);

    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getByText("Completed your first assessment.")).toBeInTheDocument();
    expect(screen.getByText("3 Day Streak")).toBeInTheDocument();
    expect(screen.queryByText("No achievements yet")).not.toBeInTheDocument();
  });

  it("uses assessment vocabulary, never quiz", () => {
    mockUser.achievements = [
      {
        id: "first_quiz",
        title: "First Steps",
        description: "Completed your first assessment.",
      },
    ];

    const { container } = render(<Profile />);

    expect(container.textContent).not.toMatch(/\bquiz\b/i);
  });

  it("lists the most recently unlocked first", () => {
    mockUser.achievements = [
      { id: "first_quiz", title: "Older", unlockedAt: "2026-04-28T09:00:00.000Z" },
      { id: "streak_3", title: "Newer", unlockedAt: "2026-04-30T09:00:00.000Z" },
    ];

    render(<Profile />);

    const titles = screen
      .getAllByText(/Older|Newer/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Newer", "Older"]);
  });

  it("renders an achievement that carries no description", () => {
    mockUser.achievements = [{ id: "x", title: "Bare" }];
    render(<Profile />);

    expect(screen.getByText("Bare")).toBeInTheDocument();
  });
});

describe("streak figures and achievements cannot disagree", () => {
  it("shows a real 3-day streak with the matching achievement", () => {
    mockUser.streak = { current: 3, longest: 3, lastStudyDate: "2026-04-30" };
    mockUser.achievements = [
      { id: "streak_3", title: "3 Day Streak", description: "Studied for 3 consecutive days." },
    ];

    const { container } = render(<Profile />);

    // Both the current and the longest streak read 3, so there are two figures.
    expect(screen.getAllByText("3")).toHaveLength(2);
    expect(container.textContent).toContain("Current active streak");
    expect(container.textContent).toContain("Longest streak");
    expect(screen.getByText("3 Day Streak")).toBeInTheDocument();
  });

  it("does not show a streak achievement when the streak is zero", () => {
    mockUser.streak = { current: 0, longest: 0, lastStudyDate: "" };
    mockUser.achievements = [];

    render(<Profile />);

    expect(screen.queryByText("3 Day Streak")).not.toBeInTheDocument();
    expect(screen.getByText("No achievements yet")).toBeInTheDocument();
  });
});
