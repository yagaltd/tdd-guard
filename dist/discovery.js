/**
 * Shared test/source discovery for lint, verify, and mutate.
 *
 * One implementation of: segment-precise `.git`/`node_modules` exclusion,
 * `tests/` → `test/` → src-colocated probing, and the loud zero-file failure.
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "glob";
// "fixtures" joins .git/node_modules: fixture files are test-SHAPED data
// (parser edge cases, sample violations), not tests any command evaluates.
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "fixtures"]);
function isExcluded(scanRoot, file) {
    const rel = relative(scanRoot, file);
    return rel.split(/[\\/]/).some((seg) => EXCLUDED_SEGMENTS.has(seg));
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
export function discoverTests(options) {
    const srcDir = resolve(options.src || "src");
    // An explicit --tests always wins; otherwise probe tests/, then test/,
    // then fall back to src-colocated scanning. When none of the probed
    // roots exist (e.g. invoked from inside a leaf dir of a project whose
    // tests live elsewhere, or a rust-shaped layout with no src/), the cwd
    // itself becomes the scan root so the patterns — not the missing
    // directory names — decide what is discovered (plan 074 row 4).
    const probeTests = existsSync(resolve("tests"))
        ? resolve("tests")
        : existsSync(resolve("test"))
            ? resolve("test")
            : undefined;
    const testDir = options.tests !== undefined && options.tests !== ""
        ? resolve(options.tests)
        : probeTests ?? srcDir;
    const probedRootsExist = existsSync(srcDir) || probeTests !== undefined;
    const cwdFallback = !probedRootsExist && existsSync(resolve("."));
    const srcPatterns = ["**/*.{ts,tsx,js,jsx,rs,py}"];
    const testPatterns = [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/tests/**/*.rs",
        "**/*.rs", // plan 074 row 4: rust files at any depth — non-cargo rust projects keep their rust-only classification
        "**/test_*.py",
        "**/*_test.py",
    ];
    const srcFiles = globSync(srcPatterns, { cwd: srcDir, absolute: true, dot: true })
        .filter((f) => !isExcluded(srcDir, f));
    const scanRoots = [
        { root: testDir, patterns: testPatterns },
        { root: srcDir, patterns: testPatterns },
    ];
    if (cwdFallback && !scanRoots.some((r) => existsSync(r.root))) {
        scanRoots.push({ root: resolve("."), patterns: [...srcPatterns, ...testPatterns] });
    }
    const discovered = scanRoots
        .filter((r) => existsSync(r.root))
        .flatMap((r) => globSync(r.patterns, { cwd: r.root, absolute: true, dot: true }).filter((f) => !isExcluded(r.root, f)));
    const testFiles = [...new Set(discovered)];
    if (testFiles.length === 0 && !options.allowEmpty) {
        // Name every scan root — probed roots are named even when they do not
        // exist: "we looked HERE and found nothing" is the diagnostic.
        const roots = scanRoots.map((r) => r.root).join(", ");
        throw new Error(`tdd-guard ${options.command} found 0 test files. Scanned roots: ${roots}. ` +
            "A scan that sees no tests proves nothing — check the paths, or pass " +
            "--allow-empty to accept an empty scan.");
        throw new Error(`tdd-guard ${options.command} found 0 test files. Scanned roots: ${roots}. ` +
            "A scan that sees no tests proves nothing — check the paths, or pass " +
            "--allow-empty to accept an empty scan.");
    }
    return { srcDir, testDir, srcFiles, testFiles };
}
