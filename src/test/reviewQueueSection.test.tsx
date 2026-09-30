/**
 * Today's Review — the failed-question backlog
 * ============================================
 *
 * The backend has been building persistent `failed_question` review items from
 * quiz mistakes since the SYNC_ATTEMPT work, and the review-queue API has
 * supported listing, completing and snoozing them throughout. Nothing consumed it.
 * The result page shows mistakes only while the attempt is still in
 * `QuizContext`, so a learner returning later had no way to see what they keep
 * getting wrong.
 *
 * This suite covers the third section added to `/review`. The properties treated
 * as load-bearing:
 *
 *   - only `failed_question` items appear; the other queue types are already
 *     surfaced by the due-cards and weak-topics sections above;
 *   - a failed request is visibly different from zero failed questions;
 *   - this third source is independent of the existing two, so its failure
 *     cannot remove work the learner can otherwise do today;
 *   - completion and snooze go through the endpoints that already exist, and
 *     local state is reconciled from what the server actually did.
 *
 * It also pins what the section must *not* claim. The queue carries no question
 * text and its `source` fields are unpopulated ObjectIds, so there is no
 * "view result", no quiz title and no flashcard deep link here — a test that
 * failed on their absence would be asserting a capability the contract does not
 * have.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import TodaysReview from "@/pages/TodaysReview";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const HOURS = 60 * 60 * 1000;
const futureDate = () => new Date(Date.now() + 24 * HOURS).toISOString();

const failedQuestion = (overrides: Record<string, unknown> = {}) => ({
  _id: "rq-1",
  itemType: "failed_question",
  subject: "Operating Systems",
  topic: "Deadlock",
  title: "Fix misconception: Deadlock",
  description: "Re-read the four conditions.",
  dueAt: new Date(Date.now() - HOURS).toISOString(),
  source: { quiz: "quiz-1", attempt: "attempt-1", flashcardSet: null },
  metadata: {
    questionIndex: 0,
    misconception: "Confused mutual exclusion with hold-and-wait.",
    clarification: "All four conditions must hold at once.",
    distractorReason: "Picked a condition that is necessary but not sufficient.",
  },
  ...overrides,
});

const queueOf = (items: unknown[], total = items.length) => ({
  items,
  pagination: { page: 1, limit: 100, total, pages: 1 },
});

/**
 * The three sources, each independently overridable so a test can fail one and
 * prove the others survive.
 */
const mockSources = ({
  due = { cards: [], dueCount: 0 },
  weak = { weakTopics: [] },
  queue = () => Promise.resolve(ok(queueOf([failedQuestion()]))),
  mutations = true,
}: {
  due?: unknown;
  weak?: unknown;
  queue?: () => Promise<unknown>;
  mutations?: boolean;
} = {}) => {
  apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).startsWith("/flashcards/due")) {
      return Promise.resolve(ok(due));
    }
    if (String(url).startsWith("/analytics/dashboard")) {
      return Promise.resolve(ok(weak));
    }
    if (mutations && String(url).startsWith("/review-queue/")) {
      // The two mutations, echoing back what the server stored.
      const itemId = String(url).split("/")[2];
      if (String(url).endsWith("/snooze")) {
        void init;
        return Promise.resolve(ok({ item: { _id: itemId, dueAt: futureDate() } }));
      }
      return Promise.resolve(ok({ item: { _id: itemId, status: "completed" } }));
    }
    if (String(url).startsWith("/review-queue")) {
      return queue();
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
};

const renderPage = async () => {
  const view = render(<TodaysReview />);
  await screen.findByRole("heading", { name: /failed questions/i });
  return view;
};

const findItem = (text: string | RegExp) => screen.findByText(text).then((el) => el.closest("div.rounded-md") as HTMLElement);

beforeEach(() => {
  vi.clearAllMocks();
  mockSources();
});

