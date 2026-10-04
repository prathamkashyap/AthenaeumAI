/**
 * Subject icons
 * =============
 *
 * The API sends an emoji string per subject, and the dashboard used to render it
 * directly — which is how emoji reached the product UI despite the frontend source
 * containing none. The icon is now derived on the client, so:
 *
 *   - the API's `icon` field is ignored entirely;
 *   - every known subject keeps a distinct, semantic Lucide glyph;
 *   - an unknown subject still gets a real icon rather than raw text.
 */

import { describe, expect, it } from "vitest";
import {
  Brain,
  Database,
  GitBranch,
  MessageSquareText,
  Monitor,
  Network,
  Pickaxe,
  ScanEye,
  Shapes,
} from "lucide-react";
import { subjectIcon } from "@/lib/subjectIcons";

describe("known subjects get their intended glyph", () => {
  const cases: Array<[string, string, unknown]> = [
    ["Operating Systems", "OS", Monitor],
    ["Data Structures & Algorithms", "DSA", GitBranch],
    ["Computer Networks", "CN", Network],
    ["DBMS", "DBMS", Database],
    ["Data Mining", "DM", Pickaxe],
    ["Deep Learning", "DL", Brain],
    ["Natural Language Processing", "NLP", MessageSquareText],
    ["Computer Vision", "CV", ScanEye],
  ];

  it.each(cases)("%s -> its own icon", (subject, _short, expected) => {
    expect(subjectIcon(subject)).toBe(expected);
  });

  it("gives every subject a distinct icon", () => {
    const icons = cases.map(([subject]) => subjectIcon(subject));
    expect(new Set(icons).size).toBe(cases.length);
  });
});

describe("resolution is tolerant without becoming mushy", () => {
  it("falls back to a short name when the full name differs", () => {
    expect(subjectIcon("Operating Systems II", "OS")).toBe(Monitor);
    expect(subjectIcon("Computer Vision", "CV")).toBe(ScanEye);
  });

  it("matches loosely on wording when names drift", () => {
    expect(subjectIcon("Advanced Operating Systems")).toBe(Monitor);
    expect(subjectIcon("Algorithms and Data Structures")).toBe(GitBranch);
    expect(subjectIcon("Introduction to Computer Networks")).toBe(Network);
    expect(subjectIcon("Deep Neural Networks")).toBe(Brain);
    expect(subjectIcon("Statistical Learning")).toBe(Brain);
    expect(subjectIcon("Natural Language Processing with Transformers")).toBe(
      MessageSquareText,
    );
  });

  it("returns a real component for an unrecognised subject", () => {
    expect(subjectIcon("Underwater Basket Weaving")).toBe(Shapes);
  });

  it("survives missing input", () => {
    expect(subjectIcon(undefined, undefined)).toBe(Shapes);
    expect(subjectIcon("", "")).toBe(Shapes);
  });
});
