import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  cargoTestSelectors,
  parseCargoTestListing,
  verify,
} from "../src/verify.js";

// ─── task 2: the Rust binding ─────────────────────────────────────────────────
// verify resolved `Test:` selectors by JS-parsing test files, so Rust tests
// were invisible: every verify run over a cargo project reported its selectors
// not-found (three independent reviews hit this). The binding: in a cargo
// project, selectors resolve against the runner's own inventory —
// `cargo test --quiet -- --list` — not JS parsing.

const FIXTURE = join("tests", "fixtures", "rust-listing");

describe("rust binding (task 2)", () => {
  const specDir = mkdtempSync(join(tmpdir(), "tdd-guard-task2-rust-"));

  afterAll(() => {
    rmSync(specDir, { recursive: true, force: true });
  });

  test("parse_cargo_listing_terse_format", () => {
    // `cargo test --quiet -- --list` output: one `name: test` line per test.
    const names = parseCargoTestListing(
      "adds_bare: test\ntests::adds_inline: test\n",
    );
    expect(names).toEqual(["adds_bare", "tests::adds_inline"]);
  });

  test("parse_cargo_listing_default_format", () => {
    // Default (non-quiet) listing adds blank lines and libtest summary lines —
    // those must never become selectors.
    const listing = [
      "adds_bare: test",
      "tests::adds_inline: test",
      "",
      "2 tests, 0 benchmarks",
      "0 tests, 0 benchmarks",
      "",
    ].join("\n");
    const names = parseCargoTestListing(listing);
    expect(names).toEqual(["adds_bare", "tests::adds_inline"]);
  });

  test("inline_cfg_test_modules_found", () => {
    // The fixture declares both a bare #[test] fn and a #[cfg(test)] inline
    // module; the listing must contain both selectors.
    const selectors = cargoTestSelectors(FIXTURE);
    expect(selectors.has("adds_bare")).toBe(true);
    expect(selectors.has("tests::adds_inline")).toBe(true);
  });

  test("rust_selectors_resolve_via_cargo_listing", () => {
    const specPath = join(specDir, "rust.spec");
    writeFileSync(
      specPath,
      [
        "Scenario: bare test resolves via listing",
        "  Test: adds_bare",
        "",
        "Scenario: inline cfg-test test resolves via listing",
        "  Test: tests::adds_inline",
        "",
      ].join("\n"),
    );
    mkdirSync(specDir, { recursive: true });

    const prevCwd = process.cwd();
    process.chdir(FIXTURE);
    try {
      // JS discovery finds zero test files here (the crate has no JS test
      // files), so a `found` verdict can only come from the cargo listing.
      const result = verify({ spec: specPath, format: "json" });

      expect(result.test_selectors.map((s) => [s.selector, s.found])).toEqual([
        ["adds_bare", true],
        ["tests::adds_inline", true],
      ]);
      expect(result.exit_code).toBe(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
