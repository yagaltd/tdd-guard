import { afterAll, describe, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lint } from "../src/lint.js";

describe("lint", () => {
  test("reports fixture test quality violations", () => {
    const result = lint({
      src: "tests/fixtures/src",
      tests: "tests/fixtures/tests",
      config: "tests/fixtures/.tdd-guard.json",
      format: "json",
    });

    expect(result.exit_code).toBe(1);
    expect(result.checks.map((check) => check.rule)).toContain("no-internal-mocks");
    expect(result.checks.find((check) => check.rule === "no-skipped-tests")?.status).toBe("fail");
    expect(result.checks.find((check) => check.rule === "no-assertionless-tests")?.status).toBe("fail");
  });
});

// ─── task 3: the vacuous-lint defect ─────────────────────────────────────────
// `!f.includes(".git")` ran on ABSOLUTE paths, so any lint run from a cwd whose
// path contains `.git` — e.g. EVERY pi subagent worktree
// <repo>/.git/subagents/<run>/<worker>/ — filtered out ALL test files → 0 files
// → every rule passed vacuously. The same substring also swallowed legit
// `.github/` paths. These pins encode the fixed contract: segment-exact
// exclusion, discovery probing, and a loud zero-files failure.

const FIXTURE_ROOT = join(tmpdir(), "tdd-guard-task3-fixtures");

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

describe("vacuous-lint defect (task 3)", () => {
  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("lint_finds_tests_under_dot_git_cwd", () => {
    // Fixture project lives under a path containing a real `.git` component,
    // exactly like a pi subagent worktree.
    const proj = writeProject([".git", "subagents", "run_x", "worker"], {
      "src/index.ts": "export const add = (a: number, b: number) => a + b;\n",
      "tests/a.test.ts": VIOLATING_TEST,
    }, DEFAULT_RULES);

    const result = lint({
      src: join(proj, "src"),
      tests: join(proj, "tests"),
      config: join(proj, ".tdd-guard.json"),
      format: "json",
    });

    // Lint must FIND the violating fixture and report it (today: 0 files →
    // vacuous pass with every rule green).
    const skipped = result.checks.find((c) => c.rule === "no-skipped-tests");
    expect(skipped?.status).toBe("fail");
    expect(skipped?.violations.some((v) => v.file.endsWith("tests/a.test.ts"))).toBe(true);
    expect(result.exit_code).toBe(1);
  });

  test("lint_filter_is_segment_precise", () => {
    const proj = writeProject([".git", "subagents", "run_segp", "worker"], {
      "src/digit.ts": "export function digit(n: number) { return n * 2; }\n",
      "tests/.github/workflows/check.test.ts":
        'test.skip("ci gate", () => { expect(1).toBe(1); });\n',
      "tests/sanity.test.ts": 'test("two plus two", () => { expect(2 + 2).toBe(4); });\n',
    }, { ...DEFAULT_RULES, public_api_exports: ["src/digit.ts"] });

    const result = lint({
      src: join(proj, "src"),
      tests: join(proj, "tests"),
      config: join(proj, ".tdd-guard.json"),
      format: "json",
    });

    // A `.github` component is not a `.git` component — the file survives.
    const skipped = result.checks.find((c) => c.rule === "no-skipped-tests")!;
    expect(skipped.violations.some((v) => v.file.includes(".github/"))).toBe(true);

    // A segment merely CONTAINING "git" (digit.ts) is what a naive substring
    // fix would wrongly exclude — segment-exact matching keeps it visible.
    const perExport = result.checks.find((c) => c.rule === "test-per-export")!;
    expect(perExport.status).toBe("warn");
    expect(perExport.violations.some((v) => v.file.endsWith("digit.ts"))).toBe(true);
  });

  test("discovery_probes_test_dir_then_src", () => {
    const prevCwd = process.cwd();

    // Probe test/ when tests/ is absent and --tests is not passed.
    const projProbe = writeProject(["probe-test-dir"], {
      "src/calc.ts": "export const double = (n: number) => n * 2;\n",
      "test/calc.test.ts": VIOLATING_TEST,
    }, DEFAULT_RULES);
    try {
      process.chdir(projProbe);
      const probed = lint({
        src: "src",
        config: join(projProbe, ".tdd-guard.json"),
        format: "json",
      });
      const skipped = probed.checks.find((c) => c.rule === "no-skipped-tests");
      expect(skipped?.status).toBe("fail");
      expect(skipped?.violations.some((v) => v.file.endsWith("test/calc.test.ts"))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }

    // Pin: a project with only src-colocated tests is found without flags.
    const projColocated = writeProject(["colocated-only"], {
      "src/calc.ts": "export const double = (n: number) => n * 2;\n",
      "src/calc.test.ts": VIOLATING_TEST,
    }, DEFAULT_RULES);
    try {
      process.chdir(projColocated);
      const colocated = lint({
        src: "src",
        config: join(projColocated, ".tdd-guard.json"),
        format: "json",
      });
      const skipped = colocated.checks.find((c) => c.rule === "no-skipped-tests");
      expect(skipped?.status).toBe("fail");
      expect(skipped?.violations.some((v) => v.file.endsWith("src/calc.test.ts"))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }

    // Pin: an explicit --tests flag always wins over probing.
    const projBoth = writeProject(["flag-wins"], {
      "src/lib.ts": "export const tri = (n: number) => n * 3;\n",
      "tests/a.test.ts": VIOLATING_TEST,
      "test/b.test.ts": VIOLATING_TEST,
    }, DEFAULT_RULES);
    try {
      process.chdir(projBoth);
      const fromTests = lint({
        src: "src",
        tests: "tests",
        config: join(projBoth, ".tdd-guard.json"),
        format: "json",
      });
      const skippedTests = fromTests.checks.find((c) => c.rule === "no-skipped-tests")!;
      expect(skippedTests.violations.some((v) => v.file.endsWith("tests/a.test.ts"))).toBe(true);
      expect(skippedTests.violations.some((v) => v.file.endsWith("test/b.test.ts"))).toBe(false);

      const fromTest = lint({
        src: "src",
        tests: "test",
        config: join(projBoth, ".tdd-guard.json"),
        format: "json",
      });
      const skippedTest = fromTest.checks.find((c) => c.rule === "no-skipped-tests")!;
      expect(skippedTest.violations.some((v) => v.file.endsWith("test/b.test.ts"))).toBe(true);
      expect(skippedTest.violations.some((v) => v.file.endsWith("tests/a.test.ts"))).toBe(false);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("lint_zero_files_fails_loudly", () => {
    const proj = writeProject(["zero-files"], {
      "src/only.ts": "export const id = (x: number) => x;\n",
    }, DEFAULT_RULES);

    let message = "";
    try {
      lint({
        src: join(proj, "src"),
        tests: join(proj, "tests"),
        config: join(proj, ".tdd-guard.json"),
        format: "json",
      });
    } catch (err) {
      message = (err as Error).message;
    }

    // Loud failure naming the scanned roots — never a silent green.
    expect(message).toContain("0 test files");
    expect(message).toContain(join(proj, "tests"));
    expect(message).toContain(join(proj, "src"));

    // --allow-empty escapes the guard explicitly.
    const allowed = lint({
      src: join(proj, "src"),
      tests: join(proj, "tests"),
      config: join(proj, ".tdd-guard.json"),
      format: "json",
      allowEmpty: true,
    });
    expect(allowed.exit_code).toBe(0);
  });
});
