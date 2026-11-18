# Changelog

## 0.1.6 — python repos classified, selector match anchored, lock version truthful

### The defects

- **Python-only repos got a dishonest lint run.** Like rust repos before
  0.1.5, a python-only scan either hit the zero-files loud failure (exit 1,
  "found 0 test files") or — when discovery could see the `.py` files — fell
  through to the JavaScript rules over python files and printed a vacuous
  green: rule checks "passing" over code nobody parsed.
- **verify's selector match was substring-loose.** The content leg resolved a
  selector with a bare `includes()`, so the selector `test_my_pin`
  false-positived on a test file containing only `test_my_pin_extended`.
- **package-lock.json lied about the version.** package.json had moved on to
  0.1.5 while the lock's root version still said 0.1.1.

### Fix

- **SKIPPED-PY classification.** Mirrors SKIPPED-RUST exactly: when every
  discovered test file ends `.py` — or the repo has a `pyproject.toml` and no
  JS-parseable test files were discovered — lint prints a loud `SKIPPED-PY`
  line to stderr naming the command and the reason (the JS parser cannot
  evaluate python) and exits 0 with an honest empty result. Mixed repos
  evaluate the JS files normally and note the python skip in the same loud
  line. The JavaScript zero-files guard is unchanged. Python test quality is
  enforced by mutmut via `tdd-guard mutate`.
- **Word-anchored selector match.** The content leg escapes the selector and
  matches between word boundaries, so a selector only resolves where it
  appears as a whole identifier. Exact-name and cargo-listing `::`-suffix
  legs are unchanged.
- **Version sync.** package.json and package-lock.json both say 0.1.6, and a
  pin keeps the lock's root version equal to package.json going forward.

## 0.1.5 — lint classifies Rust repositories (SKIPPED-RUST)

### The defect

`tdd-guard lint` loud-failed on Rust repositories instead of classifying
them. Rust test files were invisible to lint's discovery — the rust pattern
needs a `tests` path segment that never exists when scanning from inside the
test dir — so every cargo repo hit the zero-files guard: exit 1, "found 0
test files". And `--allow-empty` on a cargo repo printed a vacuous green:
every rule passing over a scan that never saw a rust test file. Verify's
rust binding (0.1.4) already resolved selectors through the cargo listing —
lint classification completes the rust story.

### Fix

- **Classification, not parsing.** When every discovered lint test file ends
  `.rs` — or the project has a `Cargo.toml` at cwd and zero JS-parseable test
  files were discovered — lint prints a loud `SKIPPED-RUST` line to stderr
  naming the command and the reason (the JS parser cannot evaluate rust) and
  exits 0 with no rule checks: neither a failure nor a vacuous pass. No
  parser changes; the six rules and their semantics are untouched.
- **Mixed repositories.** JS test files are evaluated normally; the rust
  skip is noted in the same loud line.
- **JS guard unchanged.** A JavaScript repository whose scan finds zero test
  files still exits 1 loudly (the 067 semantics), with or without
  `--allow-empty` being needed.
- **Version sync.** The CLI `--version` string now matches package.json
  (0.1.5); the 0.1.4 fix round missed the string.

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
