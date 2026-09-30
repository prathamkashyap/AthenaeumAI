/**
 * Tutor page — grounding and citation presentation
 * =================================================
 *
 * The backend distinguishes two outcomes: an answer grounded in the learner's
 * uploaded material, and a refusal because retrieval produced no evidence at all.
 * Before this page knew about that decision it labelled every response "Grounded
 * response", so a refusal was presented as a grounded answer, and it rendered the
 * raw retrieval score as a percentage, which reads as a confidence in the answer
 * that the backend never claimed.
 *
 * These tests drive the real component through the real request path, with only
 * `apiFetch` and the layout shell replaced. Asserting on rendered text and
 * accessible roles rather than class names keeps them about behaviour: a styling
 * change should not be able to make a refusal look grounded, and neither should a
 * copy change make one look ungrounded.
 *
 * `fireEvent` is used rather than `@testing-library/user-event`, which is not a
 * dependency of this project and was not added for a test.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above every top-level binding, so the mock is
// declared here and the test asserts against the hoisted reference. A `const`
// outside the factory would be in the temporal dead zone when the factory runs.
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

// The layout pulls in the auth context, router and sidebar, none of which the
// tutor's grounding behaviour depends on. Replacing the shell keeps the test
// about what this page renders and keeps unrelated components out of it.
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

import Tutor from "@/pages/Tutor";

const GROUNDED = {
  question: "What are the necessary conditions for a deadlock?",
  answer: "Start by asking which of the four conditions could be broken.",
  groundedSources: [
    { sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "States the four conditions." },
  ],
  personalizedNotes: ["This connects to your weak topic Deadlock."],
  revisionPlan: ["Re-read the cited section."],
  suggestedFollowUps: ["Quiz me on deadlock"],
  retrievedContext: [
    {
      sourceNumber: 1,
      sourceTitle: "OS Notes",
      chunkIndex: 2,
      score: 0.4378,
      preview: "A deadlock requires four necessary conditions to hold simultaneously.",
      topics: ["Deadlock"],
    },
    {
      sourceNumber: 2,
      sourceTitle: "OS Notes",
      chunkIndex: 8,
      score: 0.31,
      preview: "Round robin preemptive scheduling gives each ready process a time slice.",
      topics: ["Scheduling"],
    },
  ],
  grounding: {
    grounded: true,
    reason: null,
    evidenceCount: 2,
    consideredCount: 2,
    bestScore: 0.4378,
  },
};

const REFUSED = {
  question: "What are the necessary conditions for a deadlock?",
  answer:
    "I could not find anything in your uploaded material that matches this question, " +
    "so I have not attempted an answer.",
  groundedSources: [],
  personalizedNotes: [],
  revisionPlan: ["Upload or generate material that covers this topic."],
  suggestedFollowUps: ["Which of my materials covers this?"],
  // The backend returns the chunks it weighed so a refusal stays auditable
  // server-side. The page must not present them as sources for an answer.
  retrievedContext: [
    {
      sourceNumber: 1,
      sourceTitle: "Finance Notes",
      chunkIndex: 0,
      score: 0,
      preview: "In retail banking, a banker's algorithm is sometimes used informally.",
      topics: [],
    },
  ],
  grounding: {
    grounded: false,
    reason: "no_lexical_evidence",
    evidenceCount: 0,
    consideredCount: 1,
    bestScore: 0,
  },
};

const ask = async (payload: Record<string, unknown>) => {
  apiFetch.mockImplementation(async (path: string) =>
    path === "/library"
      // At least one indexed material. These tests are about how a grounded
      // answer and a refusal are presented, and the tutor now withholds its
      // question box until the library is known to hold something — an empty
      // library is a separate state covered in tutorNoMaterial.test.tsx. The
      // assertions below are unchanged.
      ? { ok: true, json: async () => ({ materials: [{ _id: "mat-1", title: "OS Notes" }] }) }
      : { ok: true, json: async () => payload },
  );

  render(<Tutor />);
  const box = screen.getByPlaceholderText(/ask about deadlock/i) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: String(payload.question) } });
  fireEvent.click(screen.getByRole("button", { name: /ask tutor/i }));

  await waitFor(() => expect(screen.getByText(String(payload.answer))).toBeInTheDocument());
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("grounded answers", () => {
  it("states that the answer is based on uploaded material", async () => {
    await ask(GROUNDED);

    expect(screen.getByText(/based on your uploaded material/i)).toBeInTheDocument();
    // Announced rather than merely coloured.
    expect(screen.getByRole("status")).toHaveTextContent(/based on your uploaded material/i);
  });

  it("does not claim the material was verified, understood or fully covered", async () => {
    await ask(GROUNDED);

    // The backend establishes evidence presence only. Any of these would be a
    // stronger claim than the contract supports.
    for (const overclaim of [/verif/i, /guarantee/i, /accurate/i, /complete coverage/i, /hallucinat/i]) {
      expect(screen.queryByText(overclaim)).not.toBeInTheDocument();
    }
  });

  it("renders each source with its title, number and section", async () => {
    await ask(GROUNDED);

    const list = screen.getByRole("list", { name: /sources used for this answer/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(within(items[0]).getByText("OS Notes")).toBeInTheDocument();
    expect(within(items[0]).getByLabelText("Source 1")).toHaveTextContent("[1]");
    // The API supplies a chunk index and no location beyond it. "Section 3" is
    // index 2 rendered for a human, not a page number.
    expect(within(items[0]).getByText(/section 3/i)).toBeInTheDocument();
  });

  it("includes the backend's reason for the source without duplicating the list", async () => {
    await ask(GROUNDED);

    expect(screen.getByText(/states the four conditions/i)).toBeInTheDocument();
    // One coherent citation section, not a second competing list of sources.
    expect(screen.getAllByRole("list", { name: /sources used/i })).toHaveLength(1);
  });

  it("never presents the retrieval score as a confidence percentage", async () => {
    await ask(GROUNDED);

    // 0.4378 and 0.31 as percentages would read as 44% and 31%. A learner would
    // take that as the tutor's confidence in the answer, which is a claim the
    // backend never makes and the retrieval evaluation contradicts.
    expect(screen.queryByText("44%")).not.toBeInTheDocument();
    expect(screen.queryByText("31%")).not.toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("keeps the answer, notes, revision plan and follow-ups", async () => {
    await ask(GROUNDED);

    expect(screen.getByText(GROUNDED.answer)).toBeInTheDocument();
    expect(screen.getByText(/personalized notes/i)).toBeInTheDocument();
    expect(screen.getByText(/connects to your weak topic/i)).toBeInTheDocument();
    expect(screen.getByText(/revision plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /quiz me on deadlock/i })).toBeInTheDocument();
  });
});

describe("insufficient context", () => {
  it("shows a refusal state rather than a grounded one", async () => {
    await ask(REFUSED);

    expect(screen.getByText(/no supporting material found/i)).toBeInTheDocument();
    expect(screen.queryByText(/based on your uploaded material/i)).not.toBeInTheDocument();
  });

  it("says the material did not provide evidence and that no answer was attempted", async () => {
    await ask(REFUSED);

    expect(screen.getByText(/did not provide evidence/i)).toBeInTheDocument();
    // Must not imply a generation attempt that never happened.
    expect(screen.getByText(/did not attempt an answer/i)).toBeInTheDocument();
  });

  it("preserves the backend refusal message verbatim", async () => {
    await ask(REFUSED);

    expect(screen.getByText(REFUSED.answer)).toBeInTheDocument();
  });

  it("shows no citations, even though the response carries rejected chunks", async () => {
    await ask(REFUSED);

    // The single most important assertion in this file: rejected chunks must not
    // be presented as sources for an answer that was never produced.
    expect(screen.queryByText("Finance Notes")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /sources used for this answer/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/states the four conditions/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no sources are shown/i)).toBeInTheDocument();
  });

  it("keeps the next actions the backend suggested", async () => {
    await ask(REFUSED);

    expect(screen.getByText(REFUSED.revisionPlan[0])).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: REFUSED.suggestedFollowUps[0] }),
    ).toBeInTheDocument();
  });
});

describe("responses predating the grounding contract", () => {
  it("renders without crashing when grounding is absent", async () => {
    const { grounding, ...legacy } = GROUNDED;
    void grounding;

    await ask(legacy);

    // No decision means no claim either way. Showing the grounded badge would
    // assert a grounding the response never reported, and the refusal badge
    // would accuse the tutor of declining an answer it gave.
    expect(screen.getByText(GROUNDED.answer)).toBeInTheDocument();
    expect(screen.getByText(/grounding not reported/i)).toBeInTheDocument();
    expect(screen.queryByText(/based on your uploaded material/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no supporting material found/i)).not.toBeInTheDocument();
  });

  it("states that grounding was not reported rather than implying anything", async () => {
    const { grounding, ...legacy } = GROUNDED;
    void grounding;

    await ask(legacy);

    // Withheld is not the same as unsupported: the wording must not tell the
    // learner their material failed to support the answer.
    expect(screen.queryByText(/did not provide evidence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no sources are shown/i)).not.toBeInTheDocument();
  });

  it("still lists sources for a legacy response", async () => {
    const { grounding, ...legacy } = GROUNDED;
    void grounding;

    await ask(legacy);

    expect(screen.getByRole("list", { name: /sources used for this answer/i })).toBeInTheDocument();
  });

  it("makes no grounding claim for a malformed grounding object", async () => {
    // `grounded` is a boolean at a runtime boundary, so a payload that reports
    // neither `true` nor `false` carries no decision this client may interpret.
    // Presenting it as grounded would put a "Based on your uploaded material"
    // badge on a response that never reported one.
    await ask({ ...GROUNDED, grounding: { grounded: undefined } });

    expect(screen.getByText(GROUNDED.answer)).toBeInTheDocument();
    expect(screen.queryByText(/no supporting material found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/based on your uploaded material/i)).not.toBeInTheDocument();
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("makes no grounding claim when `grounded` is %s", async (_label, value) => {
    await ask({ ...GROUNDED, grounding: { grounded: value } });

    expect(screen.getByText(GROUNDED.answer)).toBeInTheDocument();
    // Neither claim may be made from a value that is not a boolean decision.
    expect(screen.queryByText(/based on your uploaded material/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no supporting material found/i)).not.toBeInTheDocument();
  });

  it("still lists sources when the grounding decision is unreadable", async () => {
    // Not making a grounding claim is not the same as hiding the answer's own
    // citations. The chunks are still what the backend sent, and the learner
    // still needs to see them to judge the answer.
    await ask({ ...GROUNDED, grounding: { grounded: "yes" } });

    expect(screen.getByRole("list", { name: /sources used for this answer/i })).toBeInTheDocument();
  });
});
