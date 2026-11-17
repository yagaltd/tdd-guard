# Changelog

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
