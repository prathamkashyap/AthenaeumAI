import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND } from "@/components/BrandLockup";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Source with comments removed. Several of these files carry a comment explaining
 * the code they replaced ("was a raw <a href="/">"), and a naive grep cannot tell
 * that apart from still doing the thing.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every .tsx under src that renders chrome a visitor could see. */
const chromeFiles = [
  "src/components/AppSidebar.tsx",
  "src/components/AppLayout.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Landing.tsx",
  "src/pages/NotFound.tsx",
  "src/pages/Dashboard.tsx",
];

describe("the brand is defined once", () => {
  it("exposes a wordmark, a full name and a single tagline", () => {
    expect(BRAND.wordmark).toBe("Athenaeum");
    expect(BRAND.fullName).toBe("Athenaeum AI");
    expect(BRAND.tagline).toBe("Intelligent Learning System");
  });

  it("has no chrome file hardcoding a name or tagline any more", () => {
    const offenders: string[] = [];

    for (const file of chromeFiles) {
      const source = code(file);
      // The mark itself now lives in BrandLockup. A literal here means someone
      // re-invented a lockup, which is exactly how the three copies drifted.
      if (/Athenaeum\s*(AI)?\s*<\/|["']Athenaeum/.test(source)) offenders.push(`${file}: name`);
      if (/Intelligent Learning|Learning OS|Learning System/.test(source)) {
        offenders.push(`${file}: tagline`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("reuses BrandLockup in the three places that used to re-implement it", () => {
    expect(read("src/components/AppSidebar.tsx")).toContain("<BrandLockup");
    // Auth used to carry two separate copies, one per breakpoint.
    expect(read("src/pages/Auth.tsx").match(/<BrandLockup/g)).toHaveLength(2);
    expect(read("src/pages/Landing.tsx")).toContain("<BrandLockup");
    expect(read("src/pages/NotFound.tsx")).toContain("<BrandLockup");
  });

  it("uses the gradient mark everywhere, not the muted auth variant", () => {
    // `bg-accent/15` + `border-accent/30` on the tile was the auth screen's
    // outlier; the gradient is the treatment the sidebar, FAB and CTAs use.
    expect(read("src/components/BrandLockup.tsx")).toContain("bg-gradient-brand");

    const authTile = read("src/pages/Auth.tsx").match(/bg-accent\/15 border border-accent\/30/g);
    // One legitimate use remains on the file: none on a logo tile any more.
    expect(authTile ?? []).toHaveLength(0);
  });
});

describe("personal data is not shipped as a form default", () => {
  it("no source file carries the maintainer's name as a placeholder", () => {
    const offenders: string[] = [];

    for (const file of ["src/pages/Auth.tsx", "src/pages/Landing.tsx"]) {
      if (/Pratham|Kashyap/i.test(read(file))) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("the signup name field still has a placeholder", () => {
    // Removing the personal name must not have removed the hint altogether.
    expect(read("src/pages/Auth.tsx")).toMatch(/id="name"[^>]*placeholder="[^"]+"/);
  });
});

describe("the auth screen waits for the token before deciding", () => {
  it("guards on isLoading, mirroring ProtectedRoute", () => {
    const auth = read("src/pages/Auth.tsx");

    expect(auth).toContain("isLoading");
    // The guard has to come before the isAuthenticated redirect, or the login
    // form still paints for a frame on refresh.
    expect(auth.indexOf("if (isLoading)")).toBeLessThan(auth.indexOf("if (isAuthenticated)"));
  });

  it("sends a new member to the dashboard, not back to the landing page", () => {
    // The post-auth default used to be "/", which is now the public marketing
    // page and would bounce a signed-in member straight back out.
    expect(read("src/pages/Auth.tsx")).toContain('|| "/dashboard"');
  });
});

describe("NotFound is themed and navigates on the client", () => {
  it("uses theme tokens rather than the old hardcoded muted/primary pair", () => {
    const notFound = code("src/pages/NotFound.tsx");

    expect(notFound).toContain("bg-background");
    expect(notFound).toContain("text-foreground");
    expect(notFound).not.toContain("bg-muted");
  });

  it("links with react-router instead of forcing a document reload", () => {
    const notFound = code("src/pages/NotFound.tsx");

    expect(notFound).toContain("<Link to=\"/\"");
    expect(notFound).not.toMatch(/<a href="\/"/);
  });
});

describe("the domain root is the public face", () => {
  const app = () => read("src/App.tsx");

  it("routes / to the landing page and /dashboard to the dashboard", () => {
    expect(app()).toContain('<Route path="/" element={<Landing />} />');
    expect(app()).toContain('<Route path="/dashboard" element={<Dashboard />} />');
    expect(app()).not.toContain('<Route path="/" element={<Dashboard />} />');
  });

  it("sends a signed-in visitor from / straight to the dashboard", () => {
    const landing = read("src/pages/Landing.tsx");

    expect(landing).toContain('<Navigate to="/dashboard" replace />');
    // ...and must not conclude before the token has been read.
    expect(landing.indexOf("if (isLoading)")).toBeLessThan(
      landing.indexOf("if (isAuthenticated)"),
    );
  });

  it("keeps /auth public", () => {
    expect(app()).toContain('<Route path="/auth" element={<Auth />} />');
    // The landing route must be a sibling of /auth, not nested under the guard.
    const guarded = app().indexOf("<ProtectedRoute");
    const landing = app().indexOf('<Route path="/" element={<Landing />} />');
    expect(landing).toBeLessThan(guarded);
  });

  it("has no page left named after the index route it no longer serves", () => {
    // Index.tsx became Dashboard.tsx when the route moved; a leftover would
    // suggest the dashboard is still at /.
    expect(() => read("src/pages/Index.tsx")).toThrow();
  });
});
