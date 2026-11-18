import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lint } from "../src/lint.js";

// ─── task 3 (plan 20261117-073): lint classifies Rust, it does not parse it ──
// lint loud-failed on Rust repos: discovery cannot see rust test files from
// inside the test dir (the `**/tests/**/*.rs` pattern needs a `tests` segment
// relative to the scan root), so every cargo repo hit the 067 zero-files guard
// — exit 1 "found 0 test files" — and `--allow-empty` on a cargo repo printed
// a dishonest vacuous green. The contract: classify SKIPPED-RUST with a loud
// line naming the command and reason, exit 0; JS zero-files guard unchanged;
// mixed repos evaluate JS normally and note the rust skip.

const FIXTURE_ROOT = join(tmpdir(), "tdd-guard-task3-rust-fixtures");

const VIOLATING_TEST = [
  'test("passes with assertion", () => { expect(1 + 1).toBe(2); });',
  'test.skip("skipped violation", () => { expect(2 + 2).toBe(4); });',
  "",
].join("\n");

const DEFAULT_RULES = {
  boundary_modules: [],
  public_api_exports: [],
  internal_paths: [],
  lint: {
    rules: {
      "no-internal-mocks": "error",
      "no-skipped-tests": "error",
      "no-assertionless-tests": "error",
      "public-interface-only": "error",
      "test-per-export": "warn",
      "no-implementation-coupling": "warn",
    },
  },
};

function writeProject(
  relRoot: string[],
  files: Record<string, string>,
  config: object,
): string {
  const root = join(FIXTURE_ROOT, ...relRoot);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  writeFileSync(join(root, ".tdd-guard.json"), JSON.stringify(config));
  return root;
}

function captureStderr<T>(fn: () => T): { result: T; stderr: string } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    return { result: fn(), stderr: lines.join("\n") };
  } finally {
    spy.mockRestore();
  }
}

describe("lint rust classification (task 3)", () => {
  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("lint_classifies_rust_only_repo_as_skipped", () => {
    // Shape 1: the tracked rust-listing fixture — a cargo repo whose tests
    // are src-colocated rust files. Today: exit 1 "found 0 test files".
    const prevCwd = process.cwd();
    const listingFixture = join(prevCwd, "tests", "fixtures", "rust-listing");
    const overmatchFixture = join(prevCwd, "tests", "fixtures", "rust-overmatch");
    try {
      process.chdir(listingFixture);
      const { result, stderr } = captureStderr(() =>
        lint({ src: "src", format: "json" }),
      );

      expect(result.exit_code).toBe(0);
      // Nothing was evaluated — an honest empty result, not a vacuous pass.
      expect(result.checks).toEqual([]);
      // Loud classification naming the command and the reason.
      expect(stderr).toContain("SKIPPED-RUST");
      expect(stderr).toContain("lint");
      expect(stderr).toContain("JS parser cannot evaluate rust");

      // Shape 2: rust integration tests under tests/ (rust-overmatch fixture).
      process.chdir(overmatchFixture);
      const overmatch = captureStderr(() => lint({ src: "src", format: "json" }));
      expect(overmatch.result.exit_code).toBe(0);
      expect(overmatch.result.checks).toEqual([]);
      expect(overmatch.stderr).toContain("SKIPPED-RUST");
      expect(overmatch.stderr).toContain("JS parser cannot evaluate rust");
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("lint_zero_files_still_fails_loud_for_js", () => {
    // A JavaScript repo with no test files keeps the 067 loud guard — the
    // rust classification must not weaken it. No Cargo.toml anywhere in the
    // scan chain (repo root has none; the fixture project has none).
    const proj = writeProject(["js-zero-files"], {
      "src/only.ts": "export const id = (x: number) => x;\n",
    }, DEFAULT_RULES);

    let message = "";
    let exitCode: number | undefined;
    try {
      const { result } = captureStderr(() =>
        lint({
          src: join(proj, "src"),
          tests: join(proj, "tests"),
          config: join(proj, ".tdd-guard.json"),
          format: "json",
        }),
      );
      exitCode = result.exit_code;
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("0 test files");
    expect(message).toContain(join(proj, "tests"));
    expect(message).toContain(join(proj, "src"));
    expect(exitCode).toBeUndefined();
  });

  test("lint_mixed_repo_evaluates_js_notes_rust", () => {
    const proj = writeProject(["mixed-js-rust"], {
      "Cargo.toml": [
        "[package]",
        "name = \"mixed-js-rust\"",
        "version = \"0.1.0\"",
        "edition = \"2021\"",
        "",
      ].join("\n"),
      "src/calc.ts": "export const add = (a: number, b: number) => a + b;\n",
      "tests/a.test.ts": VIOLATING_TEST,
      "tests/integration.rs": [
        "#[test]",
        "fn adds_two() {",
        "    assert_eq!(add(1, 1), 2);",
        "}",
        "",
      ].join("\n"),
    }, DEFAULT_RULES);

    // The classification is cwd-based (Cargo.toml at cwd), like a real CLI
    // run from the mixed repo's root.
    const prevCwd = process.cwd();
    try {
      process.chdir(proj);
      const { result, stderr } = captureStderr(() =>
        lint({ src: "src", tests: "tests", format: "json" }),
      );

    // JS files are evaluated normally: the skipped test is reported.
    const skipped = result.checks.find((c) => c.rule === "no-skipped-tests");
    expect(skipped?.status).toBe("fail");
    expect(
      skipped?.violations.some((v) => v.file.endsWith("tests/a.test.ts")),
    ).toBe(true);
    expect(result.exit_code).toBe(1);

    // The same loud channel notes the rust skip: the JS parser cannot
    // evaluate rust (Cargo.toml marks the rust side), while the JS files
    // were evaluated normally.
    expect(stderr).toContain("SKIPPED-RUST");
    expect(stderr).toContain("JS parser cannot evaluate rust");
    expect(stderr).toContain("evaluated normally");
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("readme_documents_rust_classification", () => {
    const readme = readFileSync("README.md", "utf-8");
    expect(readme).toContain("SKIPPED-RUST");
    expect(readme).toContain("lint");
    expect(readme).toContain("Cargo.toml");
  });
});
