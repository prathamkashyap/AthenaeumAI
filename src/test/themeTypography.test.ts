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

  // These definitions moved out of ThemeToggle into src/lib/theme.ts so that
  // main.tsx can apply the stored theme at boot. Without that move the public
  // landing page and auth screen ignored the preference entirely, because the
  // toggle is only mounted inside the authenticated AppLayout. The assertions
  // follow the definitions rather than the component that renders the button.
  it("the toggle offers exactly two modes", () => {
    const theme = read("src/lib/theme.ts");

    expect(theme).toContain('type Theme = "starry" | "light";');
    expect(theme).toContain('THEME_ORDER: Theme[] = ["starry", "light"];');
    expect(theme).not.toContain('"academia"]');
  });

  it("a stale stored theme resolves to a real one", () => {
    const theme = read("src/lib/theme.ts");

    // Persistence outlives the code that wrote it, so the read path must normalise.
    expect(theme).toContain("export function normaliseTheme");
    expect(theme).toMatch(/normaliseTheme\(raw\)/);
  });

  it("still clears a stale theme-academia class from the DOM", () => {
    const theme = read("src/lib/theme.ts");

    // Defensive: a cached page may still carry the class until it is applied.
    expect(theme).toContain('root.classList.remove(LIGHT_CLASS, "theme-academia")');
  });

  it("keeps exactly one definition of the theme, shared by boot and toggle", () => {
    const toggle = read("src/components/ThemeToggle.tsx");
    const boot = read("src/main.tsx");

    // The toggle must not redeclare the key, the order or the normalisation.
    expect(toggle).not.toContain('athenaeum-theme');
    expect(toggle).not.toMatch(/const ORDER/);
    expect(toggle).not.toMatch(/classList/);
    // ...and boot must go through the shared module, not a private copy.
    expect(boot).toContain('from "./lib/theme"');
    expect(boot).toContain("initTheme()");
    // Applied before render, not in an effect, so there is no default-theme flash.
    // Match the calls, not the identifiers: both names also appear in the imports
    // at the top of the file, where `createRoot` sorts first.
    expect(boot.indexOf("initTheme();")).toBeGreaterThan(-1);
    expect(boot.indexOf("initTheme();")).toBeLessThan(boot.indexOf("createRoot(document"));
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
