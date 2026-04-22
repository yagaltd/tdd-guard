# tdd-guard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Test quality enforcement for codebases where you care whether tests are actually trustworthy.

`tdd-guard` is a standalone CLI. It scans your source and test files, then fails on common weak-test patterns: skipped tests, assertionless tests, internal mocks, tests that import private implementation paths, and implementation-coupled assertions.

It can be used in two ways:

- **Standalone** in any JavaScript/TypeScript, Rust, or Python project.
- **As part of pi-workflows**, where it becomes one of the mechanical contract-gate checks via `agent-spec --layers tdd-guard`.

You do not need to know or use agent-spec to use the main `lint` command.

## Install

### Global install (recommended for pi-workflows)

From GitHub:

```bash
npm install -g github:yagaltd/tdd-guard
```

Or clone and link for a stable install:

```bash
git clone https://github.com/yagaltd/tdd-guard.git ~/code/tdd-guard
cd ~/code/tdd-guard && npm install && npm link
```

### Per-project install

```bash
npm install --save-dev github:yagaltd/tdd-guard
```

Then run:

```bash
npx tdd-guard lint
```

## Quick Start

Run the default lint checks:

```bash
npx tdd-guard lint
```

Use explicit source and test folders:

```bash
npx tdd-guard lint --src src --tests tests
```

Use text output for humans:

```bash
npx tdd-guard lint --format text
```

Use JSON output for automation:

```bash
npx tdd-guard lint --format json
```

Exit codes are simple:

| Exit code | Meaning |
|---|---|
| `0` | All enabled error-level rules passed |
| `1` | At least one enabled error-level rule failed |

## What It Checks

| Rule | Default | Detects |
|---|---:|---|
| `no-internal-mocks` | error | `jest.mock()` or `vi.mock()` against internal modules instead of real boundaries |
| `no-skipped-tests` | error | `.skip`, `.todo`, `xit`, `xdescribe` |
| `no-assertionless-tests` | error | Test cases with no `expect`, `assert`, or equivalent assertion |
| `public-interface-only` | error | Tests importing private/internal implementation paths |
| `test-per-export` | warn | Public exports without matching tests |
| `no-implementation-coupling` | warn | Tests asserting call counts, call order, or other implementation details |

The default posture is intentionally strict for errors and advisory for coverage/coupling warnings.

## Configuration

Create `.tdd-guard.json` in your project root:

```json
{
  "boundary_modules": ["stripe", "sendgrid", "aws-sdk", "./lib/external/*"],
  "public_api_exports": ["src/index.ts", "src/routes/*"],
  "internal_paths": ["src/lib/**", "src/services/**"],
  "lint": {
    "rules": {
      "no-internal-mocks": "error",
      "no-skipped-tests": "error",
      "no-assertionless-tests": "error",
      "public-interface-only": "error",
      "test-per-export": "warn",
      "no-implementation-coupling": "warn"
    }
  },
  "mutation": {
    "threshold": 60,
    "strategy": "quick",
    "ignore": ["**/*.test.ts", "**/index.ts"]
  }
}
```

Rule values can be `"error"`, `"warn"`, or `"off"`.

## Commands

### `lint`

Static analysis of test quality. This is the primary standalone command.

```bash
npx tdd-guard lint \
  --src src \
  --tests tests \
  --config .tdd-guard.json \
  --format text
```

JSON output:

```json
{
  "command": "lint",
  "exit_code": 1,
  "checks": [
    {
      "rule": "no-skipped-tests",
      "status": "fail",
      "violations": [
        {
          "file": "tests/auth.test.ts",
          "line": 5,
          "message": "Skipped test: \"handles expired tokens\" — remove skip/todo or implement the test.",
          "severity": "error"
        }
      ]
    }
  ]
}
```

### `mutate`

Mutation testing wrapper. This command delegates to the mutation tool for your language and normalizes the result.

```bash
npx tdd-guard mutate --src src --tests tests --threshold 60
```

| Language | Tool |
|---|---|
| JavaScript/TypeScript | Stryker |
| Rust | cargo-mutants |
| Python | mutmut |

Install the underlying tool first. For example:

```bash
npm install --save-dev @stryker-mutator/core
```

Use incremental mode to mutate only files changed since a git ref:

```bash
npx tdd-guard mutate --since HEAD~1
```

### `verify`

Checks whether tests cover a contract/spec file. This command is optional and is mainly useful when another tool generates or maintains task specs.

```bash
npx tdd-guard verify --spec specs/task-auth.spec --tests tests
```

The spec format expected by `verify` is simple:

```markdown
## Decisions
- Password tokens use crypto.randomUUID()
- Expired sessions return 401

## Boundaries

### Allowed Changes
- `src/auth/**`

Scenario: expired session is rejected
  Test: test_expired_session_returns_401
```

`verify` checks:

- decisions have likely matching test coverage
- allowed boundary paths have related tests
- `Test:` selectors exist in the test suite

This command can be used with agent-spec-generated contracts, but it is not limited to agent-spec.

## Standalone Usage

For a normal project, start with only `lint`:

```bash
npx tdd-guard lint --format text
```

A practical local quality script:

```json
{
  "scripts": {
    "test:quality": "tdd-guard lint --format text"
  }
}
```

Then run:

```bash
npm run test:quality
```

For CI:

```yaml
- run: npm ci
- run: npm test
- run: npx tdd-guard lint
```

## Using With pi-workflows

[pi-workflows](https://github.com/yagaltd/pi-workflows) uses `tdd-guard` as a required contract gate, integrated through `agent-spec`'s `--layers` flag.

The gate runs:

```bash
agent-spec lifecycle specs/task.spec --code . --layers lint,boundary,test,tdd-guard
```

Or standalone:

```bash
tdd-guard lint --config .tdd-guard.json
tdd-guard verify --spec specs/task.spec --config .tdd-guard.json
```

`tdd-guard` is a required dependency of pi-workflows. Install:

```bash
npm install -g github:yagaltd/tdd-guard
```

## Why This Exists

Weak tests are worse than no tests because they create false confidence. This is especially common in agent-written code, but the same problems happen in human-written projects too:

- tests that are skipped to make a suite pass
- tests with no assertions
- tests that mock the exact internal module they claim to validate
- tests that import private files instead of using public APIs
- tests that assert how code is implemented instead of what behavior it provides

`tdd-guard` makes those failure modes mechanical. It does not replace your test runner. It runs beside Jest, Vitest, Pytest, Cargo test, or any other test suite and asks a narrower question: are these tests worth trusting?

## Development

```bash
npm ci
npm run lint
npm test
npm run build
node dist/cli.js --help
```

Package smoke check:

```bash
npm pack --dry-run
```

## License

MIT