describe("what a failed-question item shows", () => {
  it("shows the topic it belongs to", async () => {
    await renderPage();

    expect(await screen.findByText("Deadlock")).toBeTruthy();
  });

  it("shows the misconception when the queue recorded one", async () => {
    await renderPage();

    expect(
      await screen.findByText(/confused mutual exclusion with hold-and-wait/i)
    ).toBeTruthy();
  });

  it("shows the clarification as the corrective detail", async () => {
    await renderPage();

    expect(await screen.findByText(/all four conditions must hold at once/i)).toBeTruthy();
  });

  it("falls back to the item description when there is no clarification", async () => {
    mockSources({
      queue: () =>
        Promise.resolve(ok(queueOf([failedQuestion({ metadata: { questionIndex: 2, misconception: "Unsure." } })]))),
    });

    await renderPage();

    // `description` is what the queue stores when the AI gave no clarification.
    expect(await screen.findByText(/re-read the four conditions/i)).toBeTruthy();
  });

  it("uses the question index as supporting context", async () => {
    await renderPage();

    // Zero-based from the queue, so the learner sees it one-based.
    expect(await screen.findByText("Q1")).toBeTruthy();
  });

  it("claims nothing the queue cannot supply", async () => {
    await renderPage();
    const item = await findItem("Deadlock");

    // The queue has no question text and its source ids are unpopulated, so
    // there is nothing truthful to show or link for either.
    expect(within(item).queryByRole("button", { name: /view result/i })).toBeNull();
    expect(within(item).queryByRole("button", { name: /retry quiz/i })).toBeNull();
    expect(within(item).queryByRole("link")).toBeNull();
  });
});

describe("only failed questions are shown", () => {
  it("omits the other queue item types", async () => {
    mockSources({
      queue: () =>
        Promise.resolve(
          ok(
            queueOf([
              failedQuestion(),
              { _id: "rq-2", itemType: "weak_topic", topic: "Paging", title: "Review weak topic: Paging" },
              { _id: "rq-3", itemType: "low_confidence_topic", topic: "TCP", title: "Rebuild confidence: TCP" },
              { _id: "rq-4", itemType: "due_flashcard", topic: "Mutex", title: "Due flashcard: Mutex" },
              { _id: "rq-5", itemType: "overdue_review", topic: "Cache", title: "Overdue flashcard: Cache" },
            ])
          )
        ),
    });

    await renderPage();

    expect(await screen.findByText("Deadlock")).toBeTruthy();
    // These are already represented by the due-cards and weak-topics sections, or
    // by Flashcards.tsx. Listing them again would give the learner two homes for
    // the same work.
    expect(screen.queryByText("Paging")).toBeNull();
    expect(screen.queryByText("TCP")).toBeNull();
    expect(screen.queryByText("Mutex")).toBeNull();
    expect(screen.queryByText("Cache")).toBeNull();
    expect(screen.getByText("1 queued")).toBeTruthy();
  });
});

describe("empty and failure are different states", () => {
  it("shows an empty state for zero failed questions", async () => {
    mockSources({ queue: () => Promise.resolve(ok(queueOf([]))) });

    await renderPage();

    expect(await screen.findByText(/no failed questions queued/i)).toBeTruthy();
  });

  it("does not imply the rest of the review is finished", async () => {
    mockSources({ queue: () => Promise.resolve(ok(queueOf([]))) });

    await renderPage();

    // Cards and topics are separate work; an empty queue says nothing about them.
    expect(await screen.findByText(/separate from the cards and topics/i)).toBeTruthy();
  });

  it("shows a request failure rather than an empty backlog", async () => {
    mockSources({ queue: () => Promise.reject(new Error("network")) });

    await renderPage();

    // Collapsing this into an empty array would claim the learner has nothing
    // outstanding, which is exactly what a failed request cannot establish.
    expect(await screen.findByText(/could not load your failed questions/i)).toBeTruthy();
    expect(screen.queryByText(/no failed questions queued/i)).toBeNull();
  });
});

describe("this source is independent of the other two", () => {
  it("keeps the due-cards section working when the queue fails", async () => {
    mockSources({ queue: () => Promise.reject(new Error("network")) });

    await renderPage();

    expect(await screen.findByText(/could not load your failed questions/i)).toBeTruthy();
    // The Start Review CTA is the Task 22 section and must be unaffected.
    // Split across nodes: the icon is a sibling of the text.
    expect(await screen.findByText(/nothing due right now/i)).toBeTruthy();
  });

  it("keeps weak topics working when the queue fails", async () => {
    mockSources({
      weak: { weakTopics: [{ topic: "Virtual Memory", weaknessScore: 61 }] },
      queue: () => Promise.reject(new Error("network")),
    });

    await renderPage();

    expect(await screen.findByText(/could not load your failed questions/i)).toBeTruthy();
    expect(await screen.findByText("Virtual Memory")).toBeTruthy();
  });

  it("leaves the due-review CTA alone when the queue loads successfully", async () => {
    // The CTA is offered only when something is due, so this needs a real card.
    mockSources({
      due: {
        cards: [{ setId: "set-a", setTitle: "Deck A", nextReviewAt: "2026-01-01T00:00:00Z", card: { _id: "c1", topic: "Mutex" } }],
        dueCount: 1,
      },
    });

    await renderPage();
    await screen.findByText("Deadlock");

    // Nothing about adding a third section may disturb the Task 22 behaviour.
    fireEvent.click(screen.getByRole("button", { name: /start review/i }));
    expect(navigate).toHaveBeenCalledWith("/flashcards?due=1");
  });
});

