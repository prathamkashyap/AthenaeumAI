import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Landing from "@/pages/Landing";
import {
  AI_BOUNDARY,
  CAPABILITIES,
  FAQ,
  LEARNING_LOOP,
  PROOF,
  STACK,
} from "@/lib/landingCopy";

const authState = {
  isAuthenticated: false,
  isLoading: false,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  user: null,
  token: null,
};

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));

beforeEach(() => {
  authState.isAuthenticated = false;
  authState.isLoading = false;
});

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("the landing page states the real loop", () => {
  it("presents all five stages, in order, each naming its backing surface", () => {
    renderLanding();

    const stages = LEARNING_LOOP.map((s) => s.title);
    expect(stages).toHaveLength(5);

    for (const stage of LEARNING_LOOP) {
      expect(screen.getByRole("heading", { name: stage.title })).toBeInTheDocument();
      // The backing reference is the part that keeps the claim honest, so it
      // has to actually render rather than sit unused in the copy module.
      expect(screen.getByText(stage.backing)).toBeInTheDocument();
    }

    expect(LEARNING_LOOP.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it("closes the loop instead of implying a sixth step", () => {
    renderLanding();
    expect(screen.getByText(/And then it repeats/i)).toBeInTheDocument();
  });
});

describe("the claims on the page are ones the product can back", () => {
  it("pairs every capability with a does / does-not boundary", () => {
    renderLanding();

    for (const cap of CAPABILITIES) {
      expect(screen.getByRole("heading", { name: cap.title })).toBeInTheDocument();
    }
    // The boundary section is the reason this page is trustworthy: it states
    // limits rather than waiting to be asked.
    expect(AI_BOUNDARY.length).toBeGreaterThan(0);
    for (const row of AI_BOUNDARY) {
      expect(row.does).toMatch(/\.$/);
      expect(row.doesNot).toMatch(/\.$/);
    }
    expect(screen.getByRole("heading", { name: /What it does, and what it does not/i }))
      .toBeInTheDocument();
  });

  it("states the free-tier arrangement rather than implying a paid plan", () => {
    renderLanding();
    expect(STACK.some((s) => /free|m0|groq/i.test(s.value + s.why))).toBe(true);
    expect(screen.getByText(/Free tiers only/i)).toBeInTheDocument();
  });

  it("names the workspace surfaces exactly as the sidebar does", () => {
    renderLanding();
    // Truthfulness again: these must be the real nav names, not marketing ones.
    for (const surface of ["Library", "Assessments", "Practice", "Review", "Analytics", "Tutor"]) {
      expect(screen.getAllByText(surface).length).toBeGreaterThan(0);
    }
  });

  it("never names a specific model", () => {
    // Same rule the dashboard copy follows: the provider is credited, the model
    // is environment-configured, so it must not appear in public copy.
    const { container } = renderLanding();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Groq/);
    expect(text).not.toMatch(/gpt-oss/i);
    expect(text).not.toMatch(/llama/i);
  });

  it("uses no emoji anywhere on the page", () => {
    const { container } = renderLanding();
    // A property escape rather than a literal range: a character class spanning
    // the variation-selector block is a "misleading character class", because
    // U+FE0F is a combining mark rather than a pictograph in its own right.
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("verification numbers are rendered", () => {
  it("shows the suite counts rather than adjectives", () => {
    renderLanding();

    for (const value of [
      PROOF.backendUnit,
      PROOF.backendIntegration,
      PROOF.frontend,
      PROOF.endToEnd,
    ]) {
      expect(screen.getByText(String(value))).toBeInTheDocument();
    }
  });
});

describe("a signed-in member never sees the marketing page", () => {
  it("redirects to the dashboard once the token is known", () => {
    authState.isAuthenticated = true;
    renderLanding();

    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Turn a syllabus/i })).not.toBeInTheDocument();
  });

  it("shows neither page while the token is still being read", () => {
    // Otherwise a refresh paints the marketing page at someone already signed in.
    authState.isLoading = true;
    const { container } = renderLanding();

    expect(container.textContent).not.toContain("Turn a syllabus");
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });
});

describe("the page is navigable and accessible", () => {
  it("offers a skip link before the header navigation", () => {
    renderLanding();
    expect(screen.getByRole("link", { name: /skip to content/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("has a labelled primary nav and a single obvious way in", () => {
    renderLanding();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    const ctas = screen.getAllByRole("link", { name: /open (the )?workspace|start with your material/i });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) expect(cta).toHaveAttribute("href", "/auth");
  });

  it("answers the FAQ in an accessible accordion", () => {
    renderLanding();
    for (const entry of FAQ) {
      const trigger = screen.getByRole("button", { name: entry.question });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("keeps each section reachable by its in-page anchor", () => {
    renderLanding();
    for (const id of ["loop", "capabilities", "stack", "boundary", "faq"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("contains no nested anchors", () => {
    // An <a> inside an <a> is invalid HTML and browsers silently break the
    // inner link's navigation. It got introduced here by a careless string
    // replace and no existing assertion caught it, so it is asserted directly.
    const { container } = renderLanding();
    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });

  it("gives the page exactly one h1", () => {
    const { container } = renderLanding();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("closes with a working entry point into the product", () => {
    const { container } = renderLanding();
    const footer = within(container.querySelector("footer") as HTMLElement);

    expect(footer.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });
});
