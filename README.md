# tdd-guard

Test quality enforcement for codebases where you care whether tests are actually trustworthy.

`tdd-guard` is a standalone CLI. It scans your source and test files, then fails on common weak-test patterns: skipped tests, assertionless tests, internal mocks, tests that import private implementation paths, and implementation-coupled assertions.

It can be used in two ways:

- **Standalone** in any JavaScript/TypeScript, Rust, or Python project.
- **As part of pi-workflows**, where it becomes one of the mechanical contract-gate checks.

You do not need to know or use agent-spec to use the main `lint` command.

## Install

From npm:

```bash
npm install --save-dev tdd-guard
npx tdd-guard lint
```

From this repository while developing locally:

```bash
npm ci
npm run build
node dist/cli.js lint
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

`pi-workflows` uses `tdd-guard` during its ContractGate.

The gate runs:

```bash
tdd-guard lint --config .tdd-guard.json
tdd-guard verify --spec <task-contract> --config .tdd-guard.json
```

Resolution order inside `pi-workflows`:

1. `node_modules/.bin/tdd-guard`
2. sibling checkout at `../tdd-guard/dist/cli.js`
3. global `tdd-guard` on `PATH`

By default, `pi-workflows` fails the gate if `tdd-guard` is missing. For temporary local development only, this can be softened:

```bash
PI_WORKFLOWS_ALLOW_MISSING_TDD_GUARD=true
```

Use that only when you intentionally want to skip the test-quality rail.

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
