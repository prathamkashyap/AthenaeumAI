/**
 * Unit Tests — topicNormalizationService
 * Tests the normalizeTopic and toTitleCase functions with full edge-case coverage.
 */

import { normalizeTopic, toTitleCase } from "../../services/topicNormalizationService.js";

describe("toTitleCase", () => {
  test("converts a lowercase string to title case", () => {
    expect(toTitleCase("operating systems")).toBe("Operating Systems");
  });

  test("converts an all-caps string to title case", () => {
    expect(toTitleCase("DATA STRUCTURES")).toBe("Data Structures");
  });

  test("handles single word", () => {
    expect(toTitleCase("algorithms")).toBe("Algorithms");
  });

  test("returns empty string for empty input", () => {
    expect(toTitleCase("")).toBe("");
  });

  test("returns empty string for null input", () => {
    expect(toTitleCase(null)).toBe("");
  });

  test("returns empty string for undefined input", () => {
    expect(toTitleCase(undefined)).toBe("");
  });

  test("preserves existing title case", () => {
    expect(toTitleCase("Machine Learning")).toBe("Machine Learning");
  });
});

describe("normalizeTopic — known abbreviation mappings", () => {
  test("normalizes 'os' to 'Operating Systems'", () => {
    expect(normalizeTopic("os")).toBe("Operating Systems");
  });

  test("normalizes 'OS' (case-insensitive) to 'Operating Systems'", () => {
    expect(normalizeTopic("OS")).toBe("Operating Systems");
  });

  test("normalizes 'dsa' to 'Data Structures & Algorithms'", () => {
    expect(normalizeTopic("dsa")).toBe("Data Structures & Algorithms");
  });

  test("normalizes 'algorithms' to 'Data Structures & Algorithms'", () => {
    expect(normalizeTopic("algorithms")).toBe("Data Structures & Algorithms");
  });

  test("normalizes 'data structures' to 'Data Structures & Algorithms'", () => {
    expect(normalizeTopic("data structures")).toBe("Data Structures & Algorithms");
  });

  test("normalizes 'cn' to 'Computer Networks'", () => {
    expect(normalizeTopic("cn")).toBe("Computer Networks");
  });

  test("normalizes 'network' to 'Computer Networks'", () => {
    expect(normalizeTopic("network")).toBe("Computer Networks");
  });

  test("normalizes 'computer network' to 'Computer Networks'", () => {
    expect(normalizeTopic("computer network")).toBe("Computer Networks");
  });

  test("normalizes 'dbms' to 'DBMS'", () => {
    expect(normalizeTopic("dbms")).toBe("DBMS");
  });

  test("normalizes 'database' to 'DBMS'", () => {
    expect(normalizeTopic("database")).toBe("DBMS");
  });

  test("normalizes 'database management system' to 'DBMS'", () => {
    expect(normalizeTopic("database management system")).toBe("DBMS");
  });

  test("normalizes 'nlp' to 'Natural Language Processing'", () => {
    expect(normalizeTopic("nlp")).toBe("Natural Language Processing");
  });

  test("normalizes 'dl' to 'Deep Learning'", () => {
    expect(normalizeTopic("dl")).toBe("Deep Learning");
  });

  test("normalizes 'cv' to 'Computer Vision'", () => {
    expect(normalizeTopic("cv")).toBe("Computer Vision");
  });
});

describe("normalizeTopic — fallback behaviour", () => {
  test("falls back to title case for unknown topic", () => {
    expect(normalizeTopic("quantum computing")).toBe("Quantum Computing");
  });

  test("trims whitespace before normalizing", () => {
    expect(normalizeTopic("  os  ")).toBe("Operating Systems");
  });

  test("returns 'General' for null input", () => {
    expect(normalizeTopic(null)).toBe("General");
  });

  test("returns 'General' for undefined input", () => {
    expect(normalizeTopic(undefined)).toBe("General");
  });

  test("returns 'General' for empty string", () => {
    expect(normalizeTopic("")).toBe("General");
  });

  test("returns 'General' for numeric input", () => {
    expect(normalizeTopic(42)).toBe("General");
  });

  test("falls back gracefully for a long unknown topic", () => {
    const result = normalizeTopic("advanced distributed systems and microservices");
    expect(result).toBe("Advanced Distributed Systems And Microservices");
  });
});
