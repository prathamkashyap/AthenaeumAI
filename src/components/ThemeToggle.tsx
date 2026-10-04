import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Two modes only: the Blue Aurora dark theme (the default, no class) and Light.
 *
 * A third "Academia" gold theme existed and has been removed. Because the choice
 * is persisted, a browser that still has `academia` stored must resolve to
 * something real — otherwise the app loads unthemed and the toggle shows a label
 * for a mode that no longer exists.
 */
type Theme = "starry" | "light";
const KEY = "athenaeum-theme";
const ORDER: Theme[] = ["starry", "light"];

const apply = (t: Theme) => {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-academia");
  if (t === "light") root.classList.add("theme-light");
};

const labelFor = (t: Theme) => (t === "starry" ? "Aurora" : "Light");

/** Maps any previously stored value onto a theme that still exists. */
const normalise = (stored: string | null): Theme =>
  stored === "light" ? "light" : "starry";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("starry");

  useEffect(() => {
    const saved = normalise(localStorage.getItem(KEY));
    setTheme(saved);
    apply(saved);
    // Rewrite the stored value so a stale "academia" does not linger.
    if (localStorage.getItem(KEY) && localStorage.getItem(KEY) !== saved) {
      localStorage.setItem(KEY, saved);
    }
  }, []);

  const cycle = () => {
    const idx = ORDER.indexOf(theme);
    const next = ORDER[(idx + 1) % ORDER.length];
    setTheme(next);
    apply(next);
    localStorage.setItem(KEY, next);
  };

  // Two modes, two icons. The moon marks the dark Aurora theme, the sun the light one.
  const Icon = theme === "light" ? Sun : Moon;
  const nextLabel = labelFor(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);

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
