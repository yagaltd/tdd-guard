/**
 * Rule: no-implementation-coupling
 * Detects tests asserting on call counts, call order, or internal state
 */
import { readFileSync } from "node:fs";
import { parseFile } from "../parser.js";
export function ruleNoImplementationCoupling(_srcFiles, testFiles, _config) {
    const violations = [];
    // Patterns that indicate implementation coupling
    const couplingPatterns = [
        {
            // toHaveBeenCalledTimes(N) — asserting call count
            pattern: /(?:toHaveBeenCalled|toHaveBeenCalledBefore|toHaveBeenCalledAfter|toHaveBeenCalledTimes)\s*\(\s*\d+/,
            message: "Assertion on call count/order — tests should verify behavior, not implementation details.",
        },
        {
            // toHaveBeenCalledWith checking exact args (implementation coupling)
            // Only flag when combined with toHaveBeenCalledTimes (double coupling)
            pattern: /toHaveBeenCalledTimes\s*\(\s*\d+\s*\)[\s\S]*?toHaveBeenCalledWith/,
            message: "Call count + exact args assertion — over-specified test that will break on refactoring.",
        },
        {
            // Accessing ._isMockFunction or .mock internals
            pattern: /\.(mock\.calls|mock\.results|mock\.contexts|_isMockFunction)/,
            message: "Accessing mock internals — tests should verify behavior through public interface.",
        },
        {
            // Asserting on private/internal state (._internal, .__private)
            pattern: /expect\s*\([^)]*(?:\._|\\.__|\.internal|\.private|\.#)/,
            message: "Assertion on internal/private state — tests should verify public behavior.",
        },
    ];
    for (const file of testFiles) {
        const parsed = parseFile(file);
        // Only check within test blocks that have assertions
        for (const block of parsed.testBlocks) {
            if (!block.hasAssertions || block.skipped)
                continue;
            // Re-read the file to get the test body
            // The parser already identified line ranges, so we do a lightweight check
            // on lines within the test block's scope
        }
        // Simpler approach: scan entire file for coupling patterns
        // This is conservative — it may flag lines outside test blocks,
        // but that's fine for a warning-level rule
        const code = readFileSync(file, "utf-8");
        const lines = code.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            for (const { pattern, message } of couplingPatterns) {
                if (pattern.test(line)) {
                    violations.push({
                        file,
                        line: lineNum,
                        message,
                        severity: "warn",
                    });
                    break; // One violation per line max
                }
            }
        }
    }
    return violations;
}
