/**
 * tdd-guard mutate — mutation testing wrapper
 * Wraps Stryker (JS/TS), cargo-mutants (Rust), mutmut (Python)
 * Reports mutation score. Fails below threshold.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { globSync } from "glob";
import { loadConfig } from "./config.js";
export function mutate(options) {
    const config = loadConfig(options.config);
    const threshold = options.threshold || config.mutation?.threshold || 60;
    const srcDir = resolve(options.src || "src");
    const testDir = resolve(options.tests || "tests");
    // Detect project language
    const language = detectLanguage(srcDir);
    let result;
    switch (language) {
        case "typescript":
        case "javascript":
            result = runStryker(srcDir, testDir, threshold, options.since);
            break;
        case "rust":
            result = runCargoMutants(srcDir, threshold, options.since);
            break;
        case "python":
            result = runMutmut(srcDir, threshold, options.since);
            break;
        default:
            result = {
                command: "mutate",
                language,
                tool: "none",
                mutation_score: 0,
                threshold,
                killed: 0,
                survived: 0,
                timeout: 0,
                total: 0,
                exit_code: 1,
                details: `Unsupported language: ${language}. tdd-guard mutate supports JS/TS (Stryker), Rust (cargo-mutants), Python (mutmut).`,
            };
    }
    return result;
}
function detectLanguage(srcDir) {
    if (!existsSync(srcDir)) {
        // Check for Cargo.toml, pyproject.toml, package.json in cwd
        if (existsSync("Cargo.toml"))
            return "rust";
        if (existsSync("pyproject.toml") || existsSync("setup.py"))
            return "python";
        if (existsSync("package.json"))
            return "typescript";
        return "unknown";
    }
    const files = globSync("**/*", { cwd: srcDir });
    const exts = new Set(files.map((f) => extname(f).slice(1)));
    if (exts.has("rs"))
        return "rust";
    if (exts.has("py"))
        return "python";
    if (exts.has("ts") || exts.has("tsx"))
        return "typescript";
    if (exts.has("js") || exts.has("jsx"))
        return "javascript";
    return "unknown";
}
function runStryker(srcDir, testDir, threshold, since) {
    // Check if Stryker is installed
    const hasStryker = existsSync(resolve("node_modules/@stryker-mutator/core")) ||
        existsSync(resolve("node_modules/.bin/stryker"));
    if (!hasStryker) {
        return {
            command: "mutate",
            language: "typescript",
            tool: "stryker",
            mutation_score: 0,
            threshold,
            killed: 0,
            survived: 0,
            timeout: 0,
            total: 0,
            exit_code: 1,
            details: "Stryker not installed. Run: npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner",
        };
    }
    // Generate Stryker config if none exists
    if (!existsSync("stryker.conf.json") && !existsSync("stryker.config.js")) {
        const strykerConfig = {
            packageManager: "npm",
            reporters: ["json", "clear-text"],
            jsonReporter: { fileName: resolve(".tdd-guard-mutation-report.json") },
            thresholds: { high: threshold, low: threshold - 20, break: threshold },
            mutate: since ? getChangedFiles(since) : [`${srcDir}/**/*.ts`, `${srcDir}/**/*.js`],
            testRunner: "jest",
            coverageAnalysis: "perTest",
        };
        writeFileSync(".tdd-guard-stryker-conf.json", JSON.stringify(strykerConfig, null, 2));
    }
    try {
        const configArg = existsSync("stryker.conf.json")
            ? ""
            : " --configFile .tdd-guard-stryker-conf.json";
        execSync(`npx stryker run${configArg}`, {
            stdio: "pipe",
            timeout: 600_000, // 10 min max
        });
    }
    catch (e) {
        // Stryker exits with non-zero when mutation score is below threshold
        // That's expected — we read the report
    }
    // Parse Stryker JSON report
    const reportPath = resolve(".tdd-guard-mutation-report.json");
    if (existsSync(reportPath)) {
        try {
            const report = JSON.parse(readFileSync(reportPath, "utf-8"));
            const killed = report.killed || 0;
            const survived = report.survived || 0;
            const timeout = report.timeout || 0;
            const total = killed + survived + timeout + (report.noCoverage || 0);
            const score = total > 0 ? Math.round((killed / total) * 100) : 0;
            return {
                command: "mutate",
                language: "typescript",
                tool: "stryker",
                mutation_score: score,
                threshold,
                killed,
                survived,
                timeout,
                total,
                exit_code: score >= threshold ? 0 : 1,
            };
        }
        catch {
            // Fall through to error result
        }
    }
    return {
        command: "mutate",
        language: "typescript",
        tool: "stryker",
        mutation_score: 0,
        threshold,
        killed: 0,
        survived: 0,
        timeout: 0,
        total: 0,
        exit_code: 1,
        details: "Failed to parse Stryker output. Run Stryker manually to diagnose.",
    };
}
function runCargoMutants(srcDir, threshold, since) {
    // Check if cargo-mutants is installed
    try {
        execSync("cargo mutants --version", { stdio: "pipe" });
    }
    catch {
        return {
            command: "mutate",
            language: "rust",
            tool: "cargo-mutants",
            mutation_score: 0,
            threshold,
            killed: 0,
            survived: 0,
            timeout: 0,
            total: 0,
            exit_code: 1,
            details: "cargo-mutants not installed. Run: cargo install cargo-mutants",
        };
    }
    try {
        const args = since ? ` --since ${since}` : "";
        const output = execSync(`cargo mutants --no-copy --format json${args}`, {
            stdio: "pipe",
            timeout: 600_000,
        }).toString();
        // Parse cargo-mutants JSON output
        let killed = 0;
        let survived = 0;
        let timeout = 0;
        let unviable = 0;
        for (const line of output.split("\n")) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                if (entry.outcome === "killed")
                    killed++;
                else if (entry.outcome === "survived")
                    survived++;
                else if (entry.outcome === "timeout")
                    timeout++;
                else if (entry.outcome === "unviable")
                    unviable++;
            }
            catch {
                continue;
            }
        }
        const total = killed + survived + timeout;
        const score = total > 0 ? Math.round((killed / total) * 100) : 0;
        return {
            command: "mutate",
            language: "rust",
            tool: "cargo-mutants",
            mutation_score: score,
            threshold,
            killed,
            survived,
            timeout,
            total,
            exit_code: score >= threshold ? 0 : 1,
        };
    }
    catch (e) {
        return {
            command: "mutate",
            language: "rust",
            tool: "cargo-mutants",
            mutation_score: 0,
            threshold,
            killed: 0,
            survived: 0,
            timeout: 0,
            total: 0,
            exit_code: 1,
            details: `cargo-mutants failed: ${e.message?.slice(0, 200)}`,
        };
    }
}
function runMutmut(srcDir, threshold, since) {
    // Check if mutmut is installed
    try {
        execSync("mutmut --version", { stdio: "pipe" });
    }
    catch {
        return {
            command: "mutate",
            language: "python",
            tool: "mutmut",
            mutation_score: 0,
            threshold,
            killed: 0,
            survived: 0,
            timeout: 0,
            total: 0,
            exit_code: 1,
            details: "mutmut not installed. Run: pip install mutmut",
        };
    }
    try {
        const output = execSync("mutmut run --use-coverage", {
            stdio: "pipe",
            timeout: 600_000,
        }).toString();
        // Parse mutmut output for results
        const killedMatch = output.match(/killed:\s*(\d+)/i);
        const survivedMatch = output.match(/survived:\s*(\d+)/i);
        const timeoutMatch = output.match(/timeout:\s*(\d+)/i);
        const killed = parseInt(killedMatch?.[1] || "0");
        const survived = parseInt(survivedMatch?.[1] || "0");
        const timeout = parseInt(timeoutMatch?.[1] || "0");
        const total = killed + survived + timeout;
        const score = total > 0 ? Math.round((killed / total) * 100) : 0;
        return {
            command: "mutate",
            language: "python",
            tool: "mutmut",
            mutation_score: score,
            threshold,
            killed,
            survived,
            timeout,
            total,
            exit_code: score >= threshold ? 0 : 1,
        };
    }
    catch (e) {
        return {
            command: "mutate",
            language: "python",
            tool: "mutmut",
            mutation_score: 0,
            threshold,
            killed: 0,
            survived: 0,
            timeout: 0,
            total: 0,
            exit_code: 1,
            details: `mutmut failed: ${e.message?.slice(0, 200)}`,
        };
    }
}
/**
 * Get list of files changed since a git ref
 */
function getChangedFiles(since) {
    try {
        const output = execSync(`git diff --name-only ${since}`, {
            stdio: "pipe",
        }).toString();
        return output
            .split("\n")
            .filter((f) => f.trim() && /\.(ts|tsx|js|jsx)$/.test(f));
    }
    catch {
        return ["src/**/*.ts"]; // Fallback
    }
}
