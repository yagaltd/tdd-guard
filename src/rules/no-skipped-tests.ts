/**
 * Rule: no-skipped-tests
 * Detects .skip, .todo, xit, xdescribe, test.skip, it.skip
 */
import { Violation, TddGuardConfig } from "../types.js";
import { parseFile } from "../parser.js";

export function ruleNoSkippedTests(
  _srcFiles: string[],
  testFiles: string[],
  _config: TddGuardConfig,
): Violation[] {
  const violations: Violation[] = [];

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
