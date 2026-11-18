/**
 * AST parsing utilities for JavaScript/TypeScript test files
 */
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import {
  isIdentifier,
  isMemberExpression,
  isStringLiteral,
  isTemplateLiteral,
  type ArgumentPlaceholder,
  type CallExpression,
  type Expression,
  type ImportDeclaration,
  type ImportSpecifier,
  type SpreadElement,
  type StringLiteral,
  type TemplateLiteral,
} from "@babel/types";
import { Parser as AcornParser } from "acorn";
import { tsPlugin } from "acorn-typescript";

const traverse = (
  "default" in traverseModule.default
    ? traverseModule.default.default
    : traverseModule.default
) as unknown as (
  ast: ReturnType<typeof parse>,
  visitors: {
    ImportDeclaration?: (path: { node: ImportDeclaration }) => void;
    CallExpression?: (path: { node: CallExpression }) => void;
  },
) => void;

// ─── acorn-based test-block extraction ──────────────────────────────────────

type AcornPlugin = (BaseParser: typeof AcornParser) => typeof AcornParser;
const TS_AST_PARSER = AcornParser.extend(tsPlugin() as unknown as AcornPlugin);

/**
 * Curried wrapper methods: `<test>.<method>(...)` RETURNS the function that
 * actually receives (name, fn) — the real test call is the outer one
 * (`test.skipIf(cond)("name", fn)`). The wrapper invocation itself carries
 * no name or body and must never yield a test block.
 */
const CURRIED_WRAPPER_METHODS = new Set(["skipIf", "runIf", "each", "fails"]);

/**
 * node:assert (strict + legacy), node:test context, and tap assertion methods.
 * A call of the form `<identifier>.<method>(...)` with one of these method names
 * counts as an assertion (e.g. assert.ok, assert.deepStrictEqual, t.match).
 */
const ASSERT_METHODS = new Set([
  "ok",
  "equal",
  "notEqual",
  "deepEqual",
  "notDeepEqual",
  "strictEqual",
  "notStrictEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
  "match",
  "doesNotMatch",
  "throws",
  "doesNotThrow",
  "rejects",
  "doesNotReject",
  "ifError",
  "fail",
  "snapshot",
  "assert",
]);

interface AcornNode {
  type: string;
  start?: number;
  end?: number;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: unknown;
}

interface AcornCallExpression extends AcornNode {
  callee: AcornNode;
  arguments: AcornNode[];
}

interface AcornIdentifier extends AcornNode {
  name: string;
}

interface AcornMemberExpression extends AcornNode {
  object: AcornNode;
  property: AcornNode;
  computed: boolean;
}

interface AcornLiteral extends AcornNode {
  value: unknown;
}

interface AcornTemplateLiteral extends AcornNode {
  expressions: unknown[];
  quasis: { value: { cooked: string | null; raw: string } }[];
}

interface AcornObjectExpression extends AcornNode {
  properties: AcornNode[];
}

interface AcornProperty extends AcornNode {
  computed: boolean;
  key: AcornNode;
  value: AcornNode;
}

interface AcornFunctionDeclaration extends AcornNode {
  id: AcornNode | null;
}

interface AcornVariableDeclarator extends AcornNode {
  id: AcornNode;
  init: AcornNode | null;
}

/**
 * Generic AST walker. Only descends into objects that look like AST nodes
 * (have a `type` string), which keeps it robust against acorn-typescript's
 * TypeScript-specific nodes and never walks loc/start/end metadata.
 */
function walkAcorn(node: unknown, visit: (node: AcornNode) => void): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAcorn(child, visit);
    return;
  }
  const n = node as AcornNode;
  if (typeof n.type === "string") {
    visit(n);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      walkAcorn(n[key], visit);
    }
  }
}

/**
 * Find `test('name', fn)` / `it(...)` / `describe(...)` calls (and their
 * .skip/.todo/x- variants) via the real AST instead of a brace-depth heuristic.
 */
function extractTestBlocks(code: string): TestBlock[] {
  let ast: AcornNode;
  try {
    ast = TS_AST_PARSER.parse(code, {
      sourceType: "module",
      ecmaVersion: "latest",
      locations: true,
    }) as unknown as AcornNode;
  } catch {
    // acorn (with its scope checks) rejects some real-world test files that
    // run fine under vitest/bun — e.g. a top-level `const fs = require("fs")`
    // redeclaring an `import * as fs` binding. Fall back to the lenient
    // @babel/parser (no scope analysis) so rules stay sighted on the file
    // instead of silently extracting zero blocks.
    try {
      ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx", "decorators-legacy", "importMeta"],
        // Keep going after recoverable scope errors (e.g. duplicate top-level
        // declarations) and surface them as ast.errors instead of throwing —
        // an unparseable-by-acorn file must still yield its test blocks.
        errorRecovery: true,
      }) as unknown as AcornNode;
    } catch {
      return [];
    }
  }
  return extractTestBlocksFromAst(ast);
}

