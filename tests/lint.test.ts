import { describe, expect, test } from "vitest";
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

