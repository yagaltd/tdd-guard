import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import register from "../extensions/index";
import {
  roleBody,
  resolveRefs,
  resolveSubagentInput,
  computeHygieneDrift,
  isDocsExempt,
  computeDocsDrift,
  parseAdrContracts,
  parseCcCheckList,
  detectSupersedeGaps,
  extractDecisionsSection,
  makeRemindOnce,
  parsePlan,
  parseProvenance,
  eligibleTasks,
  orderWave,
  buildPack,
  gateCommandsFor,
  verdictOnFile,
  resolveNext,
  runGate,
  toRepoRelative,
  matchesAllowed,
  firstFindingsLine,
  autoGate,
  type GateRunner,
} from "../extensions/index";

const WORKER = `# Role: worker

<!-- dispatch note -->
You are a worker. Follow the contract.`;

const WORKER_NOTE_FIRST = `<!-- note first -->
# Role: worker

You are a worker.`;

describe("roleBody", () => {
  test("strips the # Role: header line", () => {
    expect(roleBody(WORKER)).not.toContain("# Role:");
    expect(roleBody(WORKER)).toContain("You are a worker.");
  });
  test("strips the dispatch-note comment AFTER the heading (BH-002: note leaks into prompts)", () => {
    expect(roleBody(WORKER)).not.toContain("dispatch note");
    expect(roleBody(WORKER)).not.toContain("<!--");
  });
  test("strips a note placed before the heading too", () => {
    expect(roleBody(WORKER_NOTE_FIRST)).not.toContain("note first");
    expect(roleBody(WORKER_NOTE_FIRST)).toContain("You are a worker.");
  });
  test("real role file shapes stay clean (all four files)", () => {
    for (const f of ["worker", "scout", "reviewer", "quality-reviewer"]) {
      const fs = require("fs");
      const path = require("path");
      const content = fs.readFileSync(
        path.join(__dirname, "..", "agents", `${f}.md`),
        "utf8"
      );
      const body = roleBody(content);
      expect(body.startsWith("You are")).toBe(true);
      expect(body).not.toContain("<!--");
      expect(body).not.toContain("# Role:");
      expect(body).not.toContain("agents/registry.md"); // stale meta-note must not leak
    }
  });
});

describe("resolveRefs", () => {
  test("substitutes known roles", () => {
    const { text, errors } = resolveRefs("@role:worker", () => WORKER);
    expect(errors).toEqual([]);
    expect(text).toContain("You are a worker.");
    expect(text).not.toContain("@role:");
  });
  test("unknown role: keeps text and reports error", () => {
    const { text, errors } = resolveRefs("@role:ghost", () => null);
    expect(text).toBe("@role:ghost");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("agents/ghost.md");
  });
});

describe("resolveSubagentInput", () => {
  test("rewrites single-mode prompt in place", () => {
    const input: any = { agent: "w", prompt: "@role:worker", task: "do it" };
    const errors = resolveSubagentInput(input, () => WORKER);
    expect(errors).toEqual([]);
    expect(input.prompt).toContain("You are a worker.");
  });
  test("rewrites tasks[] prompts in place", () => {
    const input: any = {
      tasks: [
        { id: "t1", prompt: "@role:worker" },
        { id: "t2", prompt: "plain prompt stays" },
      ],
    };
    const errors = resolveSubagentInput(input, (n) => (n === "worker" ? WORKER : null));
    expect(errors).toEqual([]);
    expect(input.tasks[0].prompt).toContain("You are a worker.");
    expect(input.tasks[1].prompt).toBe("plain prompt stays");
  });
  test("blocks nothing when no refs present", () => {
    const input: any = { agent: "w", prompt: "plain", tasks: [{ prompt: "also plain" }] };
    const before = JSON.stringify(input);
    resolveSubagentInput(input, () => WORKER);
    expect(JSON.stringify(input)).toBe(before);
  });
  test("collects errors for missing role files", () => {
    const input: any = { prompt: "@role:missing" };
    const errors = resolveSubagentInput(input, () => null);
    expect(errors[0]).toContain("agents/missing.md");
  });
});

describe("computeHygieneDrift", () => {
  const DONE = "- **Status**: ✅ DONE";
  test("no drift when markers and verdicts match done count", () => {
    const plan = `### TASK 1\n${DONE}\ncontext: updated\n### TASK 2\n${DONE}\ncontext: no changes`;
    const reviews = [
      { name: "a.md", content: "## Round 2\n**ok: true**" },
      { name: "b.md", content: "**ok: true**" },
    ];
    const d = computeHygieneDrift(plan, reviews);
    expect(d).toEqual({ missingContextMarkers: 0, missingFinalVerdicts: 0 });
  });
  test("detects missing context markers and verdicts", () => {
    const plan = `### TASK 1\n${DONE}\n### TASK 2\n${DONE}`; // 2 done, 0 markers
    const d = computeHygieneDrift(plan, []);
    expect(d.missingContextMarkers).toBe(2);
    expect(d.missingFinalVerdicts).toBe(2);
  });
  test("partial drift", () => {
    const plan = `### TASK 1\n${DONE}\ncontext: updated\n### TASK 2\n${DONE}`;
    const reviews = [{ name: "a.md", content: "**ok: true**" }];
    const d = computeHygieneDrift(plan, reviews);
    expect(d.missingContextMarkers).toBe(1);
    expect(d.missingFinalVerdicts).toBe(1);
  });
  test("no done tasks → no drift", () => {
    const d = computeHygieneDrift("⬜ pending", []);
    expect(d.missingContextMarkers).toBe(0);
  });
  test("emoji in prose (header/notes) does not inflate done count", () => {
    // The real 20260821-001 plan shape: 4 status-line ✅, 3 more ✅ in prose
    const plan = "> Status: IN PROGRESS (all tasks ✅)\n### TASK 1\n- **Status**: ✅ DONE\n### TASK 2\n- **Status**: ✅ DONE\ncontext: updated\ncontext: no changes\nlearnings ✅ here";
    const reviews = [
      { name: "a.md", content: "**ok: true**" },
      { name: "b.md", content: "**ok: true**" },
    ];
    const d = computeHygieneDrift(plan, reviews);
    expect(d.missingContextMarkers).toBe(0);
    expect(d.missingFinalVerdicts).toBe(0);
  });
  test("markers in inline-bullet format count too (real plan shape)", () => {
    // /next closeout appends markers as task bullets:
    // "- **Cost**: ... \n- **context: updated**"
    const plan = "### TASK 1\n- **Status**: ✅ DONE\n- **Cost**: ~$0.5\n- **context: updated**\n### TASK 2\n- **Status**: ✅ DONE\n- **Cost**: ~$0.1\n- **context: no changes**";
    const reviews = [
      { name: "a.md", content: "**ok: true**" },
      { name: "b.md", content: "**ok: true**" },
    ];
    const d = computeHygieneDrift(plan, reviews);
    expect(d.missingContextMarkers).toBe(0);
    expect(d.missingFinalVerdicts).toBe(0);
  });
});

