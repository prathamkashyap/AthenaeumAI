import { cn } from "@/lib/utils";
import { GraduationCap } from "lucide-react";

/**
 * The single source of truth for how the product identifies itself.
 *
 * The mark used to be re-implemented three times — the sidebar, the desktop auth
 * panel and the mobile auth panel — and the copies had drifted: three different
 * names ("Athenaeum", "AthenaeumAI", "Athenaeum AI"), three taglines, and two
 * different tile treatments, so the logo changed appearance between the app and
 * the login screen. Anything that needs the brand now reads these constants, and
 * any change to the identity is a one-line edit here rather than a scavenger hunt.
 */
export const BRAND = {
  /** The wordmark. Short, and it reads cleanly at 18px in the sidebar rail. */
  wordmark: "Athenaeum",
  /** Spelled-out name, for metadata, prose and legal lines. */
  fullName: "Athenaeum AI",
  /** One tagline everywhere. "OS" was jargon and appeared in two of the three copies. */
  tagline: "Intelligent Learning System",
} as const;

const SIZES = {
  sm: {
    tile: "h-9 w-9 rounded-md",
    glyph: "h-5 w-5",
    wordmark: "text-lg",
    // 9px at 0.12em, not 10px at 0.2em. The canonical tagline is three words
    // where the sidebar's old one-liner was two, and at the looser tracking it
    // measured ~215px inside a rail with ~196px to give — so it wrapped onto a
    // second line and broke the 64px header. Only a rendered browser showed it;
    // every DOM test passed. `whitespace-nowrap` makes a future longer tagline
    // truncate rather than wrap.
    tagline: "whitespace-nowrap text-[9px] tracking-[0.12em]",
  },
  md: {
    tile: "h-10 w-10 rounded-lg",
    glyph: "h-5 w-5",
    wordmark: "text-xl",
    tagline: "whitespace-nowrap text-[10px] tracking-[0.16em]",
  },
  lg: {
    tile: "h-11 w-11 rounded-lg",
    glyph: "h-6 w-6",
    wordmark: "text-2xl",
    tagline: "whitespace-nowrap text-[10px] tracking-[0.2em]",
  },
} as const;

export type BrandLockupProps = {
  size?: keyof typeof SIZES;
  /**
   * Render the tile alone, for the collapsed sidebar rail where the rail is
   * narrower than the wordmark and truncating it to "Athena…" would be worse
   * than showing nothing.
   */
  markOnly?: boolean;
  /**
   * Merged onto the tagline. Used by the landing header to drop the tagline on
   * narrow viewports, where the lockup plus the primary CTA overflow the row.
   */
  taglineClassName?: string;
  className?: string;
};

export function BrandLockup({
  size = "md",
  markOnly = false,
  taglineClassName,
  className,
}: BrandLockupProps) {
  const s = SIZES[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          // One treatment app-wide: the gradient mark. It was already dominant
          // (sidebar, FAB, every primary CTA), so the auth screen's muted
          // `bg-accent/15` tile was the outlier and is gone.
          "flex shrink-0 items-center justify-center bg-gradient-brand text-primary-foreground shadow-glow",
          s.tile,
        )}
      >
        <GraduationCap className={s.glyph} />
      </div>
      {!markOnly && (
        <div className="flex min-w-0 flex-col">
          <span className={cn("font-serif leading-none text-foreground", s.wordmark)}>
            {BRAND.wordmark}
          </span>
          <span
            className={cn(
              "mt-1 uppercase leading-none text-muted-foreground",
              s.tagline,
              taglineClassName,
            )}
          >
            {BRAND.tagline}
          </span>
        </div>
      )}
    </div>
  );
}

export default BrandLockup;
