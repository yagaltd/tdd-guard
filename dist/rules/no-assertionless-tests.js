import { parseFile } from "../parser.js";
export function ruleNoAssertionlessTests(_srcFiles, testFiles, _config) {
    const violations = [];
    for (const file of testFiles) {
        const parsed = parseFile(file);
        for (const block of parsed.testBlocks) {
            if (!block.hasAssertions && !block.skipped) {
                violations.push({
                    file,
                    line: block.line,
                    message: `Assertionless test: "${block.name}" — test has no expect/assert statements.`,
                    severity: "error",
                });
            }
        }
    }
    return violations;
}
