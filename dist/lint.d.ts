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
export declare function lint(options: LintRunOptions): LintResult;
