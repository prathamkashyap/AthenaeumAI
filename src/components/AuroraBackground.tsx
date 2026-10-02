import { useEffect, useState, type CSSProperties } from "react";

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface Blob {
  id: number;
  color: string;
  top: string;
  left: string;
  size: number;
  driftX: number;
  driftY: number;
  scale: number;
  duration: number;
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

/**
 * AuroraBackground
 * Replaces the old starfield with a slow, procedural aurora/mesh-gradient
 * backdrop: a handful of large blurred color blobs that drift and breathe,
 * a barely-visible grain layer for texture, and a click "residue" ring
 * (kept from the old ripple effect, just resized down).
 */
export function AuroraBackground() {
  const reduced = useReducedMotion();
  const isMobile = useIsMobile();
  const isLight = useIsLight();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  // Subtle pointer parallax applied to the aurora blobs
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

  // Click residue — small ring + core flash at the cursor
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const r: Ripple = { id: Date.now() + Math.random(), x: e.clientX, y: e.clientY };
      setRipples((prev) => [...prev, r]);
      setTimeout(() => setRipples((prev) => prev.filter((x) => x.id !== r.id)), 500);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const baseGradient = isLight
    ? "bg-[radial-gradient(ellipse_at_top,hsl(210_60%_98%)_0%,hsl(210_50%_95%)_55%,hsl(210_45%_93%)_100%)]"
    : "bg-[radial-gradient(ellipse_at_top,hsl(220_38%_7%)_0%,hsl(222_36%_4%)_55%,hsl(224_45%_2%)_100%)]";

  const blobs: Blob[] = isLight
    ? [
        { id: 0, color: "hsl(210 90% 60% / 0.16)", top: "-18%", left: "16%", size: 560, driftX: 50, driftY: 35, scale: 1.1, duration: 32 },
        { id: 1, color: "hsl(265 75% 65% / 0.12)", top: "20%", left: "66%", size: 620, driftX: -45, driftY: -30, scale: 1.08, duration: 38 },
        { id: 2, color: "hsl(195 90% 55% / 0.10)", top: "60%", left: "-8%", size: 500, driftX: 35, driftY: -45, scale: 1.1, duration: 26 },
      ]
    : [
        { id: 0, color: "hsl(210 90% 60% / 0.22)", top: "-18%", left: "16%", size: 620, driftX: 55, driftY: 40, scale: 1.12, duration: 32 },
        { id: 1, color: "hsl(265 75% 62% / 0.18)", top: "18%", left: "64%", size: 680, driftX: -50, driftY: -35, scale: 1.08, duration: 38 },
        { id: 2, color: "hsl(195 90% 58% / 0.16)", top: "62%", left: "-10%", size: 560, driftX: 40, driftY: -50, scale: 1.1, duration: 26 },
      ];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className={`absolute inset-0 ${baseGradient}`} />

      {/* Aurora mesh blobs — the only "motion" in the background */}
      {blobs.map((b) => (
        <div
          key={b.id}
          className={`absolute rounded-full blur-3xl ${reduced ? "" : "aurora-blob"}`}
          style={
            {
              top: b.top,
              left: b.left,
              width: b.size,
              height: b.size,
              background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)`,
              ["--parallax-x" as never]: `${parallax.x * 12}px`,
              ["--parallax-y" as never]: `${parallax.y * 8}px`,
              ["--drift-x" as never]: `${b.driftX}px`,
              ["--drift-y" as never]: `${b.driftY}px`,
              ["--drift-scale" as never]: b.scale,
              ["--aurora-dur" as never]: `${b.duration}s`,
            } as CSSProperties
          }
        />
      ))}

      {/* Barely-visible grain for texture (Linear-style) */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.035] mix-blend-overlay">
        <filter id="aurora-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#aurora-grain)" />
      </svg>

      {/* Click residue */}
      {ripples.map((r) => (
        <span key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
      ))}

      {/* Top vignette for header readability */}
      {!isLight && (
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/40 to-transparent" />
      )}
    </div>
  );
}

export default AuroraBackground;
