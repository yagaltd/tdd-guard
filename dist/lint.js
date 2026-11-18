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
 */
export function lint(options) {
    const config = loadConfig(options.config || undefined);
    const { srcFiles, testFiles: allTestFiles } = discoverTests({
        src: options.src,
        tests: options.tests,
        allowEmpty: options.allowEmpty,
        command: "lint",
    });
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