describe("isDocsExempt", () => {
  test("exempts docs artifacts and non-user-facing files", () => {
    for (const f of [
      "README.md",
      "CHANGELOG.md",
      "docs/guide.md",
      ".workflows/plan.md",
      ".github/workflows/ci.yml",
      ".gitignore",
      "LICENSE",
      "package-lock.json",
      "Cargo.lock",
      "assets/logo.png",
      "",
    ]) {
      expect(isDocsExempt(f)).toBe(true);
    }
  });
  test("counts user-facing code", () => {
    for (const f of ["src/store.js", "prompts/next.md", "package.json", "agents/registry.md"]) {
      expect(isDocsExempt(f)).toBe(false);
    }
  });
});

// Fake git: scripted responses keyed by command substring.
function fakeGit(responses: Record<string, string | null>) {
  return (cmd: string): string | null => {
    for (const [needle, out] of Object.entries(responses)) {
      if (cmd.includes(needle)) return out;
    }
    return null;
  };
}

describe("computeDocsDrift", () => {
  const PLAN_ACTIVE = "### TASK 1\n- **Status**: ✅ DONE\n### TASK 2\n- **Status**: ⬜ PENDING";
  const PLAN_COMPLETE = "### TASK 1\n- **Status**: ✅ DONE\n### TASK 2\n- **Status**: ✅ DONE";
  const NO_PLAN = "no statuses here";

  test("README stale when code committed after README's last commit", () => {
    const exec = fakeGit({
      "-- README.md": "abc123",
      "abc123..HEAD": "src/a.js\nsrc/b.js\nREADME.md\ndocs/x.md",
    });
    const d = computeDocsDrift(PLAN_ACTIVE, exec, () => []);
    expect(d.staleReadmeCount).toBe(2); // only src files count
    expect(d.changelogPending).toBe(false);
  });

  test("README fresh when no code changes since its last commit", () => {
    const exec = fakeGit({
      "-- README.md": "abc123",
      "abc123..HEAD": "docs/x.md\nCHANGELOG.md",
    });
    const d = computeDocsDrift(PLAN_ACTIVE, exec, () => []);
    expect(d.staleReadmeCount).toBe(0);
  });

  test("README check inert without done tasks", () => {
    const exec = fakeGit({
      "-- README.md": "abc123",
      "abc123..HEAD": "src/a.js",
    });
    const d = computeDocsDrift(NO_PLAN, exec, () => []);
    expect(d.staleReadmeCount).toBe(0);
  });

  test("no git → zeros, changelogPending still pure", () => {
    const d = computeDocsDrift(PLAN_ACTIVE, () => null, () => []);
    expect(d).toEqual({ staleReadmeCount: 0, staleDocsCount: 0, changelogPending: false });
    const c = computeDocsDrift(PLAN_COMPLETE, () => null, () => []);
    expect(c.changelogPending).toBe(true);
  });

  test("plan complete → changelogPending", () => {
    const exec = fakeGit({ "-- README.md": "abc123", "abc123..HEAD": "" });
    const d = computeDocsDrift(PLAN_COMPLETE, exec, () => []);
    expect(d.changelogPending).toBe(true);
    expect(d.staleReadmeCount).toBe(0);
  });

  test("emoji in prose does not inflate done count (header/notes ✅)", () => {
    const plan = "> Status: IN PROGRESS (all tasks ✅)\n### TASK 1\n- **Status**: ✅ DONE\n### TASK 2\n- **Status**: ⬜ PENDING\nlearnings ✅ somewhere";
    const d = computeDocsDrift(plan, () => null, () => []);
    expect(d.changelogPending).toBe(false); // 1 done ≠ 2 total
  });

  test("docs/ folder stale when code changed since docs' last commit", () => {
    const exec = fakeGit({
      "-- README.md": "abc123",
      "abc123..HEAD": "src/a.js",
      "-- docs": "def456",
      "def456..HEAD": "src/a.js\nsrc/b.js",
    });
    const d = computeDocsDrift(PLAN_ACTIVE, exec, () => ["docs/a.md", "docs/b.md"]);
    expect(d.staleDocsCount).toBe(2);
  });

  test("historical ref override works", () => {
    const exec = fakeGit({
      "ca77c7c -- README.md": "oldreadme",
      "oldreadme..ca77c7c": "prompts/next.md\nagents/registry.md\nREADME.md",
    });
    const d = computeDocsDrift(PLAN_ACTIVE, exec, () => [], "ca77c7c");
    expect(d.staleReadmeCount).toBe(2);
  });
});

