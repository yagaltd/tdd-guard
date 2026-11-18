import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// plan 074 row 4: a NON-CARGO rust-shaped project (rust tests under tests/,
// no Cargo.toml) loud-failed 0-files because the rust pattern needed a
// NESTED tests dir. The widened pattern (**/*.rs) discovers them and the
// rust-only classification applies. Cargo repos keep SKIPPED-RUST via the
// 073 classification either way.
test("lint_widened_pattern_discovers_noncargo_rust_tests", () => {
  const root = mkdtempSync(join(tmpdir(), "tdd-guard-widen-"));
  try {
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "sample.rs"), "#[test]\nfn sample() {}\n");
    const r = spawnSync("node", [join(import.meta.dirname, "..", "dist", "cli.js"), "lint"], {
      cwd: root, encoding: "utf8", timeout: 120_000,
    });
    expect(r.stderr).toContain("SKIPPED-RUST");
    expect(r.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
