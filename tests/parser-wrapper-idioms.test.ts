import { describe, expect, test } from "vitest";
import { parseTestFile } from "../src/parser.js";
import { ruleNoAssertionlessTests } from "../src/rules/no-assertionless-tests.js";
import { DEFAULT_CONFIG } from "../src/types.js";

// Plan 20261117-074 task 2 — conditional test-wrapper idioms
// (test.skipIf(cond)(name, fn), test.runIf(...), test.each(...)) used to
// extract as anonymous assertionless phantom blocks: the parser classified
// the inner wrapper invocation and could not bind the outer call's name and
// body. pi-workflows' requireLiveState pattern produced 11 such false
// positives on its real suite.

describe("parser — conditional wrapper idioms (task 2)", () => {
  const block = (
    parsed: ReturnType<typeof parseTestFile>,
    name: string,
  ) => parsed.testBlocks.find((b) => b.name === name);

  test("parser_unwraps_skipif_idiom_with_assertions", () => {
    const parsed = parseTestFile("tests/fixtures/parser-skipif-idiom.test.ts");
    const b = block(parsed, "wrapped test with real assertions");
    expect(b, "wrapped block must extract with its real name").toBeDefined();
    expect(b?.skipped).toBe(false);
    expect(b?.hasAssertions).toBe(true);
    // the wrapper invocation itself must never yield a phantom block
    const phantoms = parsed.testBlocks.filter((x) => x.name.startsWith("anonymous-"));
    expect(phantoms, JSON.stringify(parsed.testBlocks)).toHaveLength(0);
  });

  test("parser_still_flags_empty_body_inside_idiom", () => {
    const parsed = parseTestFile("tests/fixtures/parser-skipif-idiom.test.ts");
    const b = block(parsed, "wrapped test with empty body");
    expect(b, "empty-body wrapped block must still extract").toBeDefined();
    expect(b?.skipped).toBe(false);
    expect(b?.hasAssertions).toBe(false);
    // and the no-assertionless rule still fires on it (negative pin — no weakening)
    const violations = ruleNoAssertionlessTests(
      [],
      ["tests/fixtures/parser-skipif-idiom.test.ts"],
      DEFAULT_CONFIG,
    );
    expect(
      violations.some((v) => v.line === b?.line),
      JSON.stringify(violations),
    ).toBe(true);
  });

  test("parser_unwraps_runif_each_fails", () => {
    const parsed = parseTestFile("tests/fixtures/parser-runif-each-fails-idiom.test.ts");
    for (const name of [
      "runIf wrapped with real assertion",
      "each wrapped with real assertion %d",
      "fails variant with real assertion",
    ]) {
      const b = block(parsed, name);
      expect(b, name).toBeDefined();
      expect(b?.hasAssertions, name).toBe(true);
    }
    const phantoms = parsed.testBlocks.filter((x) => x.name.startsWith("anonymous-"));
    expect(phantoms, JSON.stringify(parsed.testBlocks)).toHaveLength(0);
  });
});
