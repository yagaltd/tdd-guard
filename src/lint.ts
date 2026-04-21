/**
 * tdd-guard lint engine
 * Runs all enabled rules and collects results
 */
import { resolve } from "node:path";
import { globSync } from "glob";
import { TddGuardConfig, RuleResult, LintResult, Violation, LintOptions } from "./types.js";
import { loadConfig } from "./config.js";
import { ruleNoInternalMocks } from "./rules/no-internal-mocks.js";
import { ruleNoSkippedTests } from "./rules/no-skipped-tests.js";
import { ruleNoAssertionlessTests } from "./rules/no-assertionless-tests.js";
import { rulePublicInterfaceOnly } from "./rules/public-interface-only.js";
import { ruleTestPerExport } from "./rules/test-per-export.js";
import { ruleNoImplementationCoupling } from "./rules/no-implementation-coupling.js";

type RuleFn = (
  srcFiles: string[],
  testFiles: string[],
  config: TddGuardConfig,
) => Violation[];

const RULE_REGISTRY: Record<string, RuleFn> = {
  "no-internal-mocks": ruleNoInternalMocks,
  "no-skipped-tests": ruleNoSkippedTests,
  "no-assertionless-tests": ruleNoAssertionlessTests,
  "public-interface-only": rulePublicInterfaceOnly,
  "test-per-export": ruleTestPerExport,
  "no-implementation-coupling": ruleNoImplementationCoupling,
};

export function lint(options: LintOptions): LintResult {
  const config = loadConfig(options.config || undefined);
  const srcDir = resolve(options.src || "src");
  const testDir = resolve(options.tests || "tests");

  // Collect source files
  const srcPatterns = ["**/*.{ts,tsx,js,jsx,rs,py}"];
  const srcFiles = globSync(srcPatterns, { cwd: srcDir, absolute: true })
    .filter((f) => !f.includes("node_modules") && !f.includes(".git"));

  // Collect test files
  const testPatterns = [
    "**/*.{test,spec}.{ts,tsx,js,jsx}",
    "**/tests/**/*.rs",
    "**/test_*.py",
    "**/*_test.py",
  ];
  const testFiles = globSync(testPatterns, { cwd: testDir, absolute: true })
    .filter((f) => !f.includes("node_modules") && !f.includes(".git"));

  // Also check for colocated tests inside src
  const colocatedTests = globSync(testPatterns, { cwd: srcDir, absolute: true })
    .filter((f) => !f.includes("node_modules") && !f.includes(".git"));
  const allTestFiles = [...new Set([...testFiles, ...colocatedTests])];

  const checks: RuleResult[] = [];
  let hasError = false;

  for (const [ruleName, severity] of Object.entries(config.lint.rules)) {
    if (severity === "off") continue;

    const ruleFn = RULE_REGISTRY[ruleName];
    if (!ruleFn) {
      checks.push({ rule: ruleName, status: "pass", violations: [] });
      continue;
    }

    const violations = ruleFn(srcFiles, allTestFiles, config);

    // Apply configured severity
    const annotated = violations.map((v) => ({
      ...v,
      severity: severity as "error" | "warn",
    }));

    const errors = annotated.filter((v) => v.severity === "error");
    const warns = annotated.filter((v) => v.severity === "warn");

    let status: "pass" | "fail" | "warn" = "pass";
    if (errors.length > 0) {
      status = "fail";
      hasError = true;
    } else if (warns.length > 0) {
      status = "warn";
    }

    checks.push({ rule: ruleName, status, violations: annotated });
  }

  return {
    command: "lint",
    exit_code: hasError ? 1 : 0,
    checks,
  };
}
