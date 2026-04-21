/**
 * Rule: no-skipped-tests
 * Detects .skip, .todo, xit, xdescribe, test.skip, it.skip
 */
import { Violation, TddGuardConfig } from "../types.js";
export declare function ruleNoSkippedTests(_srcFiles: string[], testFiles: string[], _config: TddGuardConfig): Violation[];