describe("supersede watchdog", () => {
  test("parseAdrContracts: keeps only adr:-attributed @cc directives", () => {
    const text = `// @cc [label:watchdog,id:hygiene] no adr here
// @cc [label:watchdog,id:supersede-once,adr:7] adr attributed`;
    expect(parseAdrContracts(text)).toEqual([
      { id: "supersede-once", label: "watchdog", adr: "7", owners: [] },
    ]);
  });

  test("parseCcCheckList: reads adr: from cc-check list blocks", () => {
    const out = `=> CONTRACTS <=\n\n◆ watchdog-once:1\n  scope:directory · label:watchdog · id:watchdog-once · adr:7\n\n◆ plain:9\n  scope:file · label:x · id:plain`;
    expect(parseCcCheckList(out)).toEqual([
      { id: "watchdog-once", label: "watchdog", adr: "7", owners: [] },
    ]);
  });

  test("trigger fires when a changed file carries an adr contract", () => {
    const gaps = detectSupersedeGaps({
      changedFiles: ["extensions/index.ts", "src/other.ts"],
      adrContractsByFile: {
        "extensions/index.ts": [
          { id: "supersede-once", label: "watchdog", adr: "7", owners: [] },
        ],
      },
      changedSpecDecisions: [],
      newAdrFiles: [],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].trigger).toBe("adr-contract-file");
    expect(gaps[0].seam).toContain("extensions/index.ts");
    expect(gaps[0].adr).toBe("7");
  });

  test("no fire without an adr contract or a decisions change", () => {
    const gaps = detectSupersedeGaps({
      changedFiles: ["src/other.ts"],
      adrContractsByFile: {},
      changedSpecDecisions: [],
      newAdrFiles: [],
    });
    expect(gaps).toEqual([]);
  });

  test("trigger fires when a spec's Decisions changed with no new ADR file", () => {
    const gaps = detectSupersedeGaps({
      changedFiles: [],
      adrContractsByFile: {},
      changedSpecDecisions: [".workflows/specs/task-x.spec"],
      newAdrFiles: [],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].trigger).toBe("decisions-changed");
  });

  test("no fire when a new ADR file accompanies the Decisions change", () => {
    const gaps = detectSupersedeGaps({
      changedFiles: ["docs/adr/0007-supersede.md"],
      adrContractsByFile: {},
      changedSpecDecisions: [".workflows/specs/task-x.spec"],
      newAdrFiles: ["docs/adr/0007-supersede.md"],
    });
    expect(gaps).toEqual([]);
  });

  test("extractDecisionsSection reads only the Decisions body", () => {
    const spec = "## Intent\nstuff\n## Decisions\n- A\n- B\n## Boundaries\nnope";
    expect(extractDecisionsSection(spec)).toBe("- A\n- B");
  });

  test("owner parsing: textual fallback extracts owner attributes", () => {
    const contracts = parseAdrContracts(
      "/** @cc [label:watchdog,id:x,owner:alice,adr:7] x\n */"
    );
    expect(contracts).toHaveLength(1);
    expect(contracts[0].owners).toEqual(["alice"]);
  });

  test("owner parsing: multiple owners kept in contract order", () => {
    const contracts = parseAdrContracts(
      "/** @cc [adr:7,id:x,owner:alice,owner:bob,label:y] x\n */"
    );
    expect(contracts[0].owners).toEqual(["alice", "bob"]);
  });

  test("owner parsing: cc-check list path extracts owner attributes", () => {
    const contracts = parseCcCheckList(
      "◆ x:1\n  scope:file · label:y · id:x · owner:carol · adr:7"
    );
    expect(contracts[0].owners).toEqual(["carol"]);
  });

  test("owner parsing: absent owner yields empty list", () => {
    const contracts = parseAdrContracts("/** @cc [adr:7,id:x] x */");
    expect(contracts[0].owners).toEqual([]);
  });

  test("no-spam: makeRemindOnce emits once per new gap, resets on clear", () => {
    const remember = makeRemindOnce();
    expect(remember("gap-a")).toBe(true);
    expect(remember("gap-a")).toBe(false);
    expect(remember("")).toBe(false);
    expect(remember("gap-a")).toBe(true); // new episode after reset
    expect(remember("gap-b")).toBe(true);
    expect(remember("gap-b")).toBe(false);
  });

  test("advisory names owner sign-off target", () => {
    // The line builder is internal (no replacement export, per contract) —
    // assert the built-line template names owners and carries no probability.
    const src = require("fs").readFileSync("extensions/index.ts", "utf8");
    expect(src).toMatch(/sign-off required from \$\{gap\.owners\.join\(/);
    expect(src).not.toMatch(/choiceProbability|toFixed\(2\)|≥ 0\.90/);
  });

  test("generic human gate line when owner absent", () => {
    const src = require("fs").readFileSync("extensions/index.ts", "utf8");
    expect(src).toContain(
      "— static advisory: possible ADR supersession — raise it at the human gate (advisory only)."
    );
  });

  test("supersedeAdvisoryLine export is gone (Jev probability seam removed)", async () => {
    const mod = await import("../extensions/index");
    expect("supersedeAdvisoryLine" in mod).toBe(false);
    expect("SUPERSEDE_PROBABILITY_THRESHOLD" in mod).toBe(false);
  });

  test("advisory line through the watchdog path contains no probability or threshold text", () => {
    // The extension module itself must carry no threshold text.
    const src = require("fs").readFileSync("extensions/index.ts", "utf8");
    expect(src).not.toMatch(/0\.90|choiceProbability/);
  });

  test("threshold constant removed", () => {
    const src = require("fs").readFileSync("extensions/index.ts", "utf8");
    expect(src).not.toContain("SUPERSEDE_PROBABILITY_THRESHOLD");
  });

  test("never a verdict: gaps carry owners so the advisory names sign-off targets", () => {
    const gaps = detectSupersedeGaps({
      changedFiles: ["src/x.ts"],
      adrContractsByFile: {
        "src/x.ts": [{ id: "x", label: "", adr: "7", owners: ["alice", "bob"] }],
      },
      changedSpecDecisions: [],
      newAdrFiles: [],
    });
    expect(gaps[0].owners).toEqual(["alice", "bob"]);
    const serialized = JSON.stringify(gaps);
    expect(serialized).toContain("alice");
    expect(serialized).not.toMatch(/probability|threshold|0\.90/i);
    expect(serialized).not.toMatch(/ok:\s*true/);
  });
});

/* ------------------------------ dispatcher (resolveNext) ------------------------------ */

const fs = require("fs");

// Fixture plan: three pending tasks across two waves; only the Wave 1 task
// has satisfied dependencies. House plan shape: statuses, Wave, Depends On,
// tiers, tdd flag, [PARALLEL-GROUP], env/dead-ends provenance.
const FIXTURE_THREE = `# Plan: fixture three (099)

> Plan ID: 20260101-099
> Status: APPROVED 2026-01-01 (owner)
> env: bun test runner · check-drift CLEAN · no new dependencies
> dead-ends: no agents/**, no scripts/**

## Tasks

[PARALLEL-GROUP: wave-one]

### TASK 1 (Tier B, 🟡): wave-one task — src/a.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/a.ts
- **Verify**: bun test

### TASK 2 (Tier A, ⚪): wave-two dependent — src/b.ts
- **Status**: ⬜ PENDING
- **Wave**: 2
- **Depends On**: TASK 1
- **tdd**: false
- **Allowed**: src/b.ts
- **Verify**: bun test

[PARALLEL-GROUP: wave-two]

### TASK 3 (Tier C, 🔴): wave-two sibling — src/c.ts
- **Status**: ⬜ PENDING
- **Wave**: 2
- **Depends On**: none
- **tdd**: true
- **Allowed**: src/c.ts
- **Verify**: bun test
`;

const FIXTURE_DEPS = `# Plan: fixture deps (098)

> Plan ID: 20260101-098
> Status: APPROVED 2026-01-01 (owner)

## Tasks

### TASK 1 (Tier B, 🟡): blocked-by-dep — src/a.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: TASK 2
- **tdd**: false
- **Allowed**: src/a.ts
- **Verify**: bun test

### TASK 2 (Tier A, ⚪): still open, later wave — src/b.ts
- **Status**: ⬜ PENDING
- **Wave**: 2
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/b.ts
- **Verify**: bun test
`;

const FIXTURE_STALE = `# Plan: fixture stale (096)

> Plan ID: 20260101-096
> Status: APPROVED 2026-01-01 (owner)

## Tasks

### TASK 1 (Tier B, 🟡): done without a verdict — src/a.ts
- **Status**: ✅ DONE
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/a.ts
- **Verify**: bun test

### TASK 2 (Tier A, ⚪): next after the done task — src/b.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: TASK 1
- **tdd**: false
- **Allowed**: src/b.ts
- **Verify**: bun test
`;

const FIXTURE_TIE = `# Plan: fixture tie (095)

> Plan ID: 20260101-095
> Status: APPROVED 2026-01-01 (owner)

## Tasks

### TASK 1 (Tier C, 🔴): lower tier, lower id — src/a.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/a.ts
- **Verify**: bun test

### TASK 2 (Tier A, ⚪): higher tier — src/b.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/b.ts
- **Verify**: bun test
`;

const FIXTURE_MISSING_SPEC = `# Plan: fixture missing spec (094)

> Plan ID: 20260101-094
> Status: APPROVED 2026-01-01 (owner)

## Tasks

### TASK 9 (Tier B, 🟡): contract never written — src/i.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/i.ts
- **Verify**: bun test
`;

const FIXTURE_GROUPED = `# Plan: fixture grouped (093)

> Plan ID: 20260101-093
> Status: APPROVED 2026-01-01 (owner)

## Tasks

[PARALLEL-GROUP: wave-one]

### TASK 1 (Tier B, 🟡): first — src/a.ts
- **Status**: ⬜ PENDING
- **Wave**: 1
- **Depends On**: none
- **tdd**: true
- **Allowed**: src/a.ts, tests/a.test.ts
- **Verify**: bun test

### TASK 2 (Tier B, 🟡): second — src/b.ts
- **Status**: ✅ DONE
- **Wave**: 1
- **Depends On**: none
- **tdd**: false
- **Allowed**: src/b.ts
- **Verify**: bun test

[PARALLEL-GROUP: wave-two]

### TASK 3 (Tier A, ⚪): third — src/c.ts
- **Status**: ❌ FAILED
- **Wave**: 2
- **Depends On**: TASK 1, TASK 2
- **tdd**: false
- **Allowed**: src/c.ts
- **Verify**: node scripts/dispatch-ledger.mjs report
`;

const REG: Record<string, { model: string; thinking: string; role: string }> = {
  "task-1": { model: "standard", thinking: "medium", role: "worker" },
  "task-2": { model: "standard", thinking: "medium", role: "worker" },
  "task-3": { model: "strong", thinking: "xhigh", role: "worker" },
  "task-9": { model: "standard", thinking: "medium", role: "worker" },
};

// Specs exist for every fixture task except task-9 (missing-spec case).
const readSpec = (p: string): string | null => (p.endsWith("task-9.spec") ? null : "# spec body");

const NO_REVIEWS: { name: string; content: string }[] = [];

describe("resolveNext (dispatcher)", () => {
  test("resolves the earliest eligible task", () => {
    const r = resolveNext({
      plan: FIXTURE_THREE,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    if (!r.ok) throw new Error(`expected ok, got ${r.blocked}: ${r.reason}`);
    expect(r.task.id).toBe("task-1");
    expect(r.task.wave).toBe(1);
    // shared prefix block first: GUARD line, then plan provenance
    const lines = r.pack.split("\n");
    expect(lines[0]).toMatch(/^Repo: \/repo \(GUARD: verify pwd \+ git toplevel/);
    expect(lines[1]).toContain("20260101-099");
    expect(lines[1]).toContain("fixture three");
    // env law and dead ends ride the shared block, before the divergence
    expect(r.pack.indexOf("Env: bun test runner")).toBeGreaterThan(-1);
    expect(r.pack.indexOf("Dead ends:")).toBeGreaterThan(-1);
    expect(r.pack.indexOf("Env:")).toBeLessThan(r.pack.indexOf("\nTASK 1:"));
    // per-task divergence last
    expect(r.pack).toContain("TASK 1: wave-one task — src/a.ts. Contract: .workflows/specs/task-1.spec");
    expect(r.pack).toContain("Allowed paths: src/a.ts");
    expect(r.pack).toContain("Verify: bun test");
    // gate command list leads with the contract lifecycle
    expect(r.gateCommands[0]).toBe("agent-spec lifecycle .workflows/specs/task-1.spec --code .");
    expect(r.gateCommands).toContain("bun test");
  });

  test("skips tasks with unsatisfied dependencies", () => {
    const r = resolveNext({
      plan: FIXTURE_DEPS,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocked).toBe("deps-unsatisfied");
    expect(r.reason).toContain("TASK 1");
    expect(r.reason).toContain("TASK 2");
    expect(r.reason).toContain("⬜ PENDING");
  });

  test("blocks on stale task status", () => {
    const r = resolveNext({
      plan: FIXTURE_STALE,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocked).toBe("stale-status");
    expect(r.reason).toContain("TASK 1");
    expect(r.reason).toContain("ok:true");
    // a verdict file for a DIFFERENT task (task-10) does not clear the gap
    const wrongFile = resolveNext({
      plan: FIXTURE_STALE,
      registry: REG,
      reviewFiles: [{ name: "task-10.md", content: "**ok: true**" }],
      readSpec,
      repo: "/repo",
    });
    expect(wrongFile.ok).toBe(false);
    // the right verdict file clears it — TASK 2 becomes dispatchable
    const cleared = resolveNext({
      plan: FIXTURE_STALE,
      registry: REG,
      reviewFiles: [{ name: "task-1.md", content: "## Round 1\n**ok: true**" }],
      readSpec,
      repo: "/repo",
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.task.id).toBe("task-2");
  });

  test("blocks when the referenced spec is missing (never specless dispatch)", () => {
    const r = resolveNext({
      plan: FIXTURE_MISSING_SPEC,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocked).toBe("missing-spec");
    expect(r.reason).toContain(".workflows/specs/task-9.spec");
  });

  test("breaks ties by tier (A < B < C) then task id", () => {
    const r = resolveNext({
      plan: FIXTURE_TIE,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.id).toBe("task-2"); // Tier A beats Tier C despite higher id
  });

  test("blocks on missing registry policy (never guesses model/thinking/role)", () => {
    const r = resolveNext({
      plan: FIXTURE_TIE,
      registry: { "task-1": REG["task-1"] }, // the selected Tier A task-2 has no entry
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocked).toBe("no-policy");
    expect(r.reason).toContain("task-2");
  });

  test("wave discipline: eligibleTasks returns only the earliest wave", () => {
    const { eligible, blocked } = eligibleTasks({
      plan: FIXTURE_THREE,
      registry: REG,
      reviewFiles: NO_REVIEWS,
      readSpec,
      repo: "/repo",
    });
    expect(blocked).toBeNull();
    expect(eligible.map((t) => t.id)).toEqual(["task-1"]); // wave-2 tasks wait
  });

  test("blocks no-pending when the plan is complete", () => {
    const r = resolveNext({
      plan: FIXTURE_GROUPED.replace(/⬜ PENDING/g, "✅ DONE"),
      registry: REG,
      reviewFiles: [{ name: "task-1.md", content: "**ok: true**" }],
      readSpec,
      repo: "/repo",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocked).toBe("no-pending");
  });

  test("orders a wave by model then thinking then role", () => {
    const wave = [
      { id: "task-4", model: "standard", thinking: "medium", role: "worker" },
      { id: "task-1", model: "strong", thinking: "xhigh", role: "worker" },
      { id: "task-2", model: "strong", thinking: "xhigh", role: "worker" },
      { id: "task-3", model: "strong", thinking: "high", role: "reviewer" },
    ];
    const ordered = orderWave(wave);
    expect(ordered.map((t) => t.id)).toEqual(["task-4", "task-3", "task-1", "task-2"]);
    // tasks sharing model and role are adjacent
    const ids = ordered.map((t) => t.id);
    expect(Math.abs(ids.indexOf("task-1") - ids.indexOf("task-2"))).toBe(1);
    // no two consecutive tasks differ in model when a same-model ordering
    // exists: same-model tasks form contiguous runs (one boundary per
    // distinct model minus one)
    const models = ordered.map((t) => t.model);
    const transitions = models.slice(1).filter((m, i) => m !== models[i]).length;
    expect(transitions).toBe(new Set(models).size - 1);
  });

  test("ramps same-model launches as contiguous runs", () => {
    const mk = (i: number, model: string) => ({
      id: `task-${i}`,
      model,
      thinking: "medium",
      role: "worker",
    });
    const shuffled = [
      mk(1, "strong"),
      mk(2, "standard"),
      mk(3, "strong"),
      mk(4, "standard"),
      mk(5, "strong"),
      mk(6, "standard"),
    ];
    const ordered = orderWave(shuffled);
    const models = ordered.map((t) => t.model);
    const transitions = models.slice(1).filter((m, i) => m !== models[i]).length;
    expect(transitions).toBe(1); // all standard, then all strong
    expect(new Set(models.slice(0, 3))).toEqual(new Set(["standard"]));
    expect(new Set(models.slice(3))).toEqual(new Set(["strong"]));
  });

  test("pack prefix is shared across tasks of the same plan (cache affinity)", () => {
    const prov = parseProvenance(FIXTURE_THREE);
    const tasks = parsePlan(FIXTURE_THREE);
    const policy = { model: "standard", thinking: "medium", role: "worker" };
    const a = buildPack({ ...tasks[0], ...policy }, prov, "/repo");
    const b = buildPack({ ...tasks[1], ...policy }, prov, "/repo");
    expect(a.split("\n\n")[0]).toBe(b.split("\n\n")[0]); // shared prefix block
    expect(a.split("\n\n")[1]).toContain("TASK 1:"); // divergence last
    expect(b.split("\n\n")[1]).toContain("TASK 2:");
  });

  test("gateCommandsFor: lifecycle first, tdd-gate lines when flagged, verify last", () => {
    const tasks = parsePlan(FIXTURE_GROUPED);
    const policy = { model: "standard", thinking: "medium", role: "worker" };
    expect(gateCommandsFor({ ...tasks[0], ...policy })).toEqual([
      "agent-spec lifecycle .workflows/specs/task-1.spec --code .",
      "tdd-gate gaming --diff",
      "tdd-gate drift --spec .workflows/specs/task-1.spec",
      "bun test",
    ]);
    expect(gateCommandsFor({ ...tasks[1], ...policy })).toEqual([
      "agent-spec lifecycle .workflows/specs/task-2.spec --code .",
      "bun test",
    ]);
  });

  test("parsePlan reads statuses, waves, deps, tiers, tags, tdd, parallel groups", () => {
    const tasks = parsePlan(FIXTURE_GROUPED);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      id: "task-1",
      num: "1",
      tier: "B",
      tag: "🟡",
      status: "pending",
      wave: 1,
      deps: [],
      tdd: true,
      parallelGroup: "wave-one",
      allowed: ["src/a.ts", "tests/a.test.ts"],
      verify: "bun test",
      contractPath: ".workflows/specs/task-1.spec",
    });
    expect(tasks[1].status).toBe("done");
    expect(tasks[2]).toMatchObject({
      id: "task-3",
      tier: "A",
      status: "failed",
      wave: 2,
      deps: ["task-1", "task-2"],
      parallelGroup: "wave-two",
      verify: "node scripts/dispatch-ledger.mjs report",
    });
  });

  test("verdictOnFile matches the task's own review file, not task-10 for task-1", () => {
    const files = [
      { name: "task-10.md", content: "**ok: true**" },
      { name: "task-1.md", content: "no verdict yet" },
    ];
    expect(verdictOnFile("task-1", files)).toBe(false);
    expect(
      verdictOnFile("task-1", [
        { name: "task-1.md", content: "round 2\n**ok: true**" },
      ])
    ).toBe(true);
  });

  test("next prompt is a thin trigger", () => {
    for (const f of ["prompts/next.md", "prompts/auto-next.md"]) {
      const src = fs.readFileSync(f, "utf8");
      // selection is delegated to the dispatcher and its result is read
      // before any dispatch
      expect(src).toContain("resolveNext");
      expect(src).toMatch(/before any dispatch/i);
      expect(src.indexOf("resolveNext")).toBeLessThan(src.indexOf("agents/dispatch-shapes.md"));
      // no wave-selection or dependency-resolution prose remains
      expect(src).not.toMatch(/select the task|pick the first|wave discipline|all dependencies/i);
    }
  });
});

/* --------------------------- auto-gate hook (T3) --------------------------- */

const AUTO_PLAN = `# Plan: gate fixture

> Plan ID: 20261025-999

### TASK 1 (Tier B, 🟡): gate fixture task one
- **Status**: ⬜ PENDING
- **Allowed**: src/**

### TASK 2 (Tier B): gate fixture task two
- **Status**: ⬜ PENDING
- **Allowed**: lib/**
`;

describe("matchesAllowed", () => {
  test("exact path, dir glob, and suffix glob shapes", () => {
    expect(matchesAllowed("extensions/index.ts", ["extensions/index.ts", "tests/**"])).toBe(true);
    expect(matchesAllowed("src/a/b.ts", ["src/**"])).toBe(true);
    expect(matchesAllowed("docs/x.md", ["docs/*"])).toBe(true);
    expect(matchesAllowed("workflows/specs/a.spec", ["*.spec"])).toBe(true);
  });
  test("non-matches and empty allowed lists", () => {
    expect(matchesAllowed("lib/evil.ts", ["src/**"])).toBe(false);
    expect(matchesAllowed("srcx/a.ts", ["src/**"])).toBe(false);
    expect(matchesAllowed("src/a.ts", [])).toBe(false);
    expect(matchesAllowed("src/a.ts", ["", "  "])).toBe(false);
  });
});

describe("firstFindingsLine", () => {
  test("prefers the guard findings bullet", () => {
    const out = "agent-spec guard: FAILED\n  - task-1.spec: outside Allowed Changes\nerror: 1 failed";
    expect(firstFindingsLine(out)).toBe("- task-1.spec: outside Allowed Changes");
  });
  test("falls back to a bold scenario marker then the first line", () => {
    expect(firstFindingsLine("## Verification Failed\n\n**scenario one**\n- verdict: Fail")).toBe(
      "**scenario one**"
    );
    expect(firstFindingsLine("plain failure text")).toBe("plain failure text");
    expect(firstFindingsLine("")).toBe("no findings in output");
  });
});

describe("toRepoRelative", () => {
  test("relative and absolute inside the root; null outside or empty", () => {
    expect(toRepoRelative("/r", "src/a.ts")).toBe("src/a.ts");
    expect(toRepoRelative("/r", "/r/src/a.ts")).toBe("src/a.ts");
    expect(toRepoRelative("/r", "../outside.ts")).toBe(null);
    expect(toRepoRelative("/r", "")).toBe(null);
  });
});

describe("autoGate (injected fakes)", () => {
  const STAGED: Record<string, string> = {
    ".workflows/specs/task-1.spec": "/staged/task-1",
    ".workflows/specs/task-2.spec": "/staged/task-2",
  };
  const stage = (p: string) => STAGED[p] ?? null;

  test("inert without tasks or for docs markdown outside spec dirs", () => {
    const run: GateRunner = () => {
      throw new Error("gate commands must not run");
    };
    expect(autoGate({ file: "src/a.ts", plan: "no tasks here", stageSpec: stage, run })).toEqual({
      action: "inert",
    });
    expect(
      autoGate({ file: "docs/notes.md", plan: AUTO_PLAN, stageSpec: stage, run })
    ).toEqual({ action: "inert" });
    expect(
      autoGate({ file: ".workflows/plan.md", plan: AUTO_PLAN, stageSpec: stage, run })
    ).toEqual({ action: "inert" });
  });

  test("matched file runs the ordered chain with exact argv", () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const run: GateRunner = (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: '{"passed": true}', stderr: "" };
    };
    const d = autoGate({ file: "src/a.ts", plan: AUTO_PLAN, stageSpec: stage, run });
    expect(d.action).toBe("allow");
    expect(calls.map((c) => c.cmd)).toEqual(["agent-spec", "agent-spec", "tdd-gate", "tdd-gate"]);
    expect(calls[0].args).toEqual([
      "guard",
      "--spec-dir",
      "/staged/task-1",
      "--code",
      ".",
      "--change",
      "src/a.ts",
      "--change-scope",
      "worktree",
    ]);
    expect(calls[1].args).toEqual([
      "lifecycle",
      ".workflows/specs/task-1.spec",
      "--code",
      ".",
      "--format",
      "json",
    ]);
    expect(calls[2].args).toEqual(["gaming", "--diff"]);
    expect(calls[3].args).toEqual(["drift", "--spec", ".workflows/specs/task-1.spec"]);
  });

  test("guard failure blocks the boundary layer with the first finding", () => {
    const run: GateRunner = (cmd, args) =>
      cmd === "agent-spec" && args[0] === "guard"
        ? {
            // real agent-spec guard prints its findings on stderr
            code: 1,
            stdout: "",
            stderr:
              "agent-spec guard: FAILED\n  - task-1.spec: change src/a.ts outside Allowed Changes (src/**)\nerror: 1 failed",
          }
        : { code: 0, stdout: '{"passed": true}', stderr: "" };
    const d = autoGate({ file: "src/a.ts", plan: AUTO_PLAN, stageSpec: stage, run });
    expect(d.action).toBe("block");
    if (d.action !== "block") return;
    expect(d.layer).toBe("Layer 1 boundary (agent-spec guard)");
    expect(d.command).toContain("agent-spec guard --spec-dir /staged/task-1");
    expect(d.reason).toContain("outside Allowed Changes");
  });

  test("lifecycle failure blocks with the failing scenario as findings line", () => {
    const run: GateRunner = (cmd, args) => {
      if (cmd === "agent-spec" && args[0] === "guard") return { code: 0, stdout: "PASSED", stderr: "" };
      if (cmd === "agent-spec" && args[0] === "lifecycle")
        return {
          code: 1,
          stdout:
            '{"passed": false, "failure_summary": "## Verification Failed\\n\\n**honors contract boundaries**\\n- verdict: Fail", "verification": {"results": [{"scenario_name": "honors contract boundaries", "verdict": "fail"}]}}',
        };
      return { code: 0, stdout: "", stderr: "" };
    };
    const d = autoGate({ file: "src/a.ts", plan: AUTO_PLAN, stageSpec: stage, run });
    expect(d.action).toBe("block");
    if (d.action !== "block") return;
    expect(d.layer).toBe("Layer 1 lifecycle (agent-spec)");
    expect(d.command).toBe(
      "agent-spec lifecycle .workflows/specs/task-1.spec --code . --format json"
    );
    expect(d.reason).toContain("honors contract boundaries (verdict fail)");
  });

  test("tdd-gate gaming then drift block the Layer 2 sub-steps", () => {
    const gamingFail: GateRunner = (cmd, args) => {
      if (cmd === "tdd-gate" && args[0] === "gaming")
        return { code: 1, stdout: "", stderr: "tdd-gate: gaming detected: assertion removed" };
      return { code: 0, stdout: '{"passed": true}', stderr: "" };
    };
    const d1 = autoGate({ file: "src/a.ts", plan: AUTO_PLAN, stageSpec: stage, run: gamingFail });
    expect(d1.action).toBe("block");
    if (d1.action === "block") {
      expect(d1.layer).toBe("Layer 2 test-quality (tdd-gate gaming)");
      expect(d1.command).toBe("tdd-gate gaming --diff");
    }
    const driftFail: GateRunner = (cmd, args) => {
      if (cmd === "tdd-gate" && args[0] === "drift")
        return { code: 1, stdout: "", stderr: "- task-1.spec: drifted from tests" };
      return { code: 0, stdout: '{"passed": true}', stderr: "" };
    };
    const d2 = autoGate({ file: "src/a.ts", plan: AUTO_PLAN, stageSpec: stage, run: driftFail });
    expect(d2.action).toBe("block");
    if (d2.action === "block") {
      expect(d2.layer).toBe("Layer 2 test-quality (tdd-gate drift)");
      expect(d2.command).toBe("tdd-gate drift --spec .workflows/specs/task-1.spec");
      expect(d2.reason).toContain("- task-1.spec: drifted from tests");
    }
  });

  test("unclaimed files: blocked only when every task spec rejects, allowed when one passes", () => {
    let guardMode: "all-fail" | "t2-pass" = "all-fail";
    const run: GateRunner = (cmd, args) => {
      if (cmd === "agent-spec" && args[0] === "guard") {
        const pass = guardMode === "t2-pass" && args[2] === "/staged/task-2";
        return pass
          ? { code: 0, stdout: "PASSED", stderr: "" }
          : { code: 1, stdout: "", stderr: "  - spec: change other/x.ts is outside Allowed Changes" };
      }
      return { code: 0, stdout: '{"passed": true}', stderr: "" };
    };
    const d1 = autoGate({ file: "other/x.ts", plan: AUTO_PLAN, stageSpec: stage, run });
    expect(d1.action).toBe("block");
    if (d1.action === "block") {
      expect(d1.layer).toBe("Layer 1 boundary (agent-spec guard)");
      expect(d1.reason).toContain("outside Allowed Changes");
    }
    guardMode = "t2-pass";
    const d2 = autoGate({ file: "other/x.ts", plan: AUTO_PLAN, stageSpec: stage, run });
    expect(d2).toEqual({ action: "allow" });
  });

  test("advises when the spec is missing or the toolchain cannot run", () => {
    const d1 = autoGate({
      file: "src/a.ts",
      plan: AUTO_PLAN,
      stageSpec: () => null,
      run: () => {
        throw new Error("must not run without a staged spec");
      },
    });
    expect(d1.action).toBe("advisory");
    if (d1.action === "advisory") expect(d1.line).toContain("task-1.spec");
    const d2 = autoGate({
      file: "src/a.ts",
      plan: AUTO_PLAN,
      stageSpec: stage,
      run: () => null,
    });
    expect(d2.action).toBe("advisory");
    if (d2.action === "advisory") {
      expect(d2.key).toBe("src/a.ts");
      expect(d2.line).toContain("agent-spec");
    }
  });
});

describe("runGate", () => {
  test("captures exit codes and both streams; null when the binary is missing", () => {
    const ok = runGate("sh", ["-c", "echo out; echo err 1>&2; exit 3"], ".");
    expect(ok).not.toBeNull();
    expect(ok!.code).toBe(3);
    expect(ok!.stdout).toBe("out");
    expect(ok!.stderr).toBe("err");
    expect(runGate("definitely-not-a-real-gate-binary-xyz", [], ".")).toBeNull();
  });
});

/* ---------------------- auto-gate wiring (PATH-shimmed) ---------------------- */

const AGENT_SPEC_SHIM = `#!/bin/sh
echo "agent-spec $1" >> "$AGENT_SPEC_JOURNAL"
case "$1" in
  guard)
    if [ "$GUARD_MODE" = "fail" ]; then
      echo "agent-spec guard: FAILED"
      echo "  - task-1.spec: change is outside Allowed Changes (src/**)"
      exit 1
    fi
    echo "agent-spec guard: PASSED"
    exit 0
    ;;
  lifecycle)
    if [ "$LIFECYCLE_MODE" = "fail" ]; then
      echo '{"passed": false, "failure_summary": "## Verification Failed\\n\\n### Non-passing Scenarios\\n\\n**honors contract boundaries**\\n- verdict: Fail"}'
    elif [ "$LIFECYCLE_MODE" = "skip" ]; then
      echo '{"passed": false, "failure_summary": "no verifier covered this step", "verification": {"results": [{"scenario_name": "honors contract boundaries", "verdict": "skip"}]}}'
    else
      echo '{"passed": true, "verification": {"results": []}}'
    fi
    exit 0
    ;;
esac
exit 0
`;

const TDD_GATE_SHIM = `#!/bin/sh
echo "tdd-gate $1" >> "$TDD_JOURNAL"
if [ "$TDD_MODE" = "fail" ]; then
  echo "tdd-gate: gaming detected: assertion removed in src/a.test.ts"
  exit 1
fi
exit 0
`;

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-proj-"));
  fs.mkdirSync(path.join(dir, ".workflows", "specs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".workflows", "plan.md"), AUTO_PLAN);
  fs.writeFileSync(path.join(dir, ".workflows", "specs", "task-1.spec"), "spec: task\nname: x\n");
  fs.writeFileSync(path.join(dir, ".workflows", "specs", "task-2.spec"), "spec: task\nname: y\n");
  return dir;
}

function makeBinDir(entries: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-bin-"));
  for (const [name, body] of Object.entries(entries)) {
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
  }
  return dir;
}

function harness(projDir: string) {
  const handlers: Record<string, ((ev: any, ctx: any) => Promise<any>)[]> = {};
  register({ on: (ev: string, fn: any) => (handlers[ev] ??= []).push(fn) } as any);
  const notifications: { message: string; level: string }[] = [];
  const call = async (toolName: string, input: any) => {
    const start = notifications.length; // per-call slice — the array is cumulative
    const ctx = {
      cwd: projDir,
      hasUI: true,
      ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    };
    let result: any;
    for (const h of handlers.tool_call ?? []) {
      result = await h({ type: "tool_call", toolCallId: "t", toolName, input }, ctx);
      if (result) break;
    }
    return { result, notifications: notifications.slice(start) };
  };
  return { call, notifications };
}
async function withGateEnv(
  binDir: string | null,
  modes: Record<string, string>,
  body: (env: { journal: string; tddJournal: string }) => Promise<void> | void
): Promise<void> {
  const savedPath = process.env.PATH;
  const savedModes: Record<string, string | undefined> = {};
  const journal = fs.mkdtempSync(path.join(os.tmpdir(), "t3-journal-"));
  const journalFile = path.join(journal, "agent-spec.log");
  const tddJournalFile = path.join(journal, "tdd-gate.log");
  fs.writeFileSync(journalFile, "");
  fs.writeFileSync(tddJournalFile, "");
  for (const [k, v] of Object.entries(modes)) {
    savedModes[k] = process.env[k];
    process.env[k] = v;
  }
  process.env.AGENT_SPEC_JOURNAL = journalFile;
  process.env.TDD_JOURNAL = tddJournalFile;
  const emptyDir = binDir === null ? makeBinDir({}) : null;
  process.env.PATH = (binDir ?? emptyDir)!;
  try {
    await body({ journal: journalFile, tddJournal: tddJournalFile });
  } finally {
    process.env.PATH = savedPath;
    for (const [k, v] of Object.entries(savedModes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.AGENT_SPEC_JOURNAL;
    delete process.env.TDD_JOURNAL;
  }
}

describe("auto-gate wiring (PATH-shimmed)", () => {
  test("blocks a code write that violates contract boundaries", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM });
    const h = harness(proj);
    // plan allows only src/** — a write outside Allowed Changes is probed by
    // guard and rejected unanimously.
    await withGateEnv(bin, { GUARD_MODE: "fail" }, async () => {
      const { result } = await h.call("write", { path: "lib/evil.ts", content: "x" });
      expect(result?.block).toBe(true);
      expect(result.reason).toContain("Layer 1 boundary (agent-spec guard)");
      expect(result.reason).toContain("agent-spec guard --spec-dir");
      expect(result.reason).toContain("outside Allowed Changes (src/**)");
      expect(result.reason).toContain("lib/evil.ts");
    });
  });

  test("blocks when a lifecycle scenario fails", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(
      bin,
      { GUARD_MODE: "pass", LIFECYCLE_MODE: "fail" },
      async () => {
        const { result } = await h.call("edit", { path: "src/a.ts", edits: [] });
        expect(result?.block).toBe(true);
        expect(result.reason).toContain("Layer 1 lifecycle (agent-spec)");
        expect(result.reason).toContain("agent-spec lifecycle .workflows/specs/task-1.spec");
        expect(result.reason).toContain("**honors contract boundaries**");
      }
    );
  });

  test("passes with limitation when lifecycle is skip-only", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, { LIFECYCLE_MODE: "skip" }, async () => {
      const { result } = await h.call("edit", { path: "src/a.ts", edits: [] });
      expect(result?.block).toBe(false);
    });
  });

  test("blocks on real scenario failure but not skip-only", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, { LIFECYCLE_MODE: "fail" }, async () => {
      const { result } = await h.call("edit", { path: "src/a.ts", edits: [] });
      expect(result?.block).toBe(true);
    });
    await withGateEnv(bin, { LIFECYCLE_MODE: "skip" }, async () => {
      const { result } = await h.call("edit", { path: "src/a.ts", edits: [] });
      expect(result?.block).toBe(false);
    });
  });

  test("advises and allows when the toolchain is absent", async () => {
    const proj = makeProject();
    const h = harness(proj);
    await withGateEnv(null, {}, async () => {
      const { result, notifications } = await h.call("write", {
        path: "src/a.ts",
        content: "x",
      });
      // write proceeds: an explicit non-block, not a block
      expect(result?.block).toBe(false);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain("agent-spec");
      expect(notifications[0].message).toContain("src/a.ts");
    });
  });

  test("skips docs only markdown writes", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, { GUARD_MODE: "fail", TDD_MODE: "fail" }, async (env) => {
      for (const p of ["docs/notes.md", ".workflows/plan.md"]) {
        const { result, notifications } = await h.call("write", { path: p, content: "x" });
        expect(result).toBeUndefined();
        expect(notifications).toHaveLength(0);
      }
      // no gate command ran for either write
      expect(fs.readFileSync(env.journal, "utf8")).toBe("");
      expect(fs.readFileSync(env.tddJournal, "utf8")).toBe("");
    });
  });

  test("advises once per file (watchdog dedupe)", async () => {
    const proj = makeProject();
    const h = harness(proj);
    await withGateEnv(null, {}, async () => {
      const r1 = await h.call("write", { path: "src/a.ts", content: "1" });
      const r2 = await h.call("edit", { path: "src/a.ts", edits: [] });
      const r3 = await h.call("write", { path: "src/b.ts", content: "2" });
      expect(r1.result?.block).toBe(false);
      expect(r2.result?.block).toBe(false);
      expect(r3.result?.block).toBe(false);
      expect(r1.notifications).toHaveLength(1);
      expect(r2.notifications).toHaveLength(0); // same file — deduped
      expect(r3.notifications).toHaveLength(1); // different file — its own advisory
      expect(r1.notifications[0].message).toContain("agent-spec");
      expect(r3.notifications[0].message).toContain("agent-spec");
    });
  });

  test("allows a clean write when every gate layer passes", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, {}, async (env) => {
      const { result, notifications } = await h.call("write", { path: "src/a.ts", content: "x" });
      expect(result).toBeUndefined();
      expect(notifications).toHaveLength(0);
      const journal = fs.readFileSync(env.journal, "utf8");
      expect(journal).toContain("agent-spec guard");
      expect(journal).toContain("agent-spec lifecycle");
      expect(fs.readFileSync(env.tddJournal, "utf8")).toContain("tdd-gate gaming");
    });
  });

  test("blocks on a tdd-gate gaming failure (Layer 2)", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM, "tdd-gate": TDD_GATE_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, { GUARD_MODE: "pass", TDD_MODE: "fail" }, async () => {
      const { result } = await h.call("write", { path: "src/a.ts", content: "x" });
      expect(result?.block).toBe(true);
      expect(result.reason).toContain("Layer 2 test-quality (tdd-gate gaming)");
      expect(result.reason).toContain("gaming detected: assertion removed");
    });
  });

  test("advises once when tdd-gate is absent but Layer 1 still gates", async () => {
    const proj = makeProject();
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM }); // no tdd-gate on PATH
    const h = harness(proj);
    await withGateEnv(bin, { GUARD_MODE: "pass" }, async (env) => {
      const { result, notifications } = await h.call("write", { path: "src/a.ts", content: "x" });
      expect(result?.block).toBe(false);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain("tdd-gate");
      expect(notifications[0].message).toContain("Layer 1 still gated");
      // Layer 1 actually ran: guard + lifecycle in the journal
      const journal = fs.readFileSync(env.journal, "utf8");
      expect(journal).toContain("agent-spec guard");
      expect(journal).toContain("agent-spec lifecycle");
    });
  });

  test("hook is inert without a live plan", async () => {
    const proj = makeProject();
    fs.unlinkSync(path.join(proj, ".workflows", "plan.md"));
    const bin = makeBinDir({ "agent-spec": AGENT_SPEC_SHIM });
    const h = harness(proj);
    await withGateEnv(bin, { GUARD_MODE: "fail" }, async (env) => {
      const { result, notifications } = await h.call("write", { path: "lib/evil.ts", content: "x" });
      expect(result).toBeUndefined();
      expect(notifications).toHaveLength(0);
      expect(fs.readFileSync(env.journal, "utf8")).toBe("");
    });
  });
});
