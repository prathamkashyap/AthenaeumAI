import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyTheme,
  initTheme,
  THEME_ORDER,
  themeFromDocument,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";
import { useEffect, useState } from "react";

const labelFor = (t: Theme) => (t === "starry" ? "Aurora" : "Light");

/**
 * The theme values, storage key and normalisation all live in `@/lib/theme`, which
 * `main.tsx` calls at boot. This component only reflects the current theme and
 * cycles it — it no longer decides what "light" means or how a stale value resolves.
 */
export function ThemeToggle() {
  // `initTheme` is idempotent and has already run by the time this mounts, so the
  // first render is correct rather than flashing the default before an effect.
  const [theme, setTheme] = useState<Theme>(() => themeFromDocument());

  useEffect(() => {
    // Re-resolve on mount: this also repairs a document whose class was stripped
    // by a cached page, and migrates a stale stored value.
    setTheme(initTheme());
  }, []);

  const cycle = () => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    setTheme(next);
    applyTheme(next);
    writeStoredTheme(next);
  };

  // Two modes, two icons. The moon marks the dark Aurora theme, the sun the light one.
  const Icon = theme === "light" ? Sun : Moon;
  const nextLabel = labelFor(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${labelFor(theme)} — click for ${nextLabel}`}
      title={`Theme: ${labelFor(theme)} — click for ${nextLabel}`}
      className="text-muted-foreground hover:text-accent transition-colors"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export default ThemeToggle;
