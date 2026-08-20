import { describe, expect, test } from "vitest";
import { parseTestFile } from "../src/parser.js";

describe("parseTestFile — no-assertionless-tests parser", () => {
  const parsed = parseTestFile("tests/fixtures/parser-edge-cases.test.js");

  const block = (name: string) =>
    parsed.testBlocks.find((b) => b.name === name);

  test("does not flag a test with destructuring + object literal + real assertion", () => {
    const b = block("destructuring with real assertion");
    expect(b).toBeDefined();
    expect(b?.hasAssertions).toBe(true);
  });

  test("does not flag a test with object literal + real assertion", () => {
    const b = block("object literal with real assertion");
    expect(b).toBeDefined();
    expect(b?.hasAssertions).toBe(true);
  });

  test("does not flag a test with } inside string/comment + real assertion", () => {
    const b = block("brace inside string and comment with real assertion");
    expect(b).toBeDefined();
    expect(b?.hasAssertions).toBe(true);
  });

  test("still flags a genuinely assertionless test", () => {
    const b = block("genuinely assertionless");
    expect(b).toBeDefined();
    expect(b?.hasAssertions).toBe(false);
  });

  test("still marks skipped tests as skipped (not assertionless-violations)", () => {
    const b = block("skipped test with no assertion");
    expect(b).toBeDefined();
    expect(b?.skipped).toBe(true);
  });
});
