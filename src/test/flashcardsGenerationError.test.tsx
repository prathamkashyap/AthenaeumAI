/**
 * Flashcards — a rejected weak-topic generation must say something
 * ===============================================================
 *
 * `generateWeakTopicSet` had `try { … } finally { … }` and no `catch`. A
 * non-ok response threw into an unhandled rejection: the spinner stopped and
 * nothing was rendered, so the button looked inert with no explanation. The
 * underlying condition is entirely ordinary — a learner with no attempts has no
 * weak topics to build a deck from — and the service already refuses to persist
 * an empty set, so the only thing missing was telling the learner why.
 *
 * These tests cover the surfacing: the backend's own message is shown rather
 * than swallowed, the learner is routed to the step that fixes it, and successful
 * generation is unchanged. Task 22's due-review behaviour is asserted where this
 * change touches the same file, so the two cannot quietly interfere.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { navigate, dueMode } = vi.hoisted(() => ({ navigate: vi.fn(), dueMode: { value: false } }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(dueMode.value ? "due=1" : ""), vi.fn()],
}));

import Flashcards from "@/pages/Flashcards";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const SET = {
  _id: "set-a",
  title: "Weak-Topic Deck",
  sourceType: "weak-topics",
  createdAt: "2026-01-01T00:00:00Z",
  cards: [{ _id: "c1", topic: "Deadlock", front: "Four conditions?", back: "Mutual exclusion and three more." }],
};

// What the service sends for a learner with no weak topics, verbatim.
const NO_WEAK_TOPICS = {
  error: "No weak topics yet. Take an assessment first to build adaptive review.",
  requestId: "req-1",
};

const generateBtn = () => screen.getByRole("button", { name: /generate weak-topic deck/i });

const renderPage = async () => {
  const view = render(<Flashcards />);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  dueMode.value = false;
  apiFetch.mockImplementation((url: string) => {
    if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
    if (String(url).startsWith("/flashcards/due")) {
      return Promise.resolve(ok({ cards: [], dueCount: 0 }));
    }
    if (String(url).includes("/review")) return Promise.resolve(ok({}));
    return Promise.resolve({ ok: true, status: 201, json: async () => ({ set: SET }) });
  });
});

describe("generation that the server declines", () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
      if (String(url).startsWith("/flashcards/due")) {
        return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      }
      // The 400 the service now returns for a learner with no weak topics.
      return Promise.resolve({ ok: false, status: 400, json: async () => NO_WEAK_TOPICS });
    });
  });

  it("shows the server's explanation instead of failing silently", async () => {
    await renderPage();

    fireEvent.click(generateBtn());

    // Before the catch existed this rejection was unhandled: the spinner stopped
    // and the page said nothing at all.
    expect(await screen.findByRole("status")).toHaveTextContent(/no weak topics yet/i);
  });

  it("keeps the guidance rather than reducing it to a failure notice", async () => {
    await renderPage();
    fireEvent.click(generateBtn());

    // The endpoint's `error` field is the contract. Rendering the service's own
    // wording avoids teaching this page to match an internal string.
    expect(await screen.findByRole("status")).toHaveTextContent(/take an assessment first/i);
  });

  it("routes to the step that resolves it", async () => {
    await renderPage();
    fireEvent.click(generateBtn());

    fireEvent.click(await screen.findByRole("button", { name: /create assessment/i }));
    expect(navigate).toHaveBeenCalledWith("/assessments/create");
  });

  it("falls back to a usable message when the body carries none", async () => {
    // A 502 or an empty body must not leave the learner with a blank region.
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
      if (String(url).startsWith("/flashcards/due")) {
        return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      }
      return Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    });

    await renderPage();
    fireEvent.click(generateBtn());

    expect(await screen.findByRole("status")).toHaveTextContent(/could not generate/i);
  });

  it("adds no deck when generation was declined", async () => {
    await renderPage();
    fireEvent.click(generateBtn());
    await screen.findByRole("status");

    // The service persists nothing here, so the page must not pretend otherwise.
    expect(screen.queryByText(SET.title)).toBeNull();
  });

  it("re-enables the button so the learner can try again", async () => {
    await renderPage();
    fireEvent.click(generateBtn());
    await screen.findByRole("status");

    expect(generateBtn()).not.toBeDisabled();
  });

  it("clears a previous message on retry", async () => {
    await renderPage();
    fireEvent.click(generateBtn());
    await screen.findByRole("status");

    // The second attempt succeeds, so the stale error must not linger.
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
      if (String(url).startsWith("/flashcards/due")) {
        return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ set: SET }) });
    });
    fireEvent.click(generateBtn());

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(await screen.findByText(SET.title)).toBeTruthy();
  });
});

describe("successful generation is unchanged", () => {
  it("adds and selects the new deck", async () => {
    await renderPage();

    fireEvent.click(generateBtn());

    expect(await screen.findByText(SET.title)).toBeTruthy();
    expect(screen.getByText(SET.cards[0].front)).toBeTruthy();
  });

  it("reports no error", async () => {
    await renderPage();
    fireEvent.click(generateBtn());

    await screen.findByText(SET.title);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("due mode is unaffected", () => {
  beforeEach(() => {
    dueMode.value = true;
  });

  it("does not offer deck generation inside a due session", async () => {
    // Generation is a browsing action; the Task 22 session hides it.
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
      if (String(url).startsWith("/flashcards/due")) {
        return Promise.resolve(ok({
          cards: [{ setId: "set-a", setTitle: "Deck A", nextReviewAt: "2026-01-01T00:00:00Z", card: SET.cards[0] }],
          dueCount: 1,
        }));
      }
      return Promise.resolve(ok({}));
    });

    await renderPage();

    await screen.findByText(SET.cards[0].front);
    expect(screen.queryByRole("button", { name: /generate weak-topic deck/i })).toBeNull();
  });

  it("never shows a generation error in due mode", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/flashcards") return Promise.resolve(ok({ sets: [] }));
      if (String(url).startsWith("/flashcards/due")) {
        return Promise.resolve(ok({ cards: [], dueCount: 0 }));
      }
      return Promise.resolve({ ok: false, status: 400, json: async () => NO_WEAK_TOPICS });
    });

    await renderPage();

    // Nothing was generated in this session, so there is nothing to report.
    expect(await screen.findByText(/nothing due right now/i)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