function extractTestBlocksFromAst(ast: AcornNode): TestBlock[] {
  const blocks: TestBlock[] = [];

  // Named functions (declarations + function/arrow variable assignments) so a
  // test can delegate its assertions to local helpers (e.g. GOLDEN_CASES.forEach(assertGoldenParity)).
  const helperFns = collectNamedFunctions(ast);
  const asserting = new Map<string, boolean>();

  const helperAsserts = (name: string, stack: Set<string>): boolean => {
    if (asserting.has(name)) return asserting.get(name) as boolean;
    const fns = helperFns.get(name);
    if (!fns || fns.length === 0) {
      asserting.set(name, false);
      return false;
    }
    if (stack.has(name)) return false; // helper cycle with no assertion yet resolved
    stack.add(name);
    let result = false;
    for (const fn of fns) {
      if (functionHasAssertions(fn.body as AcornNode, helperAsserts, stack)) {
        result = true;
        break;
      }
    }
    stack.delete(name);
    asserting.set(name, result);
    return result;
  };

  walkAcorn(ast, (node) => {
    if (node.type !== "CallExpression") return;

    const call = node as unknown as AcornCallExpression;
    const info = classifyTestCall(call);
    if (!info) return;

    const fn = findTestFn(call.arguments);
    const hasAssertions =
      info.type === "describe"
        ? true // describe is a grouping construct, not an assertion-bearing test
        : fn != null && functionHasAssertions(fn.body as AcornNode, helperAsserts, new Set());

    blocks.push({
      name: info.name ?? `anonymous-${node.loc?.start.line ?? 0}`,
      line: node.loc?.start.line ?? 0,
      skipped: info.skipped,
      hasAssertions,
      type: info.type,
    });
  });

  return blocks;
}

function classifyTestCall(
  call: AcornCallExpression,
): { name: string | null; skipped: boolean; type: "test" | "it" | "describe" } | null {
  const callee = call.callee;

  if (callee.type === "Identifier") {
    const name = (callee as AcornIdentifier).name;
    if (name === "test" || name === "specify") {
      return { name: extractTestName(call), skipped: false, type: "test" };
    }
    if (name === "it") {
      return { name: extractTestName(call), skipped: false, type: "it" };
    }
    if (name === "describe") {
      return { name: extractTestName(call), skipped: false, type: "describe" };
    }
    if (name === "xtest") {
      return { name: extractTestName(call), skipped: true, type: "test" };
    }
    if (name === "xit") {
      return { name: extractTestName(call), skipped: true, type: "it" };
    }
    if (name === "xdescribe") {
      return { name: extractTestName(call), skipped: true, type: "describe" };
    }
    return null;
  }

  if (callee.type === "CallExpression" || callee.type === "TaggedTemplateExpression") {
    const unwrapped = unwrapCurriedTestCallee(callee);
    if (!unwrapped) return null;
    return {
      name: extractTestName(call),
      skipped: unwrapped.skipped || optionsIndicateSkip(call),
      type: unwrapped.type,
    };
  }

  if (callee.type === "MemberExpression") {
    const member = callee as AcornMemberExpression;
    if (member.computed) return null;
    if (member.object.type !== "Identifier" || member.property.type !== "Identifier") {
      return null;
    }

    const objName = (member.object as AcornIdentifier).name;
    const propName = (member.property as AcornIdentifier).name;

    let type: "test" | "it" | "describe" | null = null;
    if (objName === "test" || objName === "specify") type = "test";
    else if (objName === "it") type = "it";
    else if (objName === "describe") type = "describe";
    else return null;

    // The inner wrapper invocation (`test.skipIf(cond)` of the outer
    // `test.skipIf(cond)("name", fn)`) carries no name or body. Without this
    // guard it extracts as an anonymous assertionless phantom block.
    if (CURRIED_WRAPPER_METHODS.has(propName) && findTestFn(call.arguments) === null) {
      return null;
    }

    const skipped = propName === "skip" || propName === "todo";

    return {
      name: extractTestName(call),
      skipped: skipped || optionsIndicateSkip(call),
      type,
    };
  }

  return null;
}

