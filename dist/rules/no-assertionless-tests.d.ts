/**
 * Rule: no-assertionless-tests
 * Detects test blocks with no expect/assert
 */
import { Violation, TddGuardConfig } from "../types.js";
export declare function ruleNoAssertionlessTests(_srcFiles: string[], testFiles: string[], _config: TddGuardConfig): Violation[];
