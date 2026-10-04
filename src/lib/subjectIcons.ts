/**
 * Subject identity
 * ================
 *
 * Subjects arrive from the API with an `icon` field holding an **emoji string**,
 * seeded by the backend. Rendering that as text put emoji into the product UI, and
 * it also meant the icon style drifted with whatever the database happened to
 * contain. (Those characters are deliberately not reproduced here: a
 * repository-wide guard rejects emoji in shipped source, and this file is
 * shipped source.)
 *
 * The icon is now derived on the client from the subject itself, so every subject
 * keeps a distinct, semantically meaningful Lucide glyph and the API's emoji is
 * ignored entirely. Colours remain per-subject, so the existing visual distinction
 * is preserved.
 */

import {
  Brain,
  Database,
  GitBranch,
  Monitor,
  Network,
  Pickaxe,
  ScanEye,
  MessageSquareText,
  Shapes,
  type LucideIcon,
} from "lucide-react";

/** Shown when a subject is not one we have a specific glyph for. */
const FALLBACK: LucideIcon = Shapes;

const BY_SUBJECT: Record<string, LucideIcon> = {
  "Operating Systems": Monitor,
  "Data Structures & Algorithms": GitBranch,
  "Computer Networks": Network,
  DBMS: Database,
  "Data Mining": Pickaxe,
  "Deep Learning": Brain,
  "Natural Language Processing": MessageSquareText,
  "Computer Vision": ScanEye,
};

/** Tolerates short names and casing, since subjects are user-visible labels. */
export const subjectIcon = (subject?: string, shortName?: string): LucideIcon => {
  if (subject && BY_SUBJECT[subject]) return BY_SUBJECT[subject];

  const short = shortName?.trim().toUpperCase();
  if (short) {
    const byShort = Object.entries(BY_SUBJECT).find(
      ([name]) => name.toUpperCase().startsWith(short),
    );
    if (byShort) return byShort[1];
  }

  // Ordered most-specific first. "Deep Neural Networks" must resolve to Brain, not
  // Network, so the machine-learning terms are tested before the networking ones.
  const haystack = `${subject ?? ""} ${shortName ?? ""}`.toLowerCase();
  if (haystack.includes("neural") || haystack.includes("learning")) return Brain;
  if (haystack.includes("vision")) return ScanEye;
  if (haystack.includes("language") || haystack.includes("nlp")) return MessageSquareText;
  if (haystack.includes("mining")) return Pickaxe;
  if (haystack.includes("database") || haystack.includes("dbms")) return Database;
  if (haystack.includes("algorithm") || haystack.includes("structure")) return GitBranch;
  if (haystack.includes("network")) return Network;
  if (haystack.includes("operating")) return Monitor;

  return FALLBACK;
};