/**
 * @cc [label:parser] wrapper-idiom-unwrap
 * Curried wrapper calls on the test identifier — test.skipIf(c)(...),
 * test.runIf(...), test.each(...)(...), test.fails(...) and multi-step
 * chains (test.skipIf(c).each(t)(...), including each-as-tagged-template) —
 * resolve to the inner test call: the extracted block carries the OUTER
 * call's name and body, and the wrapper invocation itself never yields a
 * block. Only known wrapper methods may appear in the chain, so arbitrary
 * curried calls (foo()(...) ) stay unclassified.
 */
function unwrapCurriedTestCallee(
  callee: AcornNode,
): { type: "test" | "it" | "describe"; skipped: boolean } | null {
  const props: string[] = [];
  let node = callee;
  let descended = true;
  while (descended) {
    descended = false;
    while (node.type === "CallExpression") {
      const call = node as unknown as AcornCallExpression;
      if (call.callee.type !== "MemberExpression") return null;
      const member = call.callee as AcornMemberExpression;
      if (member.computed || member.property.type !== "Identifier") return null;
      props.push((member.property as AcornIdentifier).name);
      node = member.object;
      descended = true;
    }
    // `test.each\`table\`(...)` — each is also invokable as a tagged template.
    if (node.type === "TaggedTemplateExpression") {
      const tag = (node as unknown as { tag: AcornNode }).tag;
      if (tag.type !== "MemberExpression") return null;
      const member = tag as AcornMemberExpression;
      if (member.computed || member.property.type !== "Identifier") return null;
      props.push((member.property as AcornIdentifier).name);
      node = member.object;
      descended = true;
    }
  }
  if (node.type !== "Identifier") return null;
  for (const prop of props) {
    if (!CURRIED_WRAPPER_METHODS.has(prop)) return null;
  }

  const objName = (node as AcornIdentifier).name;
  let type: "test" | "it" | "describe" | null = null;
  let skipped = false;
  if (objName === "test" || objName === "specify") type = "test";
  else if (objName === "it") type = "it";
  else if (objName === "describe") type = "describe";
  else if (objName === "xtest") {
    type = "test";
    skipped = true;
  } else if (objName === "xit") {
    type = "it";
    skipped = true;
  } else if (objName === "xdescribe") {
    type = "describe";
    skipped = true;
  } else {
    return null;
  }

  return { type, skipped: skipped || props.includes("skip") };
}

/**
 * String-literal value in either AST flavor: acorn uses `Literal`,
 * @babel/parser (the fallback path) uses `StringLiteral`.
 */
function stringLiteralValue(node: AcornNode): string | null {
  if (node.type === "Literal" && typeof (node as AcornLiteral).value === "string") {
    return (node as AcornLiteral).value as string;
  }
  if (node.type === "StringLiteral") {
    const value = (node as unknown as { value: unknown }).value;
    if (typeof value === "string") return value;
  }
  return null;
}

function extractTestName(call: AcornCallExpression): string | null {
  for (const arg of call.arguments) {
    const str = stringLiteralValue(arg);
    if (str !== null) return str;
    if (arg.type === "TemplateLiteral") {
      const tl = arg as AcornTemplateLiteral;
      if (tl.expressions.length === 0 && tl.quasis.length > 0) {
        return tl.quasis[0].value.cooked ?? tl.quasis[0].value.raw;
      }
    }
  }
  return null;
}

function findTestFn(args: AcornNode[]): AcornNode | null {
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
      return arg;
    }
  }
  return null;
}

function optionsIndicateSkip(call: AcornCallExpression): boolean {
  for (const arg of call.arguments) {
    if (arg.type !== "ObjectExpression") continue;
    const props = (arg as AcornObjectExpression).properties;
    for (const prop of props) {
      // "Property" in acorn, "ObjectProperty" in @babel/parser.
      if (prop.type !== "Property" && prop.type !== "ObjectProperty") continue;
      const p = prop as AcornProperty;
      if (p.computed) continue;
      const key = p.key;
      const keyName =
        key.type === "Identifier"
          ? (key as AcornIdentifier).name
          : key.type === "Literal" || key.type === "StringLiteral"
            ? String((key as AcornLiteral).value)
            : null;
      if (keyName !== "skip" && keyName !== "todo") continue;
      if (
        (p.value.type === "Literal" || p.value.type === "BooleanLiteral") &&
        (p.value as AcornLiteral).value === true
      ) {
        return true;
      }
    }
  }
  return false;
}

