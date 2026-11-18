import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lint } from "../src/lint.js";

// ─── task 1 (plan 20261117-074): lint classifies Python, it does not parse it ──
// Python repos get the same honest classification rust got in 073: the JS
// parser cannot evaluate python, so a python-only scan must print a loud
// SKIPPED-PY line (stderr), exit 0 with an honest empty result — not fall
// through to JS rules over .py files (a vacuous pass or a parser crash).
// Mixed repos evaluate JS normally and the loud line notes the python skip.
// The JS zero-files loud guard keeps its 067 semantics.

const FIXTURE_ROOT = join(tmpdir(), "tdd-guard-task1-python-fixtures");

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

describe("lint python classification (task 1)", () => {
  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("lint_classifies_python_only_repo_as_skipped", () => {
    // Shape 1: pyproject.toml + test_app.py — every discovered test file is
    // python. Today: the scan falls through to the JS rules over .py files
    // (vacuous pass or crash); the contract is a loud SKIPPED-PY line, exit
    // 0, honest empty result.
    const proj = writeProject(["py-only"], {
      "pyproject.toml": [
        "[project]",
        "name = \"py-only\"",
        "version = \"0.1.0\"",
        "",
      ].join("\n"),
      "tests/test_app.py": [
        "def test_adds():",
        "    assert 1 + 1 == 2",
        "",
      ].join("\n"),
    }, DEFAULT_RULES);

    const prevCwd = process.cwd();
    try {
      process.chdir(proj);
      const { result, stderr } = captureStderr(() =>
        lint({ src: "src", tests: "tests", format: "json" }),
      );

      expect(result.exit_code).toBe(0);
      // Nothing was evaluated — an honest empty result, not a vacuous pass.
      expect(result.checks).toEqual([]);
      // Loud classification naming the command and the reason.
      expect(stderr).toContain("SKIPPED-PY");
      expect(stderr).toContain("lint");
      expect(stderr).toContain("JS parser cannot evaluate python");

      // Shape 2: pyproject.toml with python test files discovery cannot see
      // (no test_*/ *_test.py name) — zero JS-parseable files at a python
      // project still classifies skipped instead of loud-failing like a JS
      // repo would.
      const shape2 = writeProject(["py-only-unlisted"], {
        "pyproject.toml": [
          "[project]",
          "name = \"py-only-unlisted\"",
          "version = \"0.1.0\"",
          "",
        ].join("\n"),
        "tests/app_suite.py": [
          "def test_adds():",
          "    assert 1 + 1 == 2",
          "",
        ].join("\n"),
      }, DEFAULT_RULES);

      process.chdir(shape2);
      const shape2Run = captureStderr(() =>
        lint({ src: "src", tests: "tests", format: "json" }),
      );
      expect(shape2Run.result.exit_code).toBe(0);
      expect(shape2Run.result.checks).toEqual([]);
      expect(shape2Run.stderr).toContain("SKIPPED-PY");
      expect(shape2Run.stderr).toContain("JS parser cannot evaluate python");
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("lint_mixed_repo_evaluates_js_notes_python", () => {
    // JS violations are reported normally; the same loud channel notes the
    // python skip.
    const proj = writeProject(["mixed-js-py"], {
      "src/calc.ts": "export const add = (a: number, b: number) => a + b;\n",
      "tests/a.test.ts": VIOLATING_TEST,
      "tests/test_app.py": [
        "def test_adds():",
        "    assert 1 + 1 == 2",
        "",
      ].join("\n"),
    }, DEFAULT_RULES);

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

      // The loud line notes the python skip while the JS files were
      // evaluated normally.
      expect(stderr).toContain("SKIPPED-PY");
      expect(stderr).toContain("JS parser cannot evaluate python");
      expect(stderr).toContain("evaluated normally");
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("readme_documents_skipped_py", () => {
    const readme = readFileSync("README.md", "utf-8");
    expect(readme).toContain("SKIPPED-PY");
    expect(readme).toContain("pyproject.toml");
  });
});
