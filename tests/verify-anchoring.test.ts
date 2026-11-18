import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { verify } from "../src/verify.js";

// ─── task 1 (plan 20261117-074): selector match is word-anchored ─────────────
// verify's content leg resolved selectors with a bare
// `allTestContent.includes(s.selector)` — substring-loose, so selector
// `test_my_pin` false-positived on content containing only
// `test_my_pin_extended`. The fix: escape the selector and match between word
// boundaries (identifier-shaped selectors make escaping deterministic). The
// exact-name leg and the cargo-listing `::`-suffix leg (069) are unchanged.

describe("selector anchoring (task 1)", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "tdd-guard-task1-anchor-"));
  const specDir = mkdtempSync(join(tmpdir(), "tdd-guard-task1-anchor-spec-"));

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(specDir, { recursive: true, force: true });
  });

  test("verify_selector_match_is_word_anchored", () => {
    // Content contains ONLY the extended name; the bare selector must stay
    // not-found. Today: substring-true (red first).
    mkdirSync(join(projectDir, "tests"), { recursive: true });
    writeFileSync(
      join(projectDir, "tests", "anchoring.test.ts"),
      [
        'test("test_my_pin_extended", () => {',
        "  expect(1 + 1).toBe(2);",
        "});",
        "",
      ].join("\n"),
    );

    const specPath = join(specDir, "anchoring.spec");
    writeFileSync(
      specPath,
      [
        "Scenario: selector must not substring-match a longer name",
        "  Test: test_my_pin",
        "",
      ].join("\n"),
    );

    const prevCwd = process.cwd();
    process.chdir(projectDir);
    try {
      const result = verify({ spec: specPath, format: "json" });

      expect(result.test_selectors.map((s) => [s.selector, s.found])).toEqual([
        ["test_my_pin", false],
      ]);
      expect(result.exit_code).toBe(1);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("verify_exact_and_suffix_legs_unchanged", () => {
    // Regression pin (069 fixture): the exact listing entry (`adds_bare`) and
    // the `::`-anchored suffix leg (`test_my_pin` against
    // `spec_verify::boundaries::tests::test_my_pin`) still resolve found=true.
    const specPath = join(specDir, "regression.spec");
    writeFileSync(
      specPath,
      [
        "Scenario: exact listing entry resolves",
        "  Test: adds_bare",
        "",
        "Scenario: bare selector resolves against module-path entry",
        "  Test: test_my_pin",
        "",
      ].join("\n"),
    );

    const prevCwd = process.cwd();
    process.chdir(join("tests", "fixtures", "rust-listing"));
    try {
      const result = verify({ spec: specPath, format: "json" });

      expect(result.test_selectors.map((s) => [s.selector, s.found])).toEqual([
        ["adds_bare", true],
        ["test_my_pin", true],
      ]);
      expect(result.exit_code).toBe(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
