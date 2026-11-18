/**
 * tdd-guard verify — agent-spec bridge
 * Reads an agent-spec contract and checks that tests cover
 * the contract's decisions, boundaries, and test selectors
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type {
  BoundaryCoverage,
  DecisionCoverage,
  TestSelectorCoverage,
  VerifyOptions,
  VerifyResult,
} from "./types.js";
import { discoverTests } from "./discovery.js";
import { loadConfig } from "./config.js";
import { parseFile } from "./parser.js";

/**
 * @cc [label:verify] rust-selector-bare-name-suffix-match
 * Rust selectors match the test's short name: cargo listing entries carry
 * module paths (`crate::mod::test`), so matching anchors a bare selector
 * on `::` as a suffix — never a bare prefix or substring.
 */
/**
 * @cc [label:verify] selector-content-match-word-anchored
 * The test-content leg of JS selector resolution matches whole identifiers,
 * never substrings: the selector is regex-escaped (identifier-shaped
 * selectors make escaping deterministic) and anchored on word boundaries at
 * both ends, so a selector that is a prefix of a longer test name (e.g.
 * test_my_pin against content containing only test_my_pin_extended) does not
 * resolve. The exact-name leg and the cargo-listing `::`-suffix leg are
 * unchanged.
 */
export function verify(options: VerifyOptions): VerifyResult {
  const config = loadConfig(options.config);
  const specPath = resolve(options.spec);

  if (!existsSync(specPath)) {
    process.stderr.write(`Error: spec file not found: ${specPath}\n`);
    process.exit(1);
  }

  const specContent = readFileSync(specPath, "utf-8");

  // Parse agent-spec contract sections
  const decisions = parseDecisions(specContent);
  const boundaries = parseBoundaries(specContent);
  const scenarios = parseScenarios(specContent);

  // Rust binding: when the target repo is a cargo project, spec selectors
  // resolve through the runner's own inventory (see cargoTestSelectors). Its
  // JS file scan may legitimately be empty, so the loud zero-files guard
  // yields there — a missing Rust selector still fails the run via its
  // not-found verdict.
  const isCargoProject = existsSync(resolve("Cargo.toml"));
  const { testFiles } = discoverTests({
    src: options.src,
    tests: options.tests,
    allowEmpty: isCargoProject,
    command: "verify",
  });
  const rustSelectors = isCargoProject
    ? cargoTestSelectors(process.cwd())
    : new Set<string>();

  // Build a lookup of all test function names
  const testNames = new Map<string, string>(); // name → file
  for (const file of testFiles) {
    const parsed = parseFile(file);
    for (const block of parsed.testBlocks) {
      testNames.set(block.name, file);
    }
  }

  // Also scan test file contents for function references
  // Rust files never feed the content leg: a cargo repo resolves via the
  // listing (the inventory of record), and a rust file mentioning a selector
  // name in a comment must not count as its definition. Rust content is
  // excluded here; non-cargo rust repos resolve loud not-found.
  const allTestContent = testFiles
    .filter((f) => !f.endsWith(".rs"))
    .map((f) => {
      try {
        return readFileSync(f, "utf-8");
      } catch {
        return "";
      }
    })
    .join("\n");

  // Check decisions coverage
  const decisionsCoverage: DecisionCoverage[] = decisions.map((d) => {
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
  const boundariesCoverage: BoundaryCoverage[] = boundaries.map((b) => {
    // Check if any test file modifies/creates files in the boundary path
    const pathClean = b.replace("/**", "").replace("**/", "").replace("/*", "");
    const testedFiles = testFiles.filter((f) =>
      f.includes(pathClean.replace(/src\//, "")),
    );
    return {
      path: b,
      tested_files: testedFiles.map((f) => basename(f)),
      status: testedFiles.length > 0 ? "covered" : "uncovered",
    };
  });

  // Check test selectors
  const testSelectors: TestSelectorCoverage[] = scenarios.map((s) => {
    const found =
      testNames.has(s.selector) ||
      contentMatchesSelector(allTestContent, s.selector) ||
      rustSelectors.has(s.selector) ||
      Array.from(rustSelectors).some(
        (n) => n === s.selector || n.endsWith("::" + s.selector),
      );
    return {
      scenario: s.name,
      selector: s.selector,
      found,
    };
  });

  const hasUncovered =
    decisionsCoverage.some((d) => d.status === "uncovered") ||
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
 * Word-anchored content match: the selector is regex-escaped and matched
 * between \b word boundaries, so it only resolves where it appears as a
 * whole identifier — never as the prefix of a longer test name.
 */
function contentMatchesSelector(content: string, selector: string): boolean {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(content);
}

/**
 * Parse ## Decisions section from agent-spec contract
 */
function parseDecisions(content: string): string[] {
  const decisions: string[] = [];
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
function parseBoundaries(content: string): string[] {
  const boundaries: string[] = [];
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
      if (match) boundaries.push(match[1]);
    }
  }

  return boundaries;
}

/**
 * Parse Scenario entries with Test: selectors
 */
function parseScenarios(content: string): { name: string; selector: string }[] {
  const scenarios: { name: string; selector: string }[] = [];
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
function extractKeywords(decision: string): string[] {
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
function findTestForKeywords(
  keywords: string[],
  testNames: Map<string, string>,
  allTestContent: string,
): string | null {
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
          if (content.includes(keyword)) return name;
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

/**
 * Resolve a cargo project's test inventory: run `cargo test --quiet -- --list`
 * and parse the listing into the selector set.
 *
 * In a cargo project (Cargo.toml present), verify resolves spec selectors via
 * `cargo test --quiet -- --list` — the runner's own inventory — not JS parsing
 * of Rust sources. A selector absent from the listing reports not-found and
 * fails the run; a cargo failure yields an empty set (all Rust selectors
 * report not-found), keeping the exit loud. JS resolution is unchanged.
 */
export function cargoTestSelectors(cargoRoot: string): Set<string> {
  try {
    const listing = execFileSync("cargo", ["test", "--quiet", "--", "--list"], {
      cwd: cargoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }).toString();
    return new Set(parseCargoTestListing(listing));
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    process.stderr.write(
      `tdd-guard verify: cargo test --list failed (${detail}); ` +
      "Rust selectors will report not-found.\n",
    );
    return new Set();
  }
}

/**
 * Parse a libtest `--list` output into test selector names.
 *
 * Terse format (with --quiet): one `name: test` line per test. Default format
 * adds blank lines and libtest summary lines (`2 tests, 0 benchmarks`) —
 * only `name: test` lines become selectors.
 */
export function parseCargoTestListing(listing: string): string[] {
  const names: string[] = [];
  for (const line of listing.split("\n")) {
    const match = line.trimEnd().match(/^(.+): test$/);
    if (match) names.push(match[1].trim());
  }
  return names;
}
