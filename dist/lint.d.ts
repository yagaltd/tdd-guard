/**
 * tdd-guard lint engine
 * Runs all enabled rules and collects results
 */
import { LintResult, LintOptions } from "./types.js";
/**
 * Runtime options for a lint run. Extends LintOptions (which stays untouched
 * in types.ts) with the two controls the vacuous-lint fix introduced.
 */
export type LintRunOptions = Omit<LintOptions, "tests"> & {
    /** Test directory. Omitted → probe tests/, then test/, then src-colocated. */
    tests?: string;
    /** Escape hatch: accept a scan that finds zero test files. */
    allowEmpty?: boolean;
};
/**
 * Run all enabled rules over the discovered test files.
 *
 * Discovery (segment-exact exclusion, tests/ → test/ → src-colocated probing,
 * explicit --tests wins, loud zero-file failure) lives in ./discovery.js and
 * is shared with verify and mutate.
 */
export declare function lint(options: LintRunOptions): LintResult;
