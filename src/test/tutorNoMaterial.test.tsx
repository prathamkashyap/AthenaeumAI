/**
 * Tutor — a failed material lookup is not an empty library
 * ======================================================
 *
 * The tutor answers from the learner's own indexed material, so whether any
 * exists is a precondition rather than a detail. It fetched `/library` into
 * `materials` and collapsed a failure into `[]`, and the question input was
 * gated only on the input being non-empty. A brand-new learner therefore saw a
 * fully functional tutor, asked a question, and met the grounding refusal with
 * no indication that the real prerequisite was missing material.
 *
 * These tests pin three things: the failure is reported as a failure, a
 * confirmed-empty library states the prerequisite and offers the step that
 * satisfies it, and the ordinary grounded path is untouched when material
 * exists — including the existing refusal contract, which must not change.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

// The tutor page pulls in the full sidebar shell, which is not what is under test.
vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

import Tutor from "@/pages/Tutor";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const material = { _id: "mat-1", title: "OS Notes" };

const renderPage = async () => {
  // A real MemoryRouter so the CTA renders a genuine anchor with a real href.
  const view = render(
    <MemoryRouter>
      <Tutor />
    </MemoryRouter>
  );
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  return view;
};

const ask = (question: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /ask/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a failed material lookup", () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/library") return Promise.reject(new Error("network down"));
      return Promise.resolve(ok({ answer: "unused" }));
    });
  });

  it("is reported as a failure rather than as having no material", async () => {
    await renderPage();

    // Claiming an empty library here would send the learner to re-upload
    // material they may already have indexed.
    expect(await screen.findByText(/couldn't check your library/i)).toBeTruthy();
    expect(screen.queryByText(/add material before asking/i)).toBeNull();
  });

  it("does not blame the learner's library", async () => {
    await renderPage();

    // Nothing was deleted; the page simply does not know.
    expect(await screen.findByText(/nothing is missing from your library/i)).toBeTruthy();
  });

  it("does not present the question box as though asking could work", async () => {
    await renderPage();

    await screen.findByText(/couldn't check your library/i);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("a confirmed empty library", () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/library") return Promise.resolve(ok({ materials: [] }));
      return Promise.resolve(ok({ answer: "unused" }));
    });
  });

  it("states the prerequisite before the learner asks", async () => {
    await renderPage();

    // Previously nothing said this. The learner found out by being refused.
    expect(await screen.findByText(/add material before asking/i)).toBeTruthy();
  });

  it("explains why the tutor cannot answer yet", async () => {
    await renderPage();

    expect(await screen.findByText(/answers from your indexed study materials/i)).toBeTruthy();
  });

  it("offers a route to add material", async () => {
    await renderPage();

    const cta = await screen.findByRole("link", { name: /add material/i });
    // Reuses the existing ingestion route; no new page or endpoint.
    expect(cta.getAttribute("href")).toBe("/assessments/create");
  });

  it("does not offer a material selector over an empty library", async () => {
    await renderPage();

    await screen.findByText(/add material before asking/i);
    // A selector reading "All indexed materials" would assert a library that is
    // not there.
    expect(screen.queryByText(/all indexed materials/i)).toBeNull();
  });
});

describe("while the library lookup is still in flight", () => {
  it("does not render the question box", async () => {
    // Never settles. This isolates the loading state from both the empty and
    // the resolved branches.
    apiFetch.mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter>
        <Tutor />
      </MemoryRouter>
    );

    // The tutor cannot yet say whether it has material to ground an answer in,
    // so offering the box would let a fast learner submit a question whose only
    // possible outcome is a refusal.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a loading indicator rather than a blank page", async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <MemoryRouter>
        <Tutor />
      </MemoryRouter>
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    // Withholding the interaction must not leave nothing at all on screen.
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the question box once the library resolves with material", async () => {
    // The counterpart, so the fix cannot be satisfied by never rendering it.
    apiFetch.mockImplementation((url: string) => {
      if (url === "/library") return Promise.resolve(ok({ materials: [material] }));
      return Promise.resolve(ok({ answer: "unused" }));
    });

    await renderPage();

    expect(await screen.findByRole("textbox")).toBeTruthy();
  });
});

describe("when material exists, nothing changes", () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/library") return Promise.resolve(ok({ materials: [material] }));
      if (url === "/tutor/ask") {
        return Promise.resolve(ok({
          answer: "Deadlock requires all four conditions at once.",
          groundedSources: [{ sourceNumber: 1, sourceTitle: "OS Notes", whyRelevant: "States them." }],
          grounding: { grounded: true },
        }));
      }
      return Promise.resolve(ok({}));
    });
  });

  it("offers the normal question box", async () => {
    await renderPage();

    expect(await screen.findByRole("textbox")).toBeTruthy();
    expect(screen.queryByText(/add material before asking/i)).toBeNull();
  });

  it("offers the material selector", async () => {
    await renderPage();

    // Asserted by role: the phrase appears in both the trigger and the dropdown
    // item, so matching the text would find two nodes and prove nothing.
    expect(await screen.findByRole("combobox")).toBeTruthy();
  });

  it("still answers a question", async () => {
    await renderPage();
    await screen.findByRole("textbox");

    ask("What are the deadlock conditions?");

    expect(
      await screen.findByText(/deadlock requires all four conditions/i)
    ).toBeTruthy();
  });

  it("preserves the grounded badge for a grounded answer", async () => {
    await renderPage();
    await screen.findByRole("textbox");

    ask("What are the deadlock conditions?");

    // The Task 17/18 grounding contract must be unaffected by this change.
    expect(await screen.findByText(/based on your uploaded material/i)).toBeTruthy();
  });

  it("still shows the refusal state when nothing supports an answer", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/library") return Promise.resolve(ok({ materials: [material] }));
      if (url === "/tutor/ask") {
        return Promise.resolve(ok({
          answer: "I could not find support for that.",
          groundedSources: [],
          grounding: { grounded: false },
        }));
      }
      return Promise.resolve(ok({}));
    });

    await renderPage();
    await screen.findByRole("textbox");

    ask("Something unrelated to the material?");

    // Unchanged behaviour: the learner is told the material does not support it.
    expect(await screen.findByText(/no supporting material found/i)).toBeTruthy();
  });
});
