import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Binds the task-3.spec "gates hold" scenario: the build IS the gate, so the
// gate gets a real named test (fix-round-072: selectors must bind or be
// verify-line-governed; this one binds).
test("tsc_and_build_clean", () => {
  for (const args of [["tsc", "--noEmit"], ["tsc"]]) {
    const r = spawnSync("bunx", args, { cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 180000 });
    expect(r.status, `bunx ${args.join(" ")} failed:` + "\n" + r.stdout + r.stderr).toBe(0);
  }
}, 240000);
