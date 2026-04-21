/**
 * Rule: no-assertionless-tests
 * Detects test blocks with no expect/assert
 */
import { Violation, TddGuardConfig } from "../types.js";
import { parseFile } from "../parser.js";

export function ruleNoAssertionlessTests(
  _srcFiles: string[],
  testFiles: string[],
  _config: TddGuardConfig,
): Violation[] {
  const violations: Violation[] = [];

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
