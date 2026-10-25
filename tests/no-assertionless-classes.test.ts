/**
 * Contract tests for the no-assertionless-tests parser fix (task-3.spec).
 *
 * Four documented false-positive classes (pi-workflows plan 013 T4 R4):
 *   1. destructuring-from-call statements
 *   2. template-literal interpolation in test bodies
 *   3. nested object/array literals
 *   4. unicode identifiers
 * Fixtures live in tests/fixtures/parser-edge-cases.test.js — each class has a
 * block there that MUST be recognized as asserted (no finding reported).
 *
 * The acceptance fixture tests/fixtures/acceptance/pi-workflows-extension.test.ts
 * is a verbatim copy of pi-workflows tests/extension.test.ts — the real-world
 * corpus that produced 22 false positives under the old heuristic parser.
 * It must yield zero no-assertionless-tests findings while its test blocks are
 * still actually extracted (guards against vacuous passes from parse failures).
 */
import { describe, expect, test } from "vitest";
import { parseTestFile } from "../src/parser.js";
import { ruleNoAssertionlessTests } from "../src/rules/no-assertionless-tests.js";
import { loadConfig } from "../src/config.js";

const FIXTURE = "tests/fixtures/parser-edge-cases.test.js";
const ACCEPTANCE = "tests/fixtures/acceptance/pi-workflows-extension.test.ts";
const config = loadConfig();

function blockLine(file: string, blockName: string): number | undefined {
  const parsed = parseTestFile(file);
  const block = parsed.testBlocks.find((b) => b.name === blockName);
  return block?.line;
}

function findingsFor(file: string) {
  return ruleNoAssertionlessTests([], [file], config);
}

/** The named fixture block must be extracted, seen as asserted, and not flagged. */
function expectCleanBlock(blockName: string): void {
  const line = blockLine(FIXTURE, blockName);
  expect(line, `fixture block "${blockName}" must be extracted`).toBeDefined();
  const findings = findingsFor(FIXTURE);
  const hit = findings.find((f) => f.line === line);
  expect(
    hit,
    `no-assertionless-tests must not flag "${blockName}": ${hit?.message ?? ""}`,
  ).toBeUndefined();
}

describe("no-assertionless-tests parser fix (task-3)", () => {
  test("handles destructuring from call statements as asserted tests", () => {
    expectCleanBlock("destructuring with real assertion");
  });

  test("handles template interpolation in test bodies", () => {
    expectCleanBlock("template interpolation with real assertion");
  });

  test("handles nested object and array literals", () => {
    expectCleanBlock("deeply nested literals with real assertion");
  });

  test("handles unicode identifiers", () => {
    expectCleanBlock("unicode identifiers with real assertion");
  });

  test("still flags truly assertionless tests", () => {
    const line = blockLine(FIXTURE, "genuinely assertionless");
    expect(line, "control block must be extracted").toBeDefined();
    const findings = findingsFor(FIXTURE);
    const hit = findings.find((f) => f.line === line);
    expect(hit, "the assertionless control test must be flagged").toBeDefined();
    expect(hit?.message).toContain("genuinely assertionless");
  });

  test("pi-workflows acceptance corpus: blocks extracted, zero findings", () => {
    const parsed = parseTestFile(ACCEPTANCE);
    // Non-vacuous: the corpus must actually yield test blocks. A parse failure
    // would silently return [] and make the zero-findings assert meaningless.
    expect(
      parsed.testBlocks.length,
      "acceptance fixture must extract test blocks (real-world corpus)",
    ).toBeGreaterThan(0);
    const findings = findingsFor(ACCEPTANCE);
    expect(findings).toEqual([]);
  });
});
