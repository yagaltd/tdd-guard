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
 * A lint scan over a Rust repository is classified, not parsed: when every
 * discovered test file ends `.rs`, or the project has a Cargo.toml at cwd and
 * zero JS-parseable test files were discovered, lint prints a loud
 * SKIPPED-RUST line (stderr) naming the command and the reason and exits 0
 * with no rule checks. The zero-files loud guard is unchanged for JavaScript
 * repositories, and mixed scans evaluate JS test files normally while noting
 * the rust skip in the same line.
 */
/**
 * A lint scan over a Python repository is classified, not parsed: when every
 * discovered test file ends `.py`, or the project has a pyproject.toml at cwd
 * and zero JS-parseable test files were discovered, lint prints a loud
 * SKIPPED-PY line (stderr) naming the command and the reason and exits 0
 * with no rule checks — neither a vacuous pass over unparsed python files nor
 * a loud failure. Mixed scans evaluate JS test files normally while noting
 * the python skip in the same loud channel; the JS zero-files guard keeps
 * its semantics for JavaScript repositories.
 */
export declare function lint(options: LintRunOptions): LintResult;
/**
 * The loud SKIPPED-PY line: the python mirror of the SKIPPED-RUST line. Names
 * the command and the reason (the JS parser cannot evaluate python), lists
 * any discovered python test files, and states the outcome. In python-only
 * scans the run exits 0 with no checks — neither failing nor passing
 * vacuously; in mixed scans the JS files were evaluated normally and only
 * the python skip is noted.
 */
