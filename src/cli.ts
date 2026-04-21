#!/usr/bin/env node

/**
 * tdd-guard — Test Quality Enforcement CLI
 *
 * Commands:
 *   lint     — Static analysis of test code
 *   verify   — Bridge to agent-spec contracts
 *   mutate   — Mutation testing wrapper
 */
import { Command } from "commander";
import { lint } from "./lint.js";
import { verify } from "./verify.js";
import { mutate } from "./mutate.js";
import type { LintResult, MutateResult, VerifyResult } from "./types.js";

const program = new Command();

program
  .name("tdd-guard")
  .description("Test quality enforcement CLI — lint, verify, mutate")
  .version("0.1.0");

// ─── lint ───────────────────────────────────────────────────────────────────

program
  .command("lint")
  .description("Static analysis of test code quality")
  .option("--src <dir>", "Source directory", "src")
  .option("--tests <dir>", "Test directory", "tests")
  .option("--config <file>", "Config file path", "")
  .option("--format <format>", "Output format: json or text", "json")
  .action((opts) => {
    const result = lint({
      src: opts.src,
      tests: opts.tests,
      config: opts.config,
      format: opts.format,
    });

    if (opts.format === "text") {
      printLintText(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.exit_code);
  });

// ─── verify ────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify tests cover agent-spec contract decisions, boundaries, and selectors")
  .requiredOption("--spec <file>", "agent-spec .spec file path")
  .option("--tests <dir>", "Test directory", "tests")
  .option("--config <file>", "Config file path", "")
  .option("--format <format>", "Output format: json or text", "json")
  .action((opts) => {
    const result = verify({
      spec: opts.spec,
      tests: opts.tests,
      config: opts.config,
      format: opts.format,
    });

    if (opts.format === "text") {
      printVerifyText(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.exit_code);
  });

// ─── mutate ────────────────────────────────────────────────────────────────

program
  .command("mutate")
  .description("Mutation testing — wraps Stryker, cargo-mutants, or mutmut")
  .option("--src <dir>", "Source directory", "src")
  .option("--tests <dir>", "Test directory", "tests")
  .option("--threshold <pct>", "Minimum mutation score threshold", "60")
  .option("--since <ref>", "Only mutate files changed since git ref", "")
  .option("--config <file>", "Config file path", "")
  .option("--format <format>", "Output format: json or text", "json")
  .action((opts) => {
    const result = mutate({
      src: opts.src,
      tests: opts.tests,
      threshold: parseInt(opts.threshold),
      since: opts.since,
      config: opts.config,
      format: opts.format,
    });

    if (opts.format === "text") {
      printMutateText(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.exit_code);
  });

// ─── Text formatters ────────────────────────────────────────────────────────

function printLintText(result: LintResult) {
  console.log("tdd-guard lint");
  console.log("=".repeat(40));

  for (const check of result.checks) {
    const icon =
      check.status === "pass" ? "✅" :
      check.status === "fail" ? "❌" :
      "⚠️ ";
    console.log(`${icon} ${check.rule} (${check.status})`);

    for (const v of check.violations) {
      console.log(`   ${v.file}:${v.line} — ${v.message}`);
    }
  }

  console.log("=".repeat(40));
  const errors = result.checks.filter((c) => c.status === "fail").length;
  const warns = result.checks.filter((c) => c.status === "warn").length;
  console.log(
    `Result: ${errors > 0 ? "FAIL" : "PASS"} (${errors} error${errors !== 1 ? "s" : ""}, ${warns} warning${warns !== 1 ? "s" : ""})`,
  );
}

function printVerifyText(result: VerifyResult) {
  console.log("tdd-guard verify");
  console.log("=".repeat(40));
  console.log(`Spec: ${result.spec}`);

  console.log("\nDecisions coverage:");
  for (const d of result.decisions_coverage) {
    const icon = d.status === "covered" ? "✅" : "❌";
    console.log(`  ${icon} ${d.decision.slice(0, 60)}${d.decision.length > 60 ? "..." : ""}`);
    if (d.covered_by) console.log(`     → ${d.covered_by}`);
  }

  console.log("\nBoundaries coverage:");
  for (const b of result.boundaries_coverage) {
    const icon = b.status === "covered" ? "✅" : "❌";
    console.log(`  ${icon} ${b.path}`);
    if (b.tested_files.length > 0) console.log(`     → ${b.tested_files.join(", ")}`);
  }

  console.log("\nTest selectors:");
  for (const s of result.test_selectors) {
    const icon = s.found ? "✅" : "❌";
    console.log(`  ${icon} ${s.selector} (scenario: ${s.scenario.slice(0, 40)})`);
  }

  console.log("=".repeat(40));
  console.log(
    `Result: ${result.exit_code === 0 ? "PASS" : "FAIL"}`,
  );
}

function printMutateText(result: MutateResult) {
  console.log("tdd-guard mutate");
  console.log("=".repeat(40));
  console.log(`Language: ${result.language}`);
  console.log(`Tool: ${result.tool}`);
  console.log(`Mutation score: ${result.mutation_score}% (threshold: ${result.threshold}%)`);
  console.log(`Killed: ${result.killed} | Survived: ${result.survived} | Timeout: ${result.timeout}`);
  console.log(`Total mutations: ${result.total}`);
  if (result.details) console.log(`Details: ${result.details}`);
  console.log("=".repeat(40));
  console.log(
    `Result: ${result.mutation_score >= result.threshold ? "PASS" : "FAIL"} — score ${result.mutation_score}% < threshold ${result.threshold}%`,
  );
}

program.parse();