function functionHasAssertions(
  body: AcornNode,
  helperAsserts: (name: string, stack: Set<string>) => boolean,
  stack: Set<string>,
): boolean {
  let found = false;
  walkAcorn(body, (node) => {
    if (found) return;
    if (node.type === "CallExpression") {
      const call = node as unknown as AcornCallExpression;
      if (calleeIsAssertion(call.callee)) {
        found = true;
        return;
      }
      // A direct call to, or passing-as-callback of, a local assert helper.
      for (const candidate of [call.callee, ...call.arguments]) {
        if (
          candidate.type === "Identifier" &&
          helperAsserts((candidate as AcornIdentifier).name, stack)
        ) {
          found = true;
          return;
        }
      }
    }
  });
  return found;
}

function collectNamedFunctions(ast: AcornNode): Map<string, AcornNode[]> {
  const map = new Map<string, AcornNode[]>();
  const add = (name: string, node: AcornNode) => {
    const existing = map.get(name);
    if (existing) existing.push(node);
    else map.set(name, [node]);
  };

  walkAcorn(ast, (node) => {
    if (node.type === "FunctionDeclaration") {
      const id = (node as AcornFunctionDeclaration).id;
      if (id && id.type === "Identifier") add((id as AcornIdentifier).name, node);
    } else if (node.type === "VariableDeclarator") {
      const decl = node as AcornVariableDeclarator;
      if (
        decl.id.type === "Identifier" &&
        decl.init &&
        (decl.init.type === "ArrowFunctionExpression" ||
          decl.init.type === "FunctionExpression")
      ) {
        add((decl.id as AcornIdentifier).name, decl.init);
      }
    }
  });

  return map;
}

function calleeIsAssertion(callee: AcornNode): boolean {
  if (callee.type === "Identifier") {
    const name = (callee as AcornIdentifier).name;
    return name === "expect" || name === "assert";
  }
  if (callee.type === "MemberExpression") {
    const member = callee as AcornMemberExpression;
    if (member.computed) return false;
    const prop = member.property;
    if (prop.type === "Identifier" && ASSERT_METHODS.has((prop as AcornIdentifier).name)) {
      return true;
    }
  }
  return false;
}

export interface ParsedTestFile {
  file: string;
  testBlocks: TestBlock[];
  imports: ImportInfo[];
  mockCalls: MockCall[];
}

export interface TestBlock {
  name: string;
  line: number;
  skipped: boolean;
  hasAssertions: boolean;
  type: "test" | "it" | "describe";
}

export interface ImportInfo {
  source: string;
  line: number;
  specifiers: string[];
}

export interface MockCall {
  target: string;
  line: number;
  type: "jest.mock" | "vi.mock" | "jest.fn" | "vi.fn" | "mock";
}

/**
 * Parse a JS/TS file into structured test information
 */
export function parseTestFile(filePath: string): ParsedTestFile {
  const code = readFileSync(filePath, "utf-8");
  const imports: ImportInfo[] = [];
  const mockCalls: MockCall[] = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "importMeta"],
    });
  } catch {
    ast = null;
  }

  if (ast) {
    traverse(ast, {
    // Track imports
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const specifiers = path.node.specifiers.map((s) => {
        if (s.type === "ImportDefaultSpecifier") return s.local.name;
        if (s.type === "ImportNamespaceSpecifier") return s.local.name;
        if (s.type === "ImportSpecifier") {
          const imported = (s as ImportSpecifier).imported;
          return imported.type === "Identifier" ? imported.name : imported.value;
        }
        return "";
      }).filter(Boolean);

      imports.push({
        source,
        line: path.node.loc?.start.line ?? 0,
        specifiers,
      });
    },

    // Track require() calls
    CallExpression(path) {
      const callee = path.node.callee;

      // require('...')
      if (isIdentifier(callee) && callee.name === "require" && path.node.arguments[0]) {
        const arg = path.node.arguments[0];
        if (isStringLiteral(arg)) {
          imports.push({
            source: arg.value,
            line: path.node.loc?.start.line ?? 0,
            specifiers: [],
          });
        }
      }

      // jest.mock('...') / vi.mock('...')
      if (
        isMemberExpression(callee) &&
        isIdentifier(callee.object) &&
        isIdentifier(callee.property) &&
        callee.property.name === "mock"
      ) {
        const obj = callee.object.name;
        const arg = path.node.arguments[0];
        if ((obj === "jest" || obj === "vi") && arg) {
          const target = extractStringArg(arg);
          if (target) {
            mockCalls.push({
              target,
              line: path.node.loc?.start.line ?? 0,
              type: `${obj}.mock` as "jest.mock" | "vi.mock",
            });
          }
        }
      }
    },
  });
  }

  // Test blocks are extracted via the acorn AST, not a brace-depth heuristic.
  const testBlocks = extractTestBlocks(code);

  return { file: filePath, testBlocks, imports, mockCalls };
}

