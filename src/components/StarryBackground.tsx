import { useEffect, useMemo, useRef, useState } from "react";

interface Star {
  id: number;
  x: number;          // %
  y: number;          // %
  size: number;       // px
  delay: number;      // s
  twinkleDur: number; // s
  driftDur: number;   // s
  driftX: number;     // px
  driftY: number;     // px
  blue: boolean;
  depth: number;      // 0..1
}

interface Comet {
  id: number;
  startX: number;     // vw
  startY: number;     // vh
  endX: number;       // vw
  endY: number;       // vh
  angle: number;      // deg
  duration: number;   // s
  length: number;     // px
  hueShift: boolean;  // cyan vs white-blue
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const useReducedMotion = () => {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(mq.matches);
    const h = (e: MediaQueryListEvent) => setR(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return r;
};

const useIsMobile = () => {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setM(mq.matches);
    const h = (e: MediaQueryListEvent) => setM(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return m;
};

const useIsLight = () => {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setLight(root.classList.contains("theme-light"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return light;
};

export function StarryBackground() {
  const reduced = useReducedMotion();
  const isMobile = useIsMobile();
  const isLight = useIsLight();
  const [comets, setComets] = useState<Comet[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const starCount = isMobile ? 60 : 160;

  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: starCount }, (_, i) => {
      const depth = Math.random() * 0.85 + 0.15;
      return {
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 1.8 + 0.4,
        delay: Math.random() * 8,
        twinkleDur: Math.random() * 4 + 2.5,
        driftDur: Math.random() * 30 + 25, // 25–55s slow drift
        driftX: (Math.random() - 0.5) * 80,
        driftY: (Math.random() - 0.5) * 60,
        blue: Math.random() < 0.28,
        depth,
      };
    });
  }, [starCount]);

  // Pointer parallax
  useEffect(() => {
    if (reduced || isMobile) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        setParallax({ x, y });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduced, isMobile]);

  // Random comets — irregular timing, random directions, occasional bursts
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const spawnOne = () => {
      // Random origin: pick a side (top, left, top-right corner band)
      const side = Math.random();
      let startX = 0, startY = 0, endX = 0, endY = 0;

      if (side < 0.45) {
        // top → bottom-ish diagonal
        startX = Math.random() * 100;
        startY = -10;
        endX = startX + (Math.random() * 60 - 10);
        endY = 110;
      } else if (side < 0.8) {
        // left → right diagonal
        startX = -10;
        startY = Math.random() * 70;
        endX = 110;
        endY = startY + (Math.random() * 50 - 10);
      } else {
        // right → left (rare reverse)
        startX = 110;
        startY = Math.random() * 60;
        endX = -10;
        endY = startY + (Math.random() * 50 - 5);
      }

      const dx = endX - startX;
      const dy = endY - startY;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      const c: Comet = {
        id: Date.now() + Math.random(),
        startX, startY, endX, endY, angle,
        duration: 0.6 + Math.random() * 0.7,   // 0.6–1.3s
        length: 120 + Math.random() * 180,
        hueShift: Math.random() < 0.35,
      };
      setComets((prev) => [...prev, c]);
      setTimeout(() => {
        setComets((prev) => prev.filter((x) => x.id !== c.id));
      }, c.duration * 1000 + 300);
    };

    const scheduleNext = () => {
      if (cancelled) return;
      // Most of the time: long quiet gaps (4–14s)
      // 15% chance: rapid burst of 2–3 comets
      const burst = Math.random() < 0.15;
      if (burst) {
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
          setTimeout(spawnOne, i * (180 + Math.random() * 220));
        }
      } else {
        spawnOne();
      }
      const gap = (isMobile ? 7000 : 4000) + Math.random() * (isMobile ? 12000 : 10000);
      timeoutId = setTimeout(scheduleNext, gap);
    };

    timeoutId = setTimeout(scheduleNext, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [reduced, isMobile]);

  // Click ripples
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const r: Ripple = { id: Date.now() + Math.random(), x: e.clientX, y: e.clientY };
      setRipples((prev) => [...prev, r]);
      setTimeout(() => setRipples((prev) => prev.filter((x) => x.id !== r.id)), 800);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  // Theme-dependent visuals
  const baseGradient = isLight
    ? "bg-[radial-gradient(ellipse_at_top,hsl(210_60%_98%)_0%,hsl(210_50%_94%)_55%,hsl(210_45%_92%)_100%)]"
    : "bg-[radial-gradient(ellipse_at_top,hsl(220_40%_8%/0.95)_0%,hsl(220_35%_4%/1)_55%,hsl(220_45%_2%)_100%)]";

  const nebula1 = isLight
    ? "bg-[radial-gradient(circle,hsl(210_90%_55%/0.10),transparent_70%)]"
    : "bg-[radial-gradient(circle,hsl(210_90%_65%/0.10),transparent_70%)]";
  const nebula2 = isLight
    ? "bg-[radial-gradient(circle,hsl(265_80%_60%/0.07),transparent_70%)]"
    : "bg-[radial-gradient(circle,hsl(265_80%_70%/0.07),transparent_70%)]";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className={`absolute inset-0 ${baseGradient}`} />

      {/* Slow drifting nebula clouds */}
      <div className={`absolute -top-40 left-1/3 h-[600px] w-[600px] rounded-full ${nebula1} blur-3xl animate-nebula-drift-a`} />
      <div className={`absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full ${nebula2} blur-3xl animate-nebula-drift-b`} />
      <div className={`absolute top-1/3 -left-40 h-[420px] w-[420px] rounded-full ${nebula1} blur-3xl animate-nebula-drift-c opacity-70`} />

      {/* Stars / particles */}
      <div className="absolute inset-0">
        {stars.map((s) => {
          const dotColor = isLight
            ? s.blue
              ? "radial-gradient(circle, hsl(210 95% 55% / 0.55) 0%, hsl(210 90% 50% / 0.25) 60%, transparent 100%)"
              : "radial-gradient(circle, hsl(220 30% 60% / 0.45) 0%, hsl(220 20% 70% / 0.18) 60%, transparent 100%)"
            : s.blue
              ? "radial-gradient(circle, hsl(210 100% 85%) 0%, hsl(210 95% 70% / 0.6) 60%, transparent 100%)"
              : "radial-gradient(circle, hsl(0 0% 100%) 0%, hsl(210 30% 90% / 0.55) 60%, transparent 100%)";
          const glow = isLight
            ? "0 0 4px hsl(210 90% 55% / 0.25)"
            : s.blue
              ? "0 0 6px hsl(210 95% 75% / 0.75)"
              : "0 0 5px hsl(0 0% 100% / 0.55)";

          return (
            <span
              key={s.id}
              className="star-drift"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                background: dotColor,
                boxShadow: glow,
                // Drift container animates a slow translate; pointer parallax adds offset
                ["--drift-x" as never]: `${s.driftX}px`,
                ["--drift-y" as never]: `${s.driftY}px`,
                ["--drift-dur" as never]: `${s.driftDur}s`,
                ["--parallax-x" as never]: `${parallax.x * s.depth * 16}px`,
                ["--parallax-y" as never]: `${parallax.y * s.depth * 16}px`,
              }}
            >
              <span
                className="star-twinkle"
                style={{
                  animationDelay: `${s.delay}s`,
                  animationDuration: `${s.twinkleDur}s`,
                }}
              />
            </span>
          );
        })}
      </div>

      {/* Comets */}
      {comets.map((c) => (
        <span
          key={c.id}
          className={`comet ${c.hueShift ? "comet-cyan" : ""}`}
          style={{
            top: `${c.startY}vh`,
            left: `${c.startX}vw`,
            width: `${c.length}px`,
            ["--comet-end-x" as never]: `${c.endX - c.startX}vw`,
            ["--comet-end-y" as never]: `${c.endY - c.startY}vh`,
            ["--comet-angle" as never]: `${c.angle}deg`,
            animationDuration: `${c.duration}s`,
          }}
        />
      ))}

      {/* Click ripples */}
      {ripples.map((r) => (
        <span key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
      ))}

      {/* Top vignette for header readability (skip in light mode) */}
      {!isLight && (
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/40 to-transparent" />
      )}
    </div>
  );
}

export default StarryBackground;
