/**
 * Theme system and typography
 * ===========================
 *
 * Two defects this pins down:
 *
 * 1. **The gold theme is gone.** A third "Academia" theme (brown/gold) shipped
 *    alongside Blue Aurora and Light, so the product could present as brown while
 *    its own accents stayed blue. Only two coherent modes remain. Because the
 *    choice is persisted in localStorage, a browser still holding `"academia"`
 *    must resolve to a real theme rather than loading unthemed.
 *
 * 2. **Instrument Serif is actually used.** It was imported by `index.css` but
 *    `.font-serif` resolved to Inter in *both* `index.css` and
 *    `tailwind.config.ts`, so every `font-serif` in the JSX silently rendered as
 *    body text and the display face was never seen. Serif is now opt-in on
 *    purpose: headings stay Inter, because a serif on every h1–h4 made dense
 *    pages read like prose.
 *
 * Read against source rather than computed style, because these are theme tokens
 * and Tailwind config values whose whole point is what they resolve to.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

describe("only two themes ship", () => {
  it("the Academia gold theme is removed from the stylesheet", () => {
    const css = read("src/index.css");
    expect(css).not.toContain(".theme-academia");
  });

  it("no gold tokens remain in the stylesheet", () => {
    const css = read("src/index.css");

    // The brown/gold hue family is 20–45. Any survivor is the old theme leaking.
    const goldTokens = css.match(/--(?:primary|accent|ring|sidebar-primary):\s*3[0-9]\s/g);
    expect(goldTokens ?? []).toEqual([]);
  });

  it("the toggle offers exactly two modes", () => {
    const toggle = read("src/components/ThemeToggle.tsx");

    expect(toggle).toContain('type Theme = "starry" | "light";');
    expect(toggle).toContain('const ORDER: Theme[] = ["starry", "light"];');
    expect(toggle).not.toContain('"academia"]');
  });

  it("a stale stored theme resolves to a real one", () => {
    const toggle = read("src/components/ThemeToggle.tsx");

    // Persistence outlives the code that wrote it, so the read path must normalise.
    expect(toggle).toContain("const normalise");
    expect(toggle).toMatch(/normalise\(localStorage\.getItem\(KEY\)\)/);
  });

  it("still clears a stale theme-academia class from the DOM", () => {
    const toggle = read("src/components/ThemeToggle.tsx");

    // Defensive: a cached page may still carry the class until it is applied.
    expect(toggle).toContain('root.classList.remove("theme-light", "theme-academia")');
  });
});

describe("typography actually uses the imported faces", () => {
  it("the Tailwind serif family is Instrument Serif, not Inter", () => {
    const config = read("tailwind.config.ts");

    expect(config).toMatch(/serif:\s*\[\s*'Instrument Serif'/);
    expect(config).not.toMatch(/serif:\s*\[\s*'Inter'/);
  });

  it("the stylesheet maps .font-serif to Instrument Serif", () => {
    const css = read("src/index.css");

    expect(css).toMatch(/\.font-serif\s*\{[^}]*'Instrument Serif'/);
  });

  it("headings deliberately stay on Inter", () => {
    const css = read("src/index.css");

    // Serif on every heading made dense pages look like prose. Serif is opt-in.
    expect(css).toMatch(/h1, h2, h3, h4\s*\{\s*\n?\s*font-family: 'Inter'/);
  });

  it("monospace is reserved for compact numeric metadata", () => {
    const css = read("src/index.css");
    expect(css).toContain("'JetBrains Mono'");
  });

  it("the display faces are actually imported", () => {
    const css = read("src/index.css");

    expect(css).toContain("family=Instrument+Serif");
    expect(css).toContain("family=Inter");
    expect(css).toContain("family=JetBrains+Mono");
  });
});

describe("no hardcoded gold remains in component styling", () => {
  it("finds no gold-hue arbitrary values under src/", () => {
    const offenders: string[] = [];

    for (const file of [
      "src/pages/Dashboard.tsx",
      "src/pages/CreateAssessment.tsx",
      "src/pages/ResultAssessment.tsx",
      "src/pages/AttemptAssessment.tsx",
      "src/pages/Assessments.tsx",
      "src/components/AppLayout.tsx",
      "src/components/AppSidebar.tsx",
    ]) {
      const source = read(file);
      // Tailwind writes arbitrary hsl values with underscores: hsl(38_55%_58%/0.1)
      if (/hsl\(3[0-9]([_ ])[0-9]+%[_ ][0-9]+%/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the brand gradient is named for what it is", () => {
    const css = read("src/index.css");
    const config = read("tailwind.config.ts");

    // `bg-gradient-gold` was always blue: it aliased --gradient-accent. The
    // components now use the honest name.
    expect(css).toContain("--gradient-brand: var(--gradient-accent)");
    expect(config).toContain("'gradient-brand'");
  });
});
