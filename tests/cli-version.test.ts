import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Plan 20261117-074 task 2 — the version string drifted three times
// (0.1.4, then .version("0.1.5") against a 0.1.6 package.json). The CLI's
// --version must derive from package.json at startup so the class of bug
// dies permanently.
test("test_cli_version_derives_from_package_json", () => {
  const source = readFileSync("src/cli.ts", "utf-8");
  // no hardcoded version literal may remain in the .version() call
  expect(source).not.toMatch(/\.version\(\s*["'`0-9]/);
  // version is read from package.json at startup: readFileSync + JSON.parse
  expect(source).toContain("readFileSync");
  expect(source).toContain("JSON.parse");
  expect(source).toContain("package.json");
  // commander's version wiring stays in place
  expect(source).toMatch(/\.version\(/);
  // and the package is bumped — the derived string tracks this automatically
  const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
    version: string;
  };
  expect(pkg.version).toBe("0.1.7");
});
