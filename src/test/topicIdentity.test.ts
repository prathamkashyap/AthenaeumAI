/**
 * Topic navigation identity
 * =========================
 *
 * Every topic rendered the same `ScrollText` glyph in the same muted grey, so the
 * icon carried no information and the list read as one flat block. Long titles
 * then wrapped and pushed the mastery percentage onto a second line.
 *
 * The properties that matter are pinned here:
 *
 *   - **deterministic** — the same topic always resolves to the same icon and
 *     accent, so the sidebar does not reshuffle on reload;
 *   - **distinct** — a topic that matches no rule still gets a deliberate identity
 *     rather than collapsing to a default;
 *   - **restrained** — accents are drawn from the same 400-level tones the subject
 *     cards already use, so navigation and dashboard read as one system.
 */

import { describe, expect, it } from "vitest";
import {
  Atom,
  BookOpen,
  Boxes,
  Brain,
  Briefcase,
  Cpu,
  Database,
  GitBranch,
  Network,
  Sigma,
  ShoppingBag,
  Users,
} from "lucide-react";
import { topicIdentity } from "@/lib/topicIdentity";

describe("identity is deterministic", () => {
  const topics = [
    "Operating Systems",
    "AI/ML Practice",
    "Internship Report",
    "Customer Churn",
    "Smart Retail Project",
    "Computer Networks",
  ];

  it.each(topics)("%s resolves the same way every time", (title) => {
    const first = topicIdentity(title);
    for (let i = 0; i < 5; i += 1) {
      expect(topicIdentity(title)).toEqual(first);
    }
  });

  it("gives different topics different accents", () => {
    // The screenshot's list, which previously looked identical throughout.
    const identities = topics.map((t) => topicIdentity(t));
    const accents = identities.map((i) => i.accent);

    expect(new Set(accents).size).toBeGreaterThan(1);
  });
});

describe("topics are matched by subject, not by position", () => {
  const cases: Array<[string, unknown]> = [
    ["Operating Systems", Cpu],
    ["Data Structures & Algorithms", GitBranch],
    ["DBMS", Database],
    ["Computer Networks", Network],
    ["Deep Learning", Brain],
    ["AI/ML Internship", Brain],
    ["Customer Churn Prediction", Users],
    ["Smart Retail", ShoppingBag],
    ["Internship Report", Briefcase],
    ["Quantum Physics", Atom],
  ];

  it.each(cases)("%s gets a subject-appropriate icon", (title, expected) => {
    expect(topicIdentity(title).Icon).toBe(expected);
  });

  it("does not let a broad word win over a specific one", () => {
    // "report" and "project" both match the documentation rule, but "internship"
    // is checked first, so this must resolve to the briefcase rather than a book.
    expect(topicIdentity("Internship Report").Icon).toBe(Briefcase);
  });
});

describe("unknown topics still get a deliberate identity", () => {
  const unknowns = [
    "Underwater Basket Weaving",
    "Quantum Chromodynamics",
    "Postcolonial Cartography",
    "Medieval Cipher Studies",
    "Volcanic Petrology",
  ];

  it.each(unknowns)("%s falls back rather than erroring", (title) => {
    const identity = topicIdentity(title);
    expect(identity.Icon).toBeDefined();
    expect(identity.accent).toMatch(/^text-/);
    expect(identity.chip).toMatch(/^bg-/);
  });

  it("does not collapse every unknown onto one icon", () => {
    const icons = unknowns.map((t) => topicIdentity(t).Icon);
    expect(new Set(icons).size).toBeGreaterThan(1);
  });

  it("handles an empty title", () => {
    expect(() => topicIdentity("")).not.toThrow();
    expect(topicIdentity("").Icon).toBeDefined();
  });
});

describe("accents stay inside the product palette", () => {
  it("uses 300/400-level tones, matching the subject cards", () => {
    const all = [
      ...["Operating Systems", "DBMS", "Deep Learning", "Smart Retail", "Quantum Physics"],
      "Underwater Basket Weaving",
    ];

    for (const title of all) {
      const { accent, chip } = topicIdentity(title);
      expect(accent).toMatch(/^text-[a-z]+-(300|400)$/);
      expect(chip).toMatch(/^bg-[a-z]+-(300|400)\/10$/);
    }
  });

  it("pairs an accent with a matching chip", () => {
    for (const title of ["Operating Systems", "Smart Retail", "Internship Report"]) {
      const { accent, chip } = topicIdentity(title);
      const accentColour = accent.replace("text-", "").replace(/-(300|400)$/, "");
      const chipColour = chip.replace("bg-", "").replace(/-(300|400)\/10$/, "");
      expect(accentColour).toBe(chipColour);
    }
  });
});

describe("the known-icon palette is real", () => {
  it("resolves icons that exist in the installed library", () => {
    // Guards against a typo'd import silently rendering nothing.
    expect(topicIdentity("Operating Systems").Icon).toBe(Cpu);
    expect(topicIdentity("Internship Report").Icon).toBe(Briefcase);
    expect(topicIdentity("Some Unmatched Topic").Icon).toBeDefined();
    expect([BookOpen, Boxes, Atom, Sigma]).toContain(
      topicIdentity("Some Unmatched Topic").Icon,
    );
  });
});