/**
 * Parse Rust test files
 */
export function parseRustTestFile(filePath: string): ParsedTestFile {
  const code = readFileSync(filePath, "utf-8");
  const testBlocks: TestBlock[] = [];
  const imports: ImportInfo[] = [];
  const mockCalls: MockCall[] = [];

  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // #[test] or #[tokio::test] etc
    if (/^\s*#\[.*test/.test(line)) {
      // Look for function name on next line
      const fnLine = lines[i + 1] || "";
      const fnMatch = fnLine.match(/fn\s+(\w+)/);
      if (fnMatch) {
        testBlocks.push({
          name: fnMatch[1],
          line: lineNum,
          skipped: /#\[ignore\]/.test(line),
          hasAssertions: false, // Will check below
          type: "test",
        });
      }
    }

    // #[should_panic] tests
    if (/^\s*#\[should_panic/.test(line)) {
      // Still counts as having assertions (panic IS the assertion)
      const last = testBlocks[testBlocks.length - 1];
      if (last) last.hasAssertions = true;
    }

    // use statements
    const useMatch = line.match(/^\s*use\s+([^;]+);/);
    if (useMatch) {
      imports.push({
        source: useMatch[1].trim(),
        line: lineNum,
        specifiers: [],
      });
    }

    // Assertions: assert!, assert_eq!, assert_ne!
    if (/assert(_eq|_ne)?!/.test(line)) {
      // Mark the last test as having assertions
      const last = testBlocks[testBlocks.length - 1];
      if (last) last.hasAssertions = true;
    }

    // mockall or mock crates
    if (/mock!|mock\s*\{/.test(line)) {
      const mockTarget = line.match(/mock!\s*(\w+)/)?.[1] || "unknown";
      mockCalls.push({
        target: mockTarget,
        line: lineNum,
        type: "mock",
      });
    }
  }

  return { file: filePath, testBlocks, imports, mockCalls };
}

/**
 * Parse Python test files
 */
export function parsePythonTestFile(filePath: string): ParsedTestFile {
  const code = readFileSync(filePath, "utf-8");
  const testBlocks: TestBlock[] = [];
  const imports: ImportInfo[] = [];
  const mockCalls: MockCall[] = [];

  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // def test_... or async def test_...
    const fnMatch = line.match(/^\s*(?:async\s+)?def\s+(test_\w+)/);
    if (fnMatch) {
      // Check if decorated with @pytest.mark.skip
      const prevLine = i > 0 ? lines[i - 1] : "";
      const skipped = /@pytest\.mark\.skip|@pytest\.mark\.xfail/.test(prevLine);

      testBlocks.push({
        name: fnMatch[1],
        line: lineNum,
        skipped,
        hasAssertions: false,
        type: "test",
      });
    }

    // import statements
    const importMatch = line.match(/^(?:from|import)\s+([^\s]+)/);
    if (importMatch) {
      imports.push({
        source: importMatch[1],
        line: lineNum,
        specifiers: [],
      });
    }

    // mock.patch
    if (/mock\.patch|patch\s*\(/.test(line)) {
      const target = line.match(/["']([^"']+)["']/)?.[1] || "unknown";
      mockCalls.push({
        target,
        line: lineNum,
        type: "mock",
      });
    }

    // Assertions: assert, assertEqual, etc.
    if (/\bassert\b|assertEqual|assertTrue|assertFalse|assertRaises/.test(line)) {
      const last = testBlocks[testBlocks.length - 1];
      if (last) last.hasAssertions = true;
    }
  }

  return { file: filePath, testBlocks, imports, mockCalls };
}

/**
 * Parse any test file based on extension
 */
export function parseFile(filePath: string): ParsedTestFile {
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "rs") return parseRustTestFile(filePath);
  if (ext === "py") return parsePythonTestFile(filePath);
  // ts, tsx, js, jsx
  return parseTestFile(filePath);
}

function extractStringArg(
  arg: Expression | SpreadElement | ArgumentPlaceholder,
): string | null {
  if (isStringLiteral(arg)) return arg.value;
  if (isTemplateLiteral(arg) && arg.quasis.length === 1)
    return arg.quasis[0].value.raw;
  return null;
}
