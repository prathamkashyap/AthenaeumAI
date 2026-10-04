import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act } from "react";
import {
  applyTheme,
  initTheme,
  LIGHT_CLASS,
  normaliseTheme,
  THEME_KEY,
  themeFromDocument,
} from "@/lib/theme";

/**
 * Step 6 found that a stored Light preference was ignored on `/` and `/auth`.
 *
 * Those tests could not catch it: `ThemeToggle` is mounted by `AppLayout`, so the
 * public routes never had a theme applied at all, and the previous suite only
 * grepped component source for className strings. These tests exercise the real
 * behaviour — set storage, run boot, assert the DOM.
 */

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

/** Imported lazily because the module runs `initTheme()` at import time. */
async function boot() {
  const mod = await import("@/lib/theme");
  return mod.initTheme();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  vi.resetModules();
});

describe("theme values and persistence are unchanged", () => {
  it("still recognises exactly the two modes", () => {
    expect(normaliseTheme("light")).toBe("light");
    expect(normaliseTheme("starry")).toBe("starry");
    expect(normaliseTheme(null)).toBe("starry");
  });

  it("still resolves the retired academia value to a real theme", () => {
    expect(normaliseTheme("academia")).toBe("starry");
  });

  it("still writes back a migrated value so it cannot linger", async () => {
    localStorage.setItem(THEME_KEY, "academia");
    await boot();

    expect(localStorage.getItem(THEME_KEY)).toBe("starry");
  });

  it("leaves a valid stored value untouched", async () => {
    localStorage.setItem(THEME_KEY, "light");
    await boot();

    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("stores nothing when there was nothing stored", async () => {
    await boot();

    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});

describe("boot applies the stored theme on every route", () => {
  it("applies Light on the landing page", async () => {
    localStorage.setItem(THEME_KEY, "light");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<div data-testid="landing" />} />
        </Routes>
      </MemoryRouter>,
    );
    // Boot runs in main.tsx, so drive the same entry point the app uses.
    await act(async () => {
      await boot();
    });

    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(true);
    expect(themeFromDocument()).toBe("light");
  });

  it("applies Light on the auth page", async () => {
    localStorage.setItem(THEME_KEY, "light");

    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Routes>
          <Route path="/auth" element={<div data-testid="auth" />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await boot();
    });

    expect(themeFromDocument()).toBe("light");
  });

  it("applies the Aurora default when nothing is stored", async () => {
    await act(async () => {
      await boot();
    });

    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(false);
    expect(themeFromDocument()).toBe("starry");
  });

  it("does not depend on any component being mounted", async () => {
    // The whole defect in one assertion: no render, no ThemeToggle, no AppLayout,
    // and the class is still applied.
    localStorage.setItem(THEME_KEY, "light");
    await boot();

    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(true);
  });

  it("clears a stale theme-academia class left on the document", async () => {
    document.documentElement.classList.add("theme-academia");
    localStorage.setItem(THEME_KEY, "light");

    await boot();

    expect(document.documentElement.classList.contains("theme-academia")).toBe(false);
    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(true);
  });

  it("survives storage being unavailable instead of throwing during boot", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    // A throw here would happen before render and take the whole app down.
    await expect(boot()).resolves.toBe("starry");

    spy.mockRestore();
  });
});

describe("applying a theme is idempotent and reversible", () => {
  it("re-applying the same theme does not stack classes", async () => {
    applyTheme("light");
    applyTheme("light");

    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(true);
    expect(document.documentElement.className.match(new RegExp(LIGHT_CLASS, "g"))).toHaveLength(1);
  });

  it("switching back to Aurora removes the class", () => {
    applyTheme("light");
    applyTheme("starry");

    expect(document.documentElement.classList.contains(LIGHT_CLASS)).toBe(false);
  });
});

describe("reduced-motion support is untouched by the theme move", () => {
  it("the motion query is still honoured by the aurora layer, not the theme", async () => {
    // The theme and motion preferences are independent: applying a theme must not
    // consult or alter matchMedia. AuroraBackground owns that behaviour.
    const set = vi.spyOn(window, "matchMedia");

    localStorage.setItem(THEME_KEY, "light");
    await boot();

    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it("the stylesheet still gates animation behind prefers-reduced-motion", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/index.css", "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("the public routes stay reachable under either theme", () => {
  it("renders the auth form with Light applied", async () => {
    localStorage.setItem(THEME_KEY, "light");
    await act(async () => {
      await boot();
    });

    const Auth = (await import("@/pages/Auth")).default;
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Auth />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("tab", { name: /login/i }).length).toBeGreaterThan(0);
    expect(themeFromDocument()).toBe("light");
  });
});
