/**
 * tdd-guard lint engine
 * Runs all enabled rules and collects results
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { discoverTests } from "./discovery.js";
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
 * Discovery (segment-exact exclusion, tests/ → test/ → src-colocated probing,
 * explicit --tests wins, loud zero-file failure) lives in ./discovery.js and
 * is shared with verify and mutate.
 *
 * @cc [label:lint] rust-scan-classification
 * A lint scan over a Rust repository is classified, not parsed: when every
 * discovered test file ends `.rs`, or the project has a Cargo.toml at cwd and
 * zero JS-parseable test files were discovered, lint prints a loud
 * SKIPPED-RUST line (stderr) naming the command and the reason and exits 0
 * with no rule checks. The zero-files loud guard is unchanged for JavaScript
 * repositories, and mixed scans evaluate JS test files normally while noting
 * the rust skip in the same line.
 */
export function lint(options) {
    const config = loadConfig(options.config || undefined);
    // A cargo project may legitimately discover zero JS test files (its tests
    // are rust files the JS-shaped discovery cannot see); the zero-files guard
    // yields for that case only — the scan is classified SKIPPED-RUST below,
    // never a silent green. JS repos keep the guard exactly as-is.
    const isCargoProject = existsSync(resolve("Cargo.toml"));
    const { srcFiles, testFiles: allTestFiles } = discoverTests({
        src: options.src,
        tests: options.tests,
        allowEmpty: options.allowEmpty || isCargoProject,
        command: "lint",
    });
    // Rust classification at scan level: the JS parser cannot evaluate rust,
    // so rust-only scans are loud-skipped (exit 0, no checks) and mixed scans
    // note the rust skip while evaluating JS test files normally.
    const rustTestFiles = allTestFiles.filter((f) => f.endsWith(".rs"));
    const jsTestFiles = allTestFiles.filter((f) => !f.endsWith(".rs") && !f.endsWith(".py"));
    if (jsTestFiles.length === 0) {
        const rustOnlyScan = allTestFiles.length === 0
            ? isCargoProject
            : rustTestFiles.length === allTestFiles.length;
        if (rustOnlyScan) {
            console.error(skippedRustMessage(allTestFiles, false));
            return { command: "lint", exit_code: 0, checks: [] };
        }
    }
    else if (rustTestFiles.length > 0 || isCargoProject) {
        console.error(skippedRustMessage(rustTestFiles, true));
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
/**
 * The loud SKIPPED-RUST line: names the command and the reason (the JS
 * parser cannot evaluate rust), lists any discovered rust test files, and
 * states the outcome. In rust-only scans the run exits 0 with no checks —
 * neither failing nor passing vacuously; in mixed scans the JS files were
 * evaluated normally and only the rust skip is noted.
 */
function skippedRustMessage(rustTestFiles, jsEvaluated) {
    const found = rustTestFiles.length > 0
        ? `${rustTestFiles.length} rust test file(s) discovered (${rustTestFiles
            .map((f) => relative(process.cwd(), f))
            .join(", ")})`
        : jsEvaluated
            ? "rust test files are not evaluated in this cargo project (Cargo.toml present)"
            : "no JS-parseable test files discovered (Cargo.toml present)";
    const outcome = jsEvaluated
        ? "the rust files are skipped while the JavaScript test files were evaluated normally"
        : "this scan is classified skipped-rust (exit 0) — neither a pass nor a failure";
    return (`SKIPPED-RUST: tdd-guard lint — ${found}. ` +
        `The JS parser cannot evaluate rust, so ${outcome}. ` +
        "Rust test quality is enforced by cargo-mutants via `tdd-guard mutate`.");
}
