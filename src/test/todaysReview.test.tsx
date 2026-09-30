/**
 * Today's Review
 * =============
 *
 * A composition page over two endpoints that already existed: `GET
 * /flashcards/due` for due cards and `GET /analytics/dashboard` for weak topics.
 * No backend work accompanies it, so these tests are about composition and about
 * the failure behaviour that composition has to get right.
 *
 * The behaviour treated as load-bearing:
 *
 *   - each section renders from its own endpoint, and is independently empty;
 *   - one request failing does not remove the other section, because a learner
 *     who cannot see their weak topics should still be able to clear what is due
 *     and the reverse;
 *   - the CTA hands off to the existing review UI in due mode rather than
 *     starting a second review interaction on this page.
 *
 * Assertions use accessible role and text, so neither a restyle nor a copy edit
 * can quietly turn a wrong state into a right-looking one.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import TodaysReview from "@/pages/TodaysReview";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const duePayload = (cards: unknown[]) => ({ cards, dueCount: cards.length });

const WEAK_TOPICS = [
  { topic: "Deadlock", subject: "Operating Systems", weaknessScore: 72, recommendedDifficulty: "Easy" },
  { topic: "Page Replacement", subject: "Operating Systems", weaknessScore: 55, recommendedDifficulty: "Medium" },
];

// Three due cards across two decks, with unequal deck sizes — the case a
// single-set UI cannot show, and one where the singular/plural wording is
// actually exercised rather than only matching one entry.
const DUE_CARDS = [
  { setId: "set-a", setTitle: "OS Notes — Mistake Review", nextReviewAt: "2026-01-01T00:00:00Z", card: { _id: "card-1", topic: "Deadlock", front: "Deadlock conditions?", back: "Four together." } },
  { setId: "set-a", setTitle: "OS Notes — Mistake Review", nextReviewAt: "2026-01-01T01:00:00Z", card: { _id: "card-2", topic: "Memory", front: "Page fault?", back: "A trap on a missing translation." } },
  { setId: "set-b", setTitle: "Networking Deck", nextReviewAt: "2026-01-02T00:00:00Z", card: { _id: "card-3", topic: "TCP", front: "Three-way handshake?", back: "SYN, SYN-ACK, ACK." } },
];

const renderPage = async () => {
  const view = render(<TodaysReview />);
  // Both requests are fired on mount; wait for the section headings so each
  // assertion starts from a settled render.
  await screen.findByRole("heading", { name: /due flashcards/i });
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((url: string) => {
    if (url.startsWith("/flashcards/due")) return Promise.resolve(ok(duePayload(DUE_CARDS)));
    if (url.startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: WEAK_TOPICS }));
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
});

describe("due cards", () => {
  it("renders the count from the due endpoint", async () => {
    await renderPage();

    expect(await screen.findByText("3 due")).toBeTruthy();
  });

  it("names each deck a due card comes from, so a cross-deck session is legible", async () => {
    await renderPage();

    // Grouping by deck is what tells the learner a session is not one deck.
    expect(await screen.findByText("OS Notes — Mistake Review")).toBeTruthy();
    expect(await screen.findByText("Networking Deck")).toBeTruthy();
  });

  it("shows how many cards each deck contributes", async () => {
    await renderPage();

    // Per-deck counts, and the singular form is distinct from the plural.
    expect(await screen.findByText("2 cards")).toBeTruthy();
    expect(await screen.findByText("1 card")).toBeTruthy();
  });

  it("requests the due endpoint with the existing limit", async () => {
    await renderPage();

    const dueCall = apiFetch.mock.calls.find(([url]) => String(url).startsWith("/flashcards/due"));
    // Reuses the endpoint and its existing shape rather than adding a new one.
    expect(dueCall?.[0]).toBe("/flashcards/due?limit=100");
  });

  it("does not offer a review when nothing is due", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/flashcards/due")) return Promise.resolve(ok(duePayload([])));
      if (url.startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: WEAK_TOPICS }));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage();

    // An explicit empty state, and no CTA that could only fail.
    expect(await screen.findByText(/nothing due right now/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start review/i })).toBeNull();
  });
});

describe("weak topics", () => {
  it("renders each weak topic from dashboard analytics", async () => {
    await renderPage();

    expect(await screen.findByText("Deadlock")).toBeTruthy();
    expect(await screen.findByText("Page Replacement")).toBeTruthy();
  });

  it("shows the weakness score the analytics endpoint computed", async () => {
    await renderPage();

    // 72, not a re-derived or rounded value of our own.
    expect(await screen.findByText("72% weak")).toBeTruthy();
  });

  it("shows the recommended difficulty the analytics endpoint supplied", async () => {
    await renderPage();

    expect(await screen.findByText("Medium")).toBeTruthy();
  });

  it("handles an empty weak-topic list explicitly", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/flashcards/due")) return Promise.resolve(ok(duePayload(DUE_CARDS)));
      if (url.startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: [] }));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage();

    expect(await screen.findByText(/no weak topics detected/i)).toBeTruthy();
    // The due section is unaffected by an empty weak-topic list.
    expect(screen.getByRole("button", { name: /start review/i })).toBeTruthy();
  });
});

describe("the two sections fail independently", () => {
  it("keeps weak topics when the due request fails", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/flashcards/due")) return Promise.reject(new Error("network"));
      if (url.startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: WEAK_TOPICS }));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage();

    // The due section reports its own failure rather than blanking the page.
    expect(await screen.findByText(/could not load your due cards/i)).toBeTruthy();
    expect(await screen.findByText("Deadlock")).toBeTruthy();
  });

  it("keeps due cards when the dashboard request fails", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/flashcards/due")) return Promise.resolve(ok(duePayload(DUE_CARDS)));
      if (url.startsWith("/analytics/dashboard")) return Promise.reject(new Error("network"));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage();

    expect(await screen.findByText(/could not load weak topics/i)).toBeTruthy();
    // The learner can still clear what is due, which is the section that matters
    // most when the other half is unavailable.
    expect(await screen.findByText("3 due")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start review/i })).toBeTruthy();
  });

  it("does not claim a review is available when the due request failed", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/flashcards/due")) return Promise.reject(new Error("network"));
      if (url.startsWith("/analytics/dashboard")) return Promise.resolve(ok({ weakTopics: [] }));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage();

    await screen.findByText(/could not load your due cards/i);
    // Showing a CTA here would promise a session whose contents are unknown.
    expect(screen.queryByRole("button", { name: /start review/i })).toBeNull();
  });

  it("survives both requests failing", async () => {
    apiFetch.mockRejectedValue(new Error("network"));

    await renderPage();

    expect(await screen.findByText(/could not load your due cards/i)).toBeTruthy();
    expect(await screen.findByText(/could not load weak topics/i)).toBeTruthy();
  });
});

describe("the start review CTA", () => {
  it("hands off to the existing review UI in due mode", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /start review/i }));

    // `/flashcards?due=1` rather than this page hosting a review. The interaction
    // stays in one place, which is what keeps the SM-2 path single.
    expect(navigate).toHaveBeenCalledWith("/flashcards?due=1");
  });

  it("does not start the review on this page", async () => {
    await renderPage();

    // No rating control or flip card here: this page is orchestration only.
    expect(screen.queryByRole("button", { name: /got it/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^hard$/i })).toBeNull();
  });
});
