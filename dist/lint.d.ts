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
 * @cc [label:lint-discovery] segment-exact-exclusion
 * Exclusion matches whole path components exactly (`.git`, `node_modules`) on
 * each glob hit's path relative to its scan root — never substring matching on
 * absolute paths. A lint run from <repo>/.git/subagents/<run>/<worker> (any pi
 * subagent worktree) must still see the project's test files; `.github/` and
 * names merely containing "git" (e.g. digit.ts) survive.
 *
 * @cc [label:lint-discovery] zero-files-loud-failure
 * A lint run that discovers zero test files throws (CLI exits non-zero) with a
 * message naming the scanned roots, unless options.allowEmpty is set — lint
 * never passes vacuously on an empty scan.
 */
export declare function lint(options: LintRunOptions): LintResult;
