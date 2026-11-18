import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// ─── task 1 (plan 20261117-074): the package lock tells the truth ────────────
// package.json was bumped across releases while package-lock.json's root
// version stayed behind (0.1.1 against a 0.1.5 package.json) — the lock lied
// about the published version. This pin keeps the root lock version (both the
// top-level field and the "" package entry) equal to package.json's version.

describe("version sync (task 1)", () => {
  test("package_lock_root_version_synced", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      version: string;
    };
    const lock = JSON.parse(readFileSync("package-lock.json", "utf-8")) as {
      version: string;
      packages: { "": { version: string } };
    };

    expect(pkg.version).toBe("0.1.7");
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
  });
});