describe("completing an item", () => {
  it("calls the existing completion endpoint with the item id", async () => {
    await renderPage();
    const item = await findItem("Deadlock");

    fireEvent.click(within(item).getByRole("button", { name: /complete/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/complete"));
      expect(call?.[0]).toBe("/review-queue/rq-1/complete");
      expect((call?.[1] as { method: string }).method).toBe("POST");
    });
  });

  it("removes the item from the visible backlog", async () => {
    await renderPage();
    const item = await findItem("Deadlock");

    fireEvent.click(within(item).getByRole("button", { name: /complete/i }));

    // Completion is a server-side removal, so the local list has to follow it.
    await waitFor(() => expect(screen.queryByText("Deadlock")).toBeNull());
  });

  it("keeps the item when the server refuses", async () => {
    apiFetch.mockImplementation((url: string) =>
      String(url).includes("/complete")
        ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) })
        : Promise.resolve(ok(queueOf([failedQuestion()])))
    );

    await renderPage();
    const item = await findItem("Deadlock");
    fireEvent.click(within(item).getByRole("button", { name: /complete/i }));

    // Removing an item the server did not complete would tell the learner it is
    // done when it is not.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(await screen.findByText("Deadlock")).toBeTruthy();
  });
});

describe("snoozing an item", () => {
  it("calls the existing snooze endpoint with the production body", async () => {
    await renderPage();
    const item = await findItem("Deadlock");

    fireEvent.click(within(item).getByRole("button", { name: /snooze/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url]) => String(url).includes("/snooze"));
      expect(call?.[0]).toBe("/review-queue/rq-1/snooze");
      // The schema takes a positive `hours`; the service defaults to 24.
      expect(JSON.parse(String((call?.[1] as { body: string }).body))).toEqual({ hours: 24 });
    });
  });

  it("presents the item as snoozed afterwards", async () => {
    await renderPage();
    const item = await findItem("Deadlock");

    fireEvent.click(within(item).getByRole("button", { name: /snooze/i }));

    // The returned dueAt is used, not a locally guessed one.
    expect(await screen.findByText(/snoozed until/i)).toBeTruthy();
  });

  it("does not offer actions on an item that is already snoozed", async () => {
    mockSources({ queue: () => Promise.resolve(ok(queueOf([failedQuestion({ dueAt: futureDate() })]))) });

    await renderPage();
    const item = await findItem("Deadlock");

    // Snoozing moves `dueAt` but leaves the item open, so a future date is the
    // only signal — and the item is not actionable today.
    expect(within(item).getByRole("button", { name: /complete/i })).toBeDisabled();
    expect(within(item).getByRole("button", { name: /snooze/i })).toBeDisabled();
  });

  it("never describes a snoozed item as completed", async () => {
    mockSources({ queue: () => Promise.resolve(ok(queueOf([failedQuestion({ dueAt: futureDate() })]))) });

    await renderPage();

    // The queue returns snoozed items in the same list as actionable ones, and
    // `status` is always "open" here, so the copy has to carry the distinction.
    expect(await screen.findByText(/snoozed until/i)).toBeTruthy();
    expect(screen.queryByText(/completed/i)).toBeNull();
  });
});

describe("the fetch matches the production contract", () => {
  it("asks for the largest page the endpoint accepts", async () => {
    await renderPage();

    const call = apiFetch.mock.calls.find(([url]) => String(url).startsWith("/review-queue?"));
    // `listReviewQueue` clamps to 100.
    expect(call?.[0]).toBe("/review-queue?limit=100");
  });

  it("does not claim completeness when more items are queued than were returned", async () => {
    mockSources({ queue: () => Promise.resolve(ok(queueOf([failedQuestion()], 240))) });

    await renderPage();

    // Silently presenting one page as the whole backlog would be a quiet lie.
    expect(await screen.findByText(/showing 1 of 240 queued items/i)).toBeTruthy();
  });
});
