/**
 * Branding consistency — no emoji, one logo identity
 * =================================================
 *
 * The browser tab icon was an inline SVG whose only content was a graduation-cap
 * *emoji*, and several surfaces used emoji glyphs for subject and status icons. The
 * app already had a coherent visual language — a rounded tile carrying a Lucide
 * `graduation-cap` in the brand gradient — so the fix was to bring the outliers in
 * line rather than to invent a second identity.
 *
 * Two things are guarded here:
 *
 *   1. The surfaces themselves render Lucide icons, not emoji.
 *   2. `index.html` and `public/favicon.svg` describe that same mark, so the tab
 *      cannot drift away from the sidebar and auth page again.
 *
 * The last test is a repository-wide scan, because an emoji is easy to reintroduce
 * in a surface no test renders.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  NavLink: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useLocation: () => ({ pathname: "/" }),
}));

// The sidebar reads topic mastery on mount.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ topics: [], accuracy: 0 }),
  }),
}));

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

import CreateAssessment from "@/pages/CreateAssessment";

const readRepoFile = async (relative: string) => {
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  return readFileSync(join(process.cwd(), relative), "utf8");
};

describe("subject and feature cards use Lucide icons, not emoji", () => {
  it("renders all three upload-page cards with their headings", () => {
    render(<CreateAssessment />);

    expect(screen.getByText("PDF Analysis")).toBeInTheDocument();
    expect(screen.getByText("AI Generation")).toBeInTheDocument();
    expect(screen.getByText("With Explanations")).toBeInTheDocument();
  });

  it("gives each card its own icon rather than one generic glyph", () => {
    render(<CreateAssessment />);

    // Scoped to the three cards. The page renders other Lucide icons elsewhere, and
    // comparing every icon on the page would assert something the page never claimed.
    const cardIcons = ["PDF Analysis", "AI Generation", "With Explanations"].map(
      (heading) => {
        const card = screen.getByText(heading).closest("div");
        const icon = card?.parentElement?.querySelector("svg.lucide");
        expect(icon, `${heading} should render a Lucide icon`).not.toBeNull();
        return icon?.innerHTML ?? "";
      },
    );

    expect(new Set(cardIcons).size).toBe(3);
  });

  it("renders no emoji in the card copy", () => {
    const { container } = render(<CreateAssessment />);
    expect(container.textContent ?? "").not.toMatch(
      /\p{Extended_Pictographic}/u,
    );
  });
});

describe("the brand mark is the blue Athenaeum treatment", () => {
  /**
   * Asserted against the sidebar and auth sources rather than their rendered DOM:
   * `AppSidebar` sits inside Radix sheet/tooltip context that jsdom does not
   * provide, so mounting it here would test the harness, not the branding. These
   * blocks are static, so reading them is a faithful check that every brand
   * surface uses the same mark.
   */
  it("the sidebar renders the graduation-cap mark on the gradient tile", async () => {
    const sidebar = await readRepoFile("src/components/AppSidebar.tsx");

    expect(sidebar).toContain("bg-gradient-gold");
    // Matched loosely: the icon className is composed with `cn` and varies between
    // the collapsed and expanded tile sizes, so assert the mark and its colour
    // treatment rather than one exact string.
    expect(sidebar).toMatch(/<GraduationCap[\s\S]{0,120}text-primary-foreground/);
  });

  it("the auth page uses the same mark at both breakpoints", async () => {
    const auth = await readRepoFile("src/pages/Auth.tsx");

    // Desktop hero and the mobile header, so neither drifts.
    expect(auth.match(/<GraduationCap/g)?.length).toBe(2);
    expect(auth).toContain("bg-accent/15");
  });

  it("the favicon is that same mark, not an emoji", async () => {
    const favicon = await readRepoFile("public/favicon.svg");

    // The glyph is the Lucide graduation-cap path, on the brand gradient.
    expect(favicon).toContain("graduation-cap");
    expect(favicon).toContain("#55A6F6");
    expect(favicon).toContain("#306EE8");
    expect(favicon).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("index.html references the favicon file instead of an inline emoji", async () => {
    const html = await readRepoFile("index.html");

    expect(html).toContain('href="/favicon.svg"');
    expect(html).not.toContain("data:image/svg+xml");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("the favicon bakes the two stops of the app's brand gradient", async () => {
    const favicon = await readRepoFile("public/favicon.svg");
    expect(favicon).toMatch(/#55A6F6[\s\S]*#306EE8/);
  });
});

describe("no emoji remains in user-facing frontend source", () => {
  /**
   * Scans the shipped surface rather than rendered output, because emoji most often
   * hide in states no test exercises: empty lists, error branches, tooltips.
   *
   * Backend logs and archived documentation are deliberately out of scope — they are
   * not part of the product a learner sees.
   */
  it("finds no emoji under src/ (excluding tests) or in index.html", async () => {
    const { readFileSync, readdirSync, statSync } = await import("fs");
    const { join } = await import("path");

    const emoji = /\p{Extended_Pictographic}/u;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "test") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (
          /\.(ts|tsx)$/.test(entry) &&
          emoji.test(readFileSync(full, "utf8"))
        ) {
          offenders.push(full.replace(process.cwd(), ""));
        }
      }
    };

    walk(join(process.cwd(), "src"));

    if (emoji.test(readFileSync(join(process.cwd(), "index.html"), "utf8"))) {
      offenders.push("index.html");
    }

    expect(offenders).toEqual([]);
  });
});
