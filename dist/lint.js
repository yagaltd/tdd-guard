/**
 * tdd-guard lint engine
 * Runs all enabled rules and collects results
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "glob";
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules"]);
function isExcluded(scanRoot, file) {
    const rel = relative(scanRoot, file);
    return rel.split(/[\\/]/).some((seg) => EXCLUDED_SEGMENTS.has(seg));
}
import { loadConfig } from "./config.js";
import { ruleNoInternalMocks } from "./rules/no-internal-mocks.js";
import { ruleNoSkippedTests } from "./rules/no-skipped-tests.js";
import { ruleNoAssertionlessTests } from "./rules/no-assertionless-tests.js";
import { rulePublicInterfaceOnly } from "./rules/public-interface-only.js";
import { ruleTestPerExport } from "./rules/test-per-export.js";
import { ruleNoImplementationCoupling } from "./rules/no-implementation-coupling.js";
const RULE_REGISTRY = {
    "no-internal-mocks": ruleNoInternalMocks,
    "no-skipped-tests": ruleNoSkippedTests,
    "no-assertionless-tests": ruleNoAssertionlessTests,
    "public-interface-only": rulePublicInterfaceOnly,
    "test-per-export": ruleTestPerExport,
    "no-implementation-coupling": ruleNoImplementationCoupling,
};
/**
 * Run all enabled rules over the discovered test files.
 *
 * @cc [label:lint-discovery] segment-exact-exclusion
 * Exclusion matches whole path components exactly (`.git`, `node_modules`) on
 * each glob hit's path relative to its scan root — never substring matching on
 * absolute paths. A lint run from <repo>/.git/subagents/<run>/<worker> (any pi
 * subagent worktree) must still see the project's test files; `.github/` and
 * names merely containing "git" (e.g. digit.ts) survive.
 *
 * @cc [label:lint-discovery] zero-files-loud-failure
 * A lint run that discovers zero test files throws (CLI exits non-zero) with a
 * message naming the scanned roots, unless options.allowEmpty is set — lint
 * never passes vacuously on an empty scan.
 */
export function lint(options) {
    const config = loadConfig(options.config || undefined);
    const srcDir = resolve(options.src || "src");
    // Test discovery: an explicit --tests always wins; otherwise probe tests/,
    // then test/, then fall back to src-colocated scanning.
    const testDir = options.tests !== undefined && options.tests !== ""
        ? resolve(options.tests)
        : existsSync(resolve("tests"))
            ? resolve("tests")
            : existsSync(resolve("test"))
                ? resolve("test")
                : srcDir;
    // Collect source files
    const srcPatterns = ["**/*.{ts,tsx,js,jsx,rs,py}"];
    const srcFiles = globSync(srcPatterns, { cwd: srcDir, absolute: true, dot: true })
        .filter((f) => !isExcluded(srcDir, f));
    // Collect test files
    const testPatterns = [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/tests/**/*.rs",
        "**/test_*.py",
        "**/*_test.py",
    ];
    const testFiles = globSync(testPatterns, { cwd: testDir, absolute: true, dot: true })
        .filter((f) => !isExcluded(testDir, f));
    // Also check for colocated tests inside src
    const colocatedTests = globSync(testPatterns, { cwd: srcDir, absolute: true, dot: true })
        .filter((f) => !isExcluded(srcDir, f));
    const allTestFiles = [...new Set([...testFiles, ...colocatedTests])];
    if (allTestFiles.length === 0 && !options.allowEmpty) {
        const roots = [...new Set([testDir, srcDir])].join(", ");
        throw new Error(`tdd-guard lint found 0 test files. Scanned roots: ${roots}. ` +
            "A lint run that sees no tests proves nothing — check the paths, or pass " +
            "--allow-empty to accept an empty scan.");
    }
    const checks = [];
    let hasError = false;
    for (const [ruleName, severity] of Object.entries(config.lint.rules)) {
        if (severity === "off")
            continue;
        const ruleFn = RULE_REGISTRY[ruleName];
        if (!ruleFn) {
            checks.push({ rule: ruleName, status: "pass", violations: [] });
            continue;
        }
        const violations = ruleFn(srcFiles, allTestFiles, config);
        // Apply configured severity
        const annotated = violations.map((v) => ({
            ...v,
            severity: severity,
        }));
        const errors = annotated.filter((v) => v.severity === "error");
        const warns = annotated.filter((v) => v.severity === "warn");
        let status = "pass";
        if (errors.length > 0) {
            status = "fail";
            hasError = true;
        }
        else if (warns.length > 0) {
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
