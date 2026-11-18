import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// ─── task 2: hygiene batch ────────────────────────────────────────────────────

describe("hygiene batch (task 2)", () => {
  test("vitest_excludes_git_subagents", () => {
    const configSrc = readFileSync("vitest.config.ts", "utf-8");
    // The custom exclude list dropped vitest's built-in .git exclusion, so
    // root runs swept pi subagent worktrees under .git/subagents/**. The
    // config must exclude that segment again.
    expect(configSrc).toMatch(/"\.git\/\*\*"/);
  });

  test("readme_documents_allow_empty_and_discovery", () => {
    const readme = readFileSync("README.md", "utf-8");
    // --allow-empty escape hatch
    expect(readme).toMatch(/--allow-empty/);
    // probe order: tests/ → test/ → src-colocated
    expect(readme).toMatch(/probes `tests\/`, then `test\/`/);
    expect(readme).toMatch(/src-colocated/);
    // explicit flag wins
    expect(readme).toMatch(/--tests/);
    // zero-files behavior
    expect(readme).toMatch(/0 test files/);
    // Rust binding
    expect(readme).toMatch(/cargo test --quiet -- --list/);
  });
});
