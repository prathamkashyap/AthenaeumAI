/**
 * Flashcards — due review mode
 * ============================
 *
 * `Flashcards.tsx` already called `GET /flashcards/due?limit=100` but kept only
 * `dueCount` and discarded `dueData.cards`, so a review session always began at
 * `sets[0]` — the most recently created deck, whose first card may not be due at
 * all. This suite covers the `?due=1` mode that consumes the payload, plus the
 * requirement that ordinary browsing is untouched.
 *
 * Load-bearing behaviours:
 *
 *   - due mode reviews the endpoint's cards, which span several sets;
 *   - each rating is submitted against the set that owns that card;
 *   - the session ends on the final card instead of wrapping, because a rating
 *     advances the schedule immediately and wrapping would let the same card be
 *     rated twice in one sitting;
 *   - without `?due=1`, nothing about the page changes.
 *
 * The review UI, the rating controls and the review endpoint are shared with
 * normal mode by construction: there is one component and one POST.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  // `useSearchParams` returns a [params, setParams] tuple, and the component
  // destructures the first element, so the mock has to match that shape.
  useSearchParams: () => [new URLSearchParams(dueMode ? "due=1" : ""), vi.fn()],
}));

import Flashcards from "@/pages/Flashcards";

// Read by the `useSearchParams` mock above, which is hoisted above the module
// under test. Lets each test opt in or out of due mode.
let dueMode = false;

const SET_A = {
  _id: "set-a",
  title: "OS Notes — Mistake Review",
  sourceType: "mistakes",
  createdAt: "2026-01-01T00:00:00Z",
  cards: [
    { _id: "a1", topic: "Deadlock", front: "Deadlock conditions?", back: "Four together." },
    { _id: "a2", topic: "Memory", front: "Page fault?", back: "A trap." },
  ],
};

const SET_B = {
  _id: "set-b",
  title: "Networking Deck",
  sourceType: "weak-topics",
  createdAt: "2026-01-02T00:00:00Z",
  cards: [
    { _id: "b1", topic: "TCP", front: "Three-way handshake?", back: "SYN, SYN-ACK, ACK." },
    { _id: "b2", topic: "UDP", front: "Why is UDP used for streaming?", back: "No handshake." },
  ],
};

/**
 * Two due cards from two different sets. The second belongs to `set-b`, so a
 * submission using the selected set would post to the wrong place.
 */
const DUE_CARDS = [
  { setId: "set-a", setTitle: SET_A.title, nextReviewAt: "2026-01-01T00:00:00Z", card: SET_A.cards[0] },
  { setId: "set-b", setTitle: SET_B.title, nextReviewAt: "2026-01-02T00:00:00Z", card: SET_B.cards[0] },
];

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const renderPage = async (opts: { due?: boolean } = {}) => {
  dueMode = opts.due ?? false;
  const view = render(<Flashcards />);
  // Settle both mount requests before asserting.
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  dueMode = false;
  apiFetch.mockImplementation((url: string) => {
    if (url === "/flashcards") return Promise.resolve(ok({ sets: [SET_B, SET_A] }));
    if (String(url).startsWith("/flashcards/due")) {
      return Promise.resolve(ok({ cards: DUE_CARDS, dueCount: DUE_CARDS.length }));
    }
    if (String(url).includes("/review")) return Promise.resolve(ok({ ok: true }));
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
});

describe("due mode consumes the due payload", () => {
  it("presents the due cards, not the first set's cards", async () => {
    await renderPage({ due: true });

    // `sets` is ordered [SET_B, SET_A], so the pre-existing default selection was
    // set-b. Due mode must ignore that and use the endpoint's list instead.
    expect(await screen.findByText("Deadlock conditions?")).toBeTruthy();
    expect(screen.getByText(/Card 1 of 2/)).toBeTruthy();
  });

  it("includes a due card that lives in a different set from the first", async () => {
    await renderPage({ due: true });

    expect(await screen.findByText("Deadlock conditions?")).toBeTruthy();
    // The second due card is from set-b, which is a different deck entirely.
    fireEvent.click(screen.getByText("Deadlock conditions?"));
    expect(await screen.findByText("Four together.")).toBeTruthy();
  });

  it("names the deck a due card came from", async () => {
    await renderPage({ due: true });

    // The session spans decks, so the learner is told which one they are in.
    expect(await screen.findByText("OS Notes — Mistake Review")).toBeTruthy();
  });

  it("marks the page as today's review rather than deck browsing", async () => {
    await renderPage({ due: true });

    expect(await screen.findByRole("heading", { name: /today's review/i })).toBeTruthy();
  });

  it("hides the deck chips, which do not apply to a due session", async () => {
    await renderPage({ due: true });

    await screen.findByText("Deadlock conditions?");
    // Clicking a chip mid-session would swap the list out from under the learner.
    expect(screen.queryByRole("button", { name: "Networking Deck" })).toBeNull();
  });

  it("does not offer deck generation mid-session", async () => {
    await renderPage({ due: true });

    await screen.findByText("Deadlock conditions?");
    expect(screen.queryByRole("button", { name: /generate weak-topic deck/i })).toBeNull();
  });
});

describe("ratings are submitted against the card's own set", () => {
  it("uses the first due card's set", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"));
      expect(call?.[0]).toBe("/flashcards/set-a/cards/a1/review");
    });
  });

  it("uses the second due card's set once the learner advances", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    // Rating advances the session, so the second rating lands on the card owned
    // by set-b. Using the selected set for both would post both ratings to
    // set-a, which does not own the second card at all.
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.getByText(/Card 2 of 2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => {
      const reviewCalls = apiFetch.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/review"));
      expect(reviewCalls).toEqual([
        "/flashcards/set-a/cards/a1/review",
        "/flashcards/set-b/cards/b1/review",
      ]);
    });
  });

  it("posts the rating the learner chose", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /^hard$/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"));
      expect(JSON.parse(String((call?.[1] as { body: string }).body)).rating).toBe("hard");
    });
  });
});

