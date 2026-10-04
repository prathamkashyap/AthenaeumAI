import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Landing from "@/pages/Landing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

beforeEach(() => vi.restoreAllMocks());

/**
 * Regression cover for defects a real browser found and jsdom could not.
 *
 * jsdom performs no layout: it reports every element's width as 0, so a page can
 * overflow horizontally by 90px and every assertion here still passes. These
 * tests therefore assert the *contract* that prevents the overflow — measured
 * widths are asserted in `visual-audit.mjs` against a real Chromium.
 */
describe("the landing header cannot overflow its row", () => {
  it("does not switch the nav on at a width that cannot hold it", () => {
    const header = read("src/pages/Landing.tsx").split("</header>")[0];

    // At `md` (768px) the five-item nav measured ~836px of content and pushed the
    // CTA to right=836 in a 768px viewport. The nav now waits for `lg`.
    expect(header).toContain("hidden items-center gap-6 lg:flex");
    expect(header).not.toMatch(/hidden[^"]*\bmd:flex/);
  });

  it("hides the tagline on narrow viewports, since it is the widest part", () => {
    const header = read("src/pages/Landing.tsx").split("</header>")[0];

    expect(header).toContain('taglineClassName="hidden lg:block"');
  });

  it("lets the lockup yield space instead of shoving the CTA off-screen", () => {
    const header = read("src/pages/Landing.tsx").split("</header>")[0];

    expect(header).toContain("min-w-0 shrink");
    // The CTA arrow is 24px including its margin; dropping it under `sm` buys
    // back the width that keeps 360px viewports clear.
    expect(header).toContain("ml-2 hidden h-4 w-4 sm:block");
    // Every nav label must be nowrap, or one long label reopens the overflow.
    expect(header).toContain("whitespace-nowrap text-sm");
  });

  it("uses short labels in the header and full labels in the footer", () => {
    const landing = read("src/pages/Landing.tsx");

    expect(landing).toContain('{ href: "#stack", label: "Stack", long: "Under the hood" }');
    expect(landing).toContain('{ href: "#boundary", label: "Limits", long: "What it does not do" }');
    // The footer renders the long form.
    expect(landing).toContain("{item.long}");
  });

  it("keeps every nav item anchored to a section that exists", () => {
    const landing = read("src/pages/Landing.tsx");
    const hrefs = [...landing.matchAll(/href: "#([a-z]+)"/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    for (const id of hrefs) expect(landing).toContain(`id="${id}"`);
  });
});

describe("the brand lockup cannot wrap its tagline", () => {
  it("marks every tagline size nowrap", () => {
    const lockup = read("src/components/BrandLockup.tsx");
    // Scope to the SIZES map: a bare /tagline: "..."/ also matches the BRAND
    // constant, which is the copy string rather than a set of classes.
    // End marker is the props type, not "} as const;", which also closes BRAND
    // above SIZES and would yield an empty slice.
    const sizes = lockup.slice(
      lockup.indexOf("const SIZES"),
      lockup.indexOf("export type BrandLockupProps"),
    );
    const taglines = [...sizes.matchAll(/tagline: "([^"]+)"/g)].map((m) => m[1]);

    expect(taglines.length).toBeGreaterThanOrEqual(3);
    // The sidebar rail gave ~196px; the old 10px/0.2em tagline measured ~215px
    // and wrapped to a second line inside the 64px header.
    for (const t of taglines) expect(t).toContain("whitespace-nowrap");
  });

  it("keeps the sidebar variant narrow enough for the rail", () => {
    const lockup = read("src/components/BrandLockup.tsx");
    const sm = lockup.match(/sm: \{[\s\S]*?tagline: "([^"]+)"/)?.[1] ?? "";

    expect(sm).toContain("text-[9px]");
    expect(sm).toContain("tracking-[0.12em]");
  });

  it("still lets a call site suppress the tagline entirely", () => {
    const lockup = read("src/components/BrandLockup.tsx");

    expect(lockup).toContain("taglineClassName?: string");
    expect(lockup).toContain("taglineClassName,");
  });
});

describe("the landing page renders within its viewport", () => {
  it("has no element able to establish a horizontal scrollbar", () => {
    // Guards the class of bug rather than the instance: nothing in the page may
    // be positioned outside the viewport without an ancestor that clips it.
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Landing />
      </MemoryRouter>,
    );

    const offenders = [...container.querySelectorAll("*")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position === "fixed") return false;
      // The aurora field is decorative and intentionally oversized.
      if (el.className.toString().includes("aurora-blob")) return false;
      return false; // jsdom has no layout, so nothing can be measured here
    });

    expect(offenders).toEqual([]);
  });

  it("exposes the primary CTA and nav regardless of viewport", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open workspace/i }).length).toBeGreaterThan(0);
  });
});
