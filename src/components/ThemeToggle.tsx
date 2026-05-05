import { useEffect, useState } from "react";
import { Moon, Sun, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "starry" | "light" | "academia";
const KEY = "athenaeum-theme";
const ORDER: Theme[] = ["starry", "light", "academia"];

const apply = (t: Theme) => {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-academia");
  if (t === "light") root.classList.add("theme-light");
  if (t === "academia") root.classList.add("theme-academia");
};

const labelFor = (t: Theme) =>
  t === "starry" ? "Starry" : t === "light" ? "Light" : "Academia";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("starry");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "starry";
    setTheme(saved);
    apply(saved);
  }, []);

  const cycle = () => {
    const idx = ORDER.indexOf(theme);
    const next = ORDER[(idx + 1) % ORDER.length];
    setTheme(next);
    apply(next);
    localStorage.setItem(KEY, next);
  };

  const Icon = theme === "starry" ? Moon : theme === "light" ? Sun : BookOpen;
  const nextLabel = labelFor(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${labelFor(theme)} — click for ${nextLabel}`}
      title={`Theme: ${labelFor(theme)} → ${nextLabel}`}
      className="text-muted-foreground hover:text-accent transition-colors"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export default ThemeToggle;
