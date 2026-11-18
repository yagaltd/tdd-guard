# Changelog

## 0.1.4 — rust module-path selector fix

The 0.1.3 rust binding was partial: integration tests list with bare names
(exact match worked in the fixture E2E), but src-colocated `#[cfg(test)]`
tests list with full module paths (`spec_verify::boundaries::tests::test_x`).
Verify matched selectors by exact set membership, so every module-path name
mismatched and real cargo repos reported all selectors not-found. Verify now
matches the bare selector name against the listing's `::`-anchored suffix —
exact matching only worked for integration tests.

## 0.1.3 — Rust binding + shared discovery

### The defect

`tdd-guard verify` resolved `Test:` selectors by JS-parsing test files, so
Rust tests were invisible: every `verify` run over a cargo project reported
its selectors not-found. Three independent reviews hit this same wall. At the
same time, test discovery existed in three private variants — lint's probed
`tests/` → `test/` → src-colocated and failed loudly on empty scans, while
verify and mutate hardcoded a `tests` default and never noticed an empty
scan.

### Fix

- **Rust binding.** When the target repo has a `Cargo.toml`, `verify`
  resolves selectors via `cargo test --quiet -- --list` — the runner's own
  inventory — instead of JS parsing. Per-selector verdicts and loud exit
  semantics are unchanged; JavaScript resolution is unchanged.
- **One discovery implementation.** `lint`, `verify`, and `mutate` now share
  `src/discovery.ts` (segment-exact `.git`/`node_modules` exclusion,
  `tests/` → `test/` → src-colocated probing, loud zero-file failure). The
  hardcoded `--tests tests` CLI defaults are gone: an explicit `--tests` wins
  everywhere, and zero-file scans fail loudly everywhere. `verify` gains a
  `--src` flag to match.
- **Hygiene.** The README documents `--allow-empty`, the probe order, the
  zero-files behavior, and the Rust binding; the vitest config excludes
  `.git/**` so root runs stop sweeping pi subagent worktree fixtures.

The six lint rules' semantics are unchanged.

## 0.1.2 — vacuous-lint fix

### The defect class

`tdd-guard lint` filtered glob hits with `!f.includes(".git")` — on **absolute**
paths. Any run from a working directory whose path contains `.git` (for
example every pi subagent worktree, `<repo>/.git/subagents/<run>/<worker>/`)
filtered out **all** test files. With zero test files, every rule trivially
had nothing to flag and the run printed a green PASS: **every lint run inside
a subagent worktree was a silent green — the gate could not see its own test
files.** The same substring also swallowed legitimate `.github/` paths.

### Fix

- **Segment-exact exclusion.** Each glob hit is made relative to its scan
  root and filtered on whole path components: only a component exactly `.git`
  or `node_modules` is excluded. Worktree paths, `.github/`, and names merely
  containing "git" (e.g. `digit.ts`) all survive. Dot-directories are now
  scanned (`dot: true`) so `.github/` test files are visible at all.
- **Zero files = loud failure.** A lint run that discovers zero test files
  throws and the CLI exits non-zero with a message naming the scanned roots.
  Passing `--allow-empty` accepts an empty scan explicitly. Silent vacuous
  passes are extinct.
- **Discovery probing.** When `--tests` is not passed explicitly, lint probes
  `tests/`, then `test/`, then falls back to src-colocated tests. An explicit
  flag always wins.

Rule semantics (the six lint rules) are unchanged.
