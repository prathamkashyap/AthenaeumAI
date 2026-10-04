/**
 * AI model attribution in the UI
 * =============================
 *
 * The interface credited a specific model name — "Powered by Llama 3 70B via
 * Groq" — while the backend selects its model from `GROQ_MODEL`. When Groq
 * retired `llama-3.3-70b-versatile`, every AI feature moved to a different model
 * and the UI kept naming the old one. Nothing about the UI should depend on which
 * model is configured: a model change is a deployment variable, not a copy change.
 *
 * So the copy names the *provider* rather than the model, and the last test guards
 * that decision by scanning the source. A future model swap should not require a
 * frontend change, and if one does happen, the failure should be a failing test
 * rather than a stale claim in front of a learner.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

// The dashboard is the first component covered here that reads auth state, and it
// renders the learner's name in its greeting.
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { _id: "u1", name: "Ada Lovelace" } }),
}));

vi.mock("@/context/QuizContext", () => ({
  useQuiz: () => ({
    currentQuiz: null,
    backgroundProcessing: null,
    isGenerating: false,
    generationProgress: "",
    error: null,
    generateQuiz: vi.fn(),
    clearError: vi.fn(),
  }),
}));

import Dashboard from "@/pages/Dashboard";
import CreateAssessment from "@/pages/CreateAssessment";

describe("AI attribution in the dashboard", () => {
  it("credits the provider rather than a specific model", () => {
    render(<Dashboard />);

    expect(screen.getByText(/powered by groq/i)).toBeInTheDocument();
  });

  it("does not name a model that is no longer served", () => {
    const { container } = render(<Dashboard />);

    expect(container.textContent).not.toMatch(/llama/i);
    expect(container.textContent).not.toMatch(/\b70b\b/i);
  });
});

describe("AI attribution on the upload page", () => {
  it("describes generation without naming a model", () => {
    render(<CreateAssessment />);

    expect(screen.getByText(/groq-powered ai/i)).toBeInTheDocument();
    expect(screen.getByText(/questions crafted by/i)).toBeInTheDocument();
  });

  it("does not name a model that is no longer served", () => {
    const { container } = render(<CreateAssessment />);

    expect(container.textContent).not.toMatch(/llama/i);
  });
});

describe("no user-facing model name is hard-coded into the UI", () => {
  /**
   * The regression guard. The copy above is model-agnostic by choice, and this
   * asserts that stays true across the whole component tree rather than in the two
   * strings this change happened to touch.
   *
   * Reads the source rather than the DOM because a string can be present in a
   * branch that no test renders.
   */
  it("finds no model identifiers anywhere under src/", async () => {
    const { readFileSync, readdirSync, statSync } = await import("fs");
    const { join } = await import("path");

    // Vitest does not give `import.meta.url` a real filesystem path, so anchor on
    // the project root, which is where `npm test` runs from.
    const srcDir = join(process.cwd(), "src");
    const retired = /llama|gpt-oss|\b70b\b|\b70B\b/;

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "test") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && retired.test(readFileSync(full, "utf8"))) {
          offenders.push(full.replace(srcDir, ""));
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
