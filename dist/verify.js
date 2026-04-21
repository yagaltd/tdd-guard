/**
 * tdd-guard verify — agent-spec bridge
 * Reads an agent-spec contract and checks that tests cover
 * the contract's decisions, boundaries, and test selectors
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { globSync } from "glob";
import { loadConfig } from "./config.js";
import { parseFile } from "./parser.js";
export function verify(options) {
    const config = loadConfig(options.config);
    const specPath = resolve(options.spec);
    const testDir = resolve(options.tests || "tests");
    if (!existsSync(specPath)) {
        process.stderr.write(`Error: spec file not found: ${specPath}\n`);
        process.exit(1);
    }
    const specContent = readFileSync(specPath, "utf-8");
    // Parse agent-spec contract sections
    const decisions = parseDecisions(specContent);
    const boundaries = parseBoundaries(specContent);
    const scenarios = parseScenarios(specContent);
    // Collect test files
    const testPatterns = [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/tests/**/*.rs",
        "**/test_*.py",
        "**/*_test.py",
    ];
    const testFiles = testPatterns.flatMap((p) => globSync(p, { cwd: testDir, absolute: true })
        .filter((f) => !f.includes("node_modules")));
    // Also check colocated tests
    const srcDir = resolve(options.tests ? "../src" : "src");
    if (existsSync(srcDir)) {
        const colocated = testPatterns.flatMap((p) => globSync(p, { cwd: srcDir, absolute: true })
            .filter((f) => !f.includes("node_modules")));
        testFiles.push(...colocated);
    }
    // Build a lookup of all test function names
    const testNames = new Map(); // name → file
    for (const file of testFiles) {
        const parsed = parseFile(file);
        for (const block of parsed.testBlocks) {
            testNames.set(block.name, file);
        }
    }
    // Also scan test file contents for function references
    const allTestContent = testFiles
        .map((f) => {
        try {
            return readFileSync(f, "utf-8");
        }
        catch {
            return "";
        }
    })
        .join("\n");
    // Check decisions coverage
    const decisionsCoverage = decisions.map((d) => {
        // Heuristic: search for key terms from the decision in test code
        const keywords = extractKeywords(d);
        const matchingTest = findTestForKeywords(keywords, testNames, allTestContent);
        return {
            decision: d,
            covered_by: matchingTest,
            status: matchingTest ? "covered" : "uncovered",
        };
    });
    // Check boundaries coverage
    const boundariesCoverage = boundaries.map((b) => {
        // Check if any test file modifies/creates files in the boundary path
        const pathClean = b.replace("/**", "").replace("**/", "").replace("/*", "");
        const testedFiles = testFiles.filter((f) => f.includes(pathClean.replace(/src\//, "")));
        return {
            path: b,
            tested_files: testedFiles.map((f) => basename(f)),
            status: testedFiles.length > 0 ? "covered" : "uncovered",
        };
    });
    // Check test selectors
    const testSelectors = scenarios.map((s) => {
        const found = testNames.has(s.selector) || allTestContent.includes(s.selector);
        return {
            scenario: s.name,
            selector: s.selector,
            found,
        };
    });
    const hasUncovered = decisionsCoverage.some((d) => d.status === "uncovered") ||
        boundariesCoverage.some((b) => b.status === "uncovered") ||
        testSelectors.some((s) => !s.found);
    return {
        command: "verify",
        spec: specPath,
        decisions_coverage: decisionsCoverage,
        boundaries_coverage: boundariesCoverage,
        test_selectors: testSelectors,
        exit_code: hasUncovered ? 1 : 0,
    };
}
/**
 * Parse ## Decisions section from agent-spec contract
 */
function parseDecisions(content) {
    const decisions = [];
    let inDecisions = false;
    for (const line of content.split("\n")) {
        if (/^##\s+Decisions/.test(line)) {
            inDecisions = true;
            continue;
        }
        if (inDecisions && /^##\s/.test(line)) {
            inDecisions = false;
            continue;
        }
        if (inDecisions && /^\s*-\s/.test(line)) {
            decisions.push(line.replace(/^\s*-\s*/, "").trim());
        }
    }
    return decisions;
}
/**
 * Parse ### Allowed Changes from Boundaries section
 */
function parseBoundaries(content) {
    const boundaries = [];
    let inAllowed = false;
    for (const line of content.split("\n")) {
        if (/^###\s+Allowed\s+Changes/.test(line)) {
            inAllowed = true;
            continue;
        }
        if (inAllowed && /^###/.test(line)) {
            inAllowed = false;
            continue;
        }
        if (inAllowed && /^\s*-\s*`/.test(line)) {
            const match = line.match(/`([^`]+)`/);
            if (match)
                boundaries.push(match[1]);
        }
    }
    return boundaries;
}
/**
 * Parse Scenario entries with Test: selectors
 */
function parseScenarios(content) {
    const scenarios = [];
    const lines = content.split("\n");
    let currentScenario = "";
    for (const line of lines) {
        const scenarioMatch = line.match(/^Scenario:\s+(.+)/);
        if (scenarioMatch) {
            currentScenario = scenarioMatch[1].trim();
        }
        const testMatch = line.match(/^\s*Test:\s+(\S+)/);
        if (testMatch && currentScenario) {
            scenarios.push({
                name: currentScenario,
                selector: testMatch[1],
            });
        }
    }
    return scenarios;
}
/**
 * Extract searchable keywords from a decision string
 */
function extractKeywords(decision) {
    // Remove common words, extract meaningful terms
    const words = decision
        .replace(/[^a-zA-Z0-9_/\s-]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !["with", "using", "from", "that", "this", "will", "should"].includes(w));
    return words;
}
/**
 * Find a test that might cover the given keywords
 */
function findTestForKeywords(keywords, testNames, allTestContent) {
    for (const [name] of testNames) {
        const nameLower = name.toLowerCase();
        const matches = keywords.filter((k) => nameLower.includes(k.toLowerCase()));
        if (matches.length >= Math.ceil(keywords.length * 0.4)) {
            return name;
        }
    }
    // Fallback: search in test content
    for (const keyword of keywords) {
        if (allTestContent.includes(keyword)) {
            // Find which test contains it
            for (const [name, file] of testNames) {
                try {
                    const content = readFileSync(file, "utf-8");
                    if (content.includes(keyword))
                        return name;
                }
                catch {
                    continue;
                }
            }
        }
    }
    return null;
}
