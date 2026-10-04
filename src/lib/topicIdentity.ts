/**
 * Topic identity
 * ==============
 *
 * Every topic in the sidebar navigation rendered the same `ScrollText` glyph in the
 * same muted grey, so the icon communicated nothing and the list read as one
 * undifferentiated block. Long titles then wrapped across two lines and competed
 * with the mastery percentage for space.
 *
 * Two rules shape this module:
 *
 * 1. **Deterministic.** The same topic always gets the same icon and accent, in
 *    this render and the next one. Nothing is random or time-seeded, so the
 *    sidebar does not reshuffle itself on reload.
 * 2. **Restrained.** One small tinted icon, not a coloured card. The dashboard
 *    already carries the strong colour; navigation stays quiet and lets typography
 *    do the work. Accents follow the same 400-level tones the subject cards use, so
 *    the two read as one system.
 *
 * Keyword matching handles topics that name their subject. Anything unrecognised
 * falls back to a stable hash across a small fixed set, which guarantees every
 * topic still has a distinct, repeatable identity rather than collapsing to a
 * default.
 */

import {
  Atom,
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  Briefcase,
  Cpu,
  Database,
  FlaskConical,
  GitBranch,
  Landmark,
  MessagesSquare,
  Microscope,
  Network,
  Scale,
  ShoppingBag,
  Sigma,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface TopicIdentity {
  Icon: LucideIcon;
  /** Tint for the icon. Paired tones, so light and dark both stay legible. */
  accent: string;
  /** Faint background for the fixed-size icon chip. */
  chip: string;
}

interface Rule {
  match: RegExp;
  Icon: LucideIcon;
  accent: string;
  chip: string;
}

/** Ordered: the first match wins, so specific phrases precede broad ones. */
const RULES: Rule[] = [
  // Plurals are written `s?` deliberately: a trailing `\b` after the keyword made
  // "Operating Systems" and "Computer Networks" fall through to the hash fallback,
  // which is exactly how the most common topics lost their identity.
  { match: /\b(os|operating systems?)\b/i,                Icon: Cpu,           accent: "text-sky-400",     chip: "bg-sky-400/10" },
  { match: /\bdsa|algorithms?|data structures?\b/i,        Icon: GitBranch,     accent: "text-emerald-400", chip: "bg-emerald-400/10" },
  { match: /\b(dbms|databases?|sql)\b/i,                   Icon: Database,      accent: "text-amber-400",   chip: "bg-amber-400/10" },
  { match: /\b(networks?|cnn|neural networks?)\b/i,       Icon: Network,       accent: "text-cyan-400",    chip: "bg-cyan-400/10" },
  { match: /\b(dl|deep learning|machine learning|ml|neural)\b/i, Icon: Brain, accent: "text-violet-400", chip: "bg-violet-400/10" },
  { match: /\b(nlp|natural language|transformers?)\b/i,  Icon: MessagesSquare, accent: "text-teal-400",    chip: "bg-teal-400/10" },
  { match: /\b(cv|computer vision|images?)\b/i,          Icon: Microscope,    accent: "text-pink-400",    chip: "bg-pink-400/10" },
  { match: /\b(churn|retention|customers?)\b/i,          Icon: Users,         accent: "text-rose-400",    chip: "bg-rose-400/10" },
  { match: /\b(retail|e-?commerce|stores?)\b/i,         Icon: ShoppingBag,   accent: "text-orange-400",  chip: "bg-orange-400/10" },
  { match: /\b(intern|internships?|placements?)\b/i,      Icon: Briefcase,     accent: "text-blue-400",    chip: "bg-blue-400/10" },
  { match: /\b(reports?|documentation|projects?)\b/i,   Icon: BookOpen,      accent: "text-indigo-400",  chip: "bg-indigo-400/10" },
  { match: /\b(analytics|statistics?|metrics?)\b/i,    Icon: BarChart3,     accent: "text-lime-400",    chip: "bg-lime-400/10" },
  { match: /\b(physics|quantum|mechanics?)\b/i,          Icon: Atom,          accent: "text-violet-300",  chip: "bg-violet-300/10" },
  { match: /\b(law|legal|polic(?:y|ies))\b/i,            Icon: Scale,         accent: "text-stone-400",   chip: "bg-stone-400/10" },
  { match: /\b(economics?|finance|accounts?|markets?)\b/i, Icon: Landmark,    accent: "text-emerald-300", chip: "bg-emerald-300/10" },
  { match: /\b(chemistry|chemical|labs?)\b/i,              Icon: FlaskConical,  accent: "text-lime-300",    chip: "bg-lime-300/10" },
  { match: /\b(math|algebra|calculus|probability)\b/i,   Icon: Sigma,         accent: "text-cyan-300",    chip: "bg-cyan-300/10" },
  { match: /\b(cloud|devops|systems?|infrastructure)\b/i, Icon: Boxes,        accent: "text-sky-300",     chip: "bg-sky-300/10" },
];

/** Used when nothing matches, so an unknown topic still looks deliberate. */
const FALLBACKS: TopicIdentity[] = [
  { Icon: BookOpen,  accent: "text-sky-400",     chip: "bg-sky-400/10" },
  { Icon: Atom,      accent: "text-violet-400",  chip: "bg-violet-400/10" },
  { Icon: Boxes,     accent: "text-emerald-400", chip: "bg-emerald-400/10" },
  { Icon: Sigma,     accent: "text-amber-400",   chip: "bg-amber-400/10" },
];

/** Small, stable string hash. Not cryptographic — only needs to not collide often. */
const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

/**
 * Resolves a topic's icon and accent. Pure and stable for a given title.
 */
export const topicIdentity = (title: string): TopicIdentity => {
  const rule = RULES.find((r) => r.match.test(title));
  if (rule) return { Icon: rule.Icon, accent: rule.accent, chip: rule.chip };
  return FALLBACKS[hash(title) % FALLBACKS.length];
};
