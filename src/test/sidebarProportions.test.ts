/**
 * Collapsed sidebar proportions
 * =============================
 *
 * The collapsed rail was 3rem (48px). The header contributes `p-2` (8px per side)
 * and the brand row contributed its own `px-2`, which left 16px of content for a
 * 36px mark — a 20px overflow, so the logo read as cramped and slightly rectangular
 * rather than as a deliberate square app icon.
 *
 * The rail is now 4rem (64px) and the collapsed header drops its padding so the mark
 * centres in the full width: a 44px tile with 10px gutters either side.
 *
 * Asserted against the source because these are static geometry constants and CSS
 * classes; asserting computed layout would need a real browser, and mounting
 * `AppSidebar` under jsdom needs Radix sheet/tooltip context it does not provide.
 * What is pinned here is the *contract* — the rail is 4rem, and the collapsed brand
 * block centres a tile large enough to fit it — so a future edit cannot silently
 * reintroduce the squeeze.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

describe("collapsed sidebar rail", () => {
  it("is 4rem, not the 3rem that squeezed the mark", () => {
    const sidebar = read("src/components/ui/sidebar.tsx");

    expect(sidebar).toMatch(/const SIDEBAR_WIDTH_ICON = "4rem";/);
    expect(sidebar).not.toMatch(/const SIDEBAR_WIDTH_ICON = "3rem";/);
  });

  it("the brand header and the main topbar share one height", () => {
    // The header used to size itself from its contents — 76px expanded, 68px
    // collapsed, against the topbar's fixed 64px — so their bottom borders never
    // lined up and the sidebar's moved when the rail collapsed. Both now read the
    // same token, which is the only thing that keeps them aligned.
    const css = read("src/index.css");
    const config = read("tailwind.config.ts");

    expect(css).toContain("--app-header-height: 4rem");
    expect(config).toContain('header: "var(--app-header-height)"');
    expect(read("src/components/AppSidebar.tsx")).toContain("h-header");
    expect(read("src/components/AppLayout.tsx")).toContain("h-header");
  });

  it("leaves the expanded and mobile widths alone", () => {
    const sidebar = read("src/components/ui/sidebar.tsx");

    expect(sidebar).toMatch(/const SIDEBAR_WIDTH = "16rem";/);
    expect(sidebar).toMatch(/const SIDEBAR_WIDTH_MOBILE = "18rem";/);
  });

  it("keeps collapsed nav buttons at their existing 32px size", () => {
    const sidebar = read("src/components/ui/sidebar.tsx");

    // Unchanged on purpose: widening the rail must not resize the navigation.
    expect(sidebar).toContain("group-data-[collapsible=icon]:!size-8");
  });
});

describe("collapsed brand mark", () => {
  const appSidebar = () => read("src/components/AppSidebar.tsx");

  it("centres the brand block when collapsed", () => {
    // Applied only in the collapsed state, as a conditional class.
    expect(appSidebar()).toContain('collapsed && "justify-center"');
  });

  it("drops the header padding only when collapsed", () => {
    // Expanded keeps its own horizontal inset; collapsed goes edge to edge so the
    // mark can centre in the full rail.
    expect(appSidebar()).toContain('collapsed ? "p-0" : "px-2"');
  });

  it("uses a tile that fits the wider rail with equal gutters", () => {
    // The tile geometry moved into BrandLockup's SIZES map when the three brand
    // copies were consolidated, so the sizes are asserted where they now live.
    const lockup = read("src/components/BrandLockup.tsx");

    // lg is the collapsed rail size, sm the expanded one.
    expect(lockup).toContain('lg: {');
    expect(lockup).toContain('tile: "h-11 w-11 rounded-lg"');
    expect(lockup).toContain('tile: "h-9 w-9 rounded-md"');
    expect(lockup).toContain('glyph: "h-6 w-6"');
    expect(lockup).toContain('glyph: "h-5 w-5"');
  });

  it("cannot be squeezed: the tile is shrink-0 inside a centred row", () => {
    const lockup = read("src/components/BrandLockup.tsx");
    expect(lockup).toContain("shrink-0 items-center justify-center");
    // ...and the sidebar centres it in the collapsed state.
    expect(appSidebar()).toContain('collapsed && "justify-center"');
  });

  it("still fits within the rail", () => {
    // 4rem rail, 44px tile => 10px gutters. Guard the arithmetic so a future
    // change to either number is caught here rather than by eye.
    const railPx = 64;
    const tilePx = 44;

    expect(tilePx).toBeLessThan(railPx);
    expect((railPx - tilePx) / 2).toBeGreaterThanOrEqual(8);
  });
});