describe("the due session ends rather than wrapping", () => {
  it("does not return to the first card after the last one", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    // Clear both due cards; the second is the last.
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.getByText(/Card 2 of 2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    // Wrapping would show card 1 of 2 again and invite a second rating of the
    // same card in one sitting, which would advance its schedule twice.
    expect(await screen.findByText(/today's review is done/i)).toBeTruthy();
    expect(screen.queryByText(/Card 1 of 2/)).toBeNull();
  });

  it("reports how much was reviewed", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.getByText(/Card 2 of 2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    // Two cards, so the plural form is the one exercised.
    expect((await screen.findByText(/all 2 due cards/i)).textContent).toMatch(/all 2 due cards/i);
  });

  it("offers a way back to today's review", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.getByText(/Card 2 of 2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    fireEvent.click(await screen.findByRole("button", { name: /back to today's review/i }));

    expect(navigate).toHaveBeenCalledWith("/review");
  });

  it("shows a distinct empty state when nothing is due", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [SET_B, SET_A] }));
      if (String(url).startsWith("/flashcards/due")) return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      return Promise.reject(new Error("unexpected"));
    });

    await renderPage({ due: true });

    // An empty due session is not an empty library, and the copy says so.
    expect(await screen.findByText(/nothing due right now/i)).toBeTruthy();
    expect(screen.queryByText(/no flashcards yet/i)).toBeNull();
  });
});

describe("ordinary browsing is unchanged", () => {
  it("still selects the first set's cards when due mode is off", async () => {
    await renderPage();

    // `sets` is ordered [SET_B, SET_A], so the default selection is set-b.
    expect(await screen.findByText("Three-way handshake?")).toBeTruthy();
  });

  it("still offers the deck chips", async () => {
    await renderPage();

    expect(await screen.findByRole("button", { name: "OS Notes — Mistake Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Networking Deck" })).toBeTruthy();
  });

  it("still offers deck generation", async () => {
    await renderPage();

    expect(await screen.findByRole("button", { name: /generate weak-topic deck/i })).toBeTruthy();
  });

  it("still rates against the selected set", async () => {
    await renderPage();
    await screen.findByText("Three-way handshake?");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"));
      expect(call?.[0]).toBe("/flashcards/set-b/cards/b1/review");
    });
  });

  it("still wraps from the last card to the first", async () => {
    await renderPage();
    await screen.findByText("Three-way handshake?");

    // set-b has two cards. Rating advances the session, so two ratings walk to
    // the end and back around. Wrapping is correct when browsing — the learner is
    // exploring a deck, not working through a queue that is meant to end.
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(screen.getByText(/Card 2 of 2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(screen.getByText(/Card 1 of 2/)).toBeTruthy());
    // No completion screen, because browsing never completes.
    expect(screen.queryByText(/today's review is done/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fourth grade the scheduler already supports.
//
// The backend accepts `good`, maps it to SM-2 quality 4 and treats it as the
// neutral outcome: the same interval as `hard`, but without the ease penalty,
// where `easy` gains both ease and a 1.3x interval bonus. These tests pin that
// the UI actually exposes and submits it, rather than merely that the TypeScript
// union knows about it.
//
// The easy control is labelled "Got it" in the existing UI. Its label is left
// alone deliberately; these tests assert the rating each control *submits*, which
// is the contract the scheduler depends on.
// ─────────────────────────────────────────────────────────────────────────────
describe("all four supported ratings are exposed and submitted", () => {
  const ratingFor = async (name: RegExp) => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"));
      expect(call).toBeTruthy();
    });
    const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"))!;
    return JSON.parse(String((call[1] as { body: string }).body)).rating;
  };

  it("renders a control for each of the four grades", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    // Hard and Again are literal; easy is labelled "Got it".
    expect(screen.getByRole("button", { name: /^hard$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^again$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^good$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /got it/i })).toBeTruthy();
  });

  it("submits good to the review endpoint", async () => {
    expect(await ratingFor(/^good$/i)).toBe("good");
  });

  // One rating per test: the harness settles exactly two mount requests per
  // render, so three renders in a single test would break that accounting.
  it("still submits again for the Again control", async () => {
    expect(await ratingFor(/^again$/i)).toBe("again");
  });

  it("still submits hard for the Hard control", async () => {
    expect(await ratingFor(/^hard$/i)).toBe("hard");
  });

  it("still submits easy for the Got it control", async () => {
    expect(await ratingFor(/got it/i)).toBe("easy");
  });

  it("posts good against the card's own set and card id", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /^good$/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/review"));
      expect(call).toBeTruthy();
    });
    const [url, init] = apiFetch.mock.calls.find(([u]) => String(u).includes("/review"))!;
    // Due mode ignores the selected set: this card belongs to set-a even though
    // set-b was the pre-existing default selection.
    expect(String(url)).toBe("/flashcards/set-a/cards/a1/review");
    expect((init as { method: string }).method).toBe("POST");
    expect(JSON.parse(String((init as { body: string }).body))).toEqual({ rating: "good" });
  });

  it("still advances the session after a good rating", async () => {
    await renderPage({ due: true });
    await screen.findByText("Deadlock conditions?");

    fireEvent.click(screen.getByRole("button", { name: /^good$/i }));

    // A rating advances the card exactly as the other three do; treating `good`
    // as a no-op would stall the session.
    expect(await screen.findByText(/Card 2 of 2/)).toBeTruthy();
  });
});
