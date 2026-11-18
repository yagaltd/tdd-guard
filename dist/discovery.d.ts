export interface DiscoverTestsOptions {
    /** Source directory. Default: "src". */
    src?: string;
    /** Explicit test root. Wins over probing; omitted or empty → probe. */
    tests?: string;
    /** Escape hatch: accept a scan that finds zero test files. */
    allowEmpty?: boolean;
    /** Command name used in the loud zero-files error message. */
    command: "lint" | "verify" | "mutate";
}
export interface DiscoveryResult {
    srcDir: string;
    testDir: string;
    srcFiles: string[];
    testFiles: string[];
}
/**
 * Discover source and test files for one tdd-guard command.
 *
 * Exclusion matches whole path components exactly (`.git`, `node_modules`) on
 * each glob hit's path relative to its scan root — never substring matching on
 * absolute paths. A run from <repo>/.git/subagents/<run>/<worker> (any pi
 * subagent worktree) still sees the project's test files; `.github/` and names
 * merely containing "git" (e.g. digit.ts) survive.
 *
 * An explicit tests root is used verbatim and probing is skipped; otherwise
 * discovery probes `tests/`, then `test/`, then falls back to src-colocated
 * scanning.
 *
 * A scan that discovers zero test files throws (CLI exits non-zero) with a
 * message naming the scanned roots, unless options.allowEmpty is set — no
 * command passes vacuously on an empty scan.
 */
export declare function discoverTests(options: DiscoverTestsOptions): DiscoveryResult;
