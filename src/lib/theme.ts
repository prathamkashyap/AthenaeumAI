/**
 * The one place the theme is defined.
 *
 * This logic used to live entirely inside `ThemeToggle`, which is only mounted by
 * `AppLayout` — the authenticated shell. So `/` and `/auth` never applied the
 * stored preference and always rendered dark, and someone who had chosen Light
 * met a dark page the moment they signed out or followed a shared link.
 *
 * It lives here now so that `main.tsx` can apply the stored theme at boot, before
 * React renders, and the toggle can keep using exactly the same values, key and
 * normalisation. There is still one theme system; only its initialisation moved.
 */

export type Theme = "starry" | "light";

export const THEME_KEY = "athenaeum-theme";

/** Cycle order for the toggle. "starry" is the Blue Aurora default and carries no class. */
export const THEME_ORDER: Theme[] = ["starry", "light"];

export const LIGHT_CLASS = "theme-light";

/**
 * A third "Academia" gold theme existed and has been removed. Because the choice
 * is persisted, a browser that still has `academia` stored must resolve to
 * something real — otherwise the app loads unthemed and the toggle shows a label
 * for a mode that no longer exists.
 */
export function normaliseTheme(stored: string | null): Theme {
  return stored === "light" ? "light" : "starry";
}

/** Maps the DOM to a theme. "starry" is represented by the absence of a class. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // `theme-academia` is removed as well: a cached document can still carry it
  // even though nothing writes it any more.
  root.classList.remove(LIGHT_CLASS, "theme-academia");
  if (theme === "light") root.classList.add(LIGHT_CLASS);
}

/**
 * Read the stored preference, apply it, and rewrite the stored value when it was
 * stale. Returns the resolved theme so callers can render the right icon.
 *
 * Called from `main.tsx` at module scope, which is what makes it apply to every
 * route — and applies it *before* the first render rather than in an effect after
 * mount, so the correct theme is present at first paint.
 */
export function initTheme(): Theme {
  const raw = readStoredThemeRaw();
  const theme = normaliseTheme(raw);
  applyTheme(theme);
  // Rewrite so a stale "academia" does not linger in storage.
  if (raw !== null && raw !== theme) writeStoredTheme(theme);
  return theme;
}

function readStoredThemeRaw(): string | null {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    // Private browsing or a blocked origin: fall back to the default rather than
    // throwing during boot, which would take the whole app down before render.
    return null;
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Persistence is best-effort; the theme still applies for this page view.
  }
}

/** The current theme according to the DOM, not storage. */
export function themeFromDocument(): Theme {
  return document.documentElement.classList.contains(LIGHT_CLASS) ? "light" : "starry";
}
