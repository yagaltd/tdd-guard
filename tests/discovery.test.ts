import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { lint } from "../src/lint.js";
import { mutate } from "../src/mutate.js";
import { verify } from "../src/verify.js";

// ─── task 2: discovery is one shared implementation ──────────────────────────
// lint's discovery (segment-precise .git/node_modules exclusion, tests/ →
// test/ → src-colocated probing, allowEmpty escape hatch) was the only correct
// one; verify and mutate hardcoded `tests` and never failed loudly on empty
// scans. These pins encode the shared contract: one module, consumed by all
// three commands, explicit --tests wins everywhere, zero files fails loudly
// everywhere.

const FIXTURE_ROOT = join(tmpdir(), "tdd-guard-task2-discovery");

function writeProject(
  relRoot: string[],
  files: Record<string, string>,
): string {
  const root = join(FIXTURE_ROOT, ...relRoot);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const readSrc = (p: string) => readFileSync(p, "utf-8");

describe("shared discovery (task 2)", () => {
  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("discovery_shared_by_all_three_commands", () => {
    const lintSrc = readSrc("src/lint.ts");
    const verifySrc = readSrc("src/verify.ts");
    const mutateSrc = readSrc("src/mutate.ts");
    const cliSrc = readSrc("src/cli.ts");

    for (const [name, source] of [
      ["lint", lintSrc],
      ["verify", verifySrc],
      ["mutate", mutateSrc],
    ] as const) {
      expect(
        source,
        `${name} must import the shared discovery module`,
      ).toMatch(/from "\.\/discovery\.js"/);
      expect(source, `${name} must call discoverTests`).toMatch(
        /discoverTests\(/,
      );
    }

    // No hardcoded `--tests` "tests" CLI default remains: probing is the
    // default everywhere and an explicit flag always wins.
    const hardcoded = cliSrc
      .split("\n")
      .filter((line) => /"tests"\)\s*$/.test(line));
    expect(
      hardcoded,
      `cli.ts must not hardcode a "tests" default: ${hardcoded.join("; ")}`,
    ).toEqual([]);

    // The legacy `options.tests || "tests"` fallbacks are gone too.
    expect(verifySrc).not.toMatch(/options\.tests \|\| "tests"/);
    expect(mutateSrc).not.toMatch(/options\.tests \|\| "tests"/);
  });

  test("explicit_tests_flag_wins_everywhere", () => {
    const prevCwd = process.cwd();

    // Project with only a test/ dir (no tests/): probing must find test/,
    // and an explicit (empty) --tests tests must fail loudly on every command.
    const proj = writeProject(["flag-wins"], {
      "src/calc.ts": "export const double = (n: number) => n * 2;\n",
      "test/calc.test.ts":
        'test("calc_doubles_test", () => { expect(2 * 2).toBe(4); });\n',
    });
    const specPath = join(proj, "task.spec");
    writeFileSync(
      specPath,
      [
        "Scenario: calc doubles",
        "  Test: calc_doubles_test",
        "",
      ].join("\n"),
    );

    try {
      process.chdir(proj);

      // Probing (no --tests): all three commands see test/calc.test.ts.
      const lintProbed = lint({ src: "src", format: "json" });
      expect(lintProbed.exit_code).toBe(0);

      const verifyProbed = verify({ spec: specPath, format: "json" });
      expect(verifyProbed.test_selectors[0]?.found).toBe(true);

      const mutateProbed = mutate({ src: "src", threshold: 60, since: "", config: "", format: "json" });
      expect(mutateProbed.command).toBe("mutate"); // no throw: discovery found the tests

      // Explicit --tests pointing at an empty dir: zero files → loud throw
      // on every command (probing skipped, the explicit root is used).
      expect(() =>
        lint({ src: "src", tests: "tests", format: "json" }),
      ).toThrow(/0 test files/);
      expect(() =>
        lint({ src: "src", tests: "tests", format: "json", allowEmpty: true }),
      ).not.toThrow();

      expect(() =>
        verify({ spec: specPath, tests: "tests", format: "json" }),
      ).toThrow(/0 test files/);

      expect(() =>
        mutate({
          src: "src",
          tests: "tests",
          threshold: 60,
          since: "",
          config: "",
          format: "json",
        }),
      ).toThrow(/0 test files/);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
