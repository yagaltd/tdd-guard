import { parseFile } from "../parser.js";
export function ruleNoSkippedTests(_srcFiles, testFiles, _config) {
    const violations = [];
    for (const file of testFiles) {
        const parsed = parseFile(file);
        for (const block of parsed.testBlocks) {
            if (block.skipped) {
                violations.push({
                    file,
                    line: block.line,
                    message: `Skipped test: "${block.name}" — remove skip/todo or implement the test.`,
                    severity: "error",
                });
            }
        }
    }
    return violations;
}
