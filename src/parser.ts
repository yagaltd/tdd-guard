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
  const testBlocks: TestBlock[] = [];
  const imports: ImportInfo[] = [];
  const mockCalls: MockCall[] = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "importMeta"],
    });
  } catch {
    // Skip files that can't be parsed
    return { file: filePath, testBlocks: [], imports: [], mockCalls: [] };
  }

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

  // Extract test blocks using a simple regex-based approach (more robust across frameworks)
  const lines = code.split("\n");
  let currentTest: TestBlock | null = null;
  let braceDepth = 0;
  let inTest = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect test/it/describe blocks
    const testMatch = line.match(
      /^\s*(x?(?:test|it|describe|specify))(?:\.(?:skip|todo|only))?\s*[\s(]/,
    );
    if (testMatch) {
      const type = testMatch[1].replace(/^x/, "") as "test" | "it" | "describe";
      const isX = testMatch[1].startsWith("x");
      const isSkip = /\.skip\s*\(/.test(line);
      const isTodo = /\.todo\s*\(/.test(line);
      const isOnly = /\.only\s*\(/.test(line);

      // Extract test name
      const nameMatch = line.match(
        /(?:test|it|describe|specify)(?:\.(?:skip|todo|only))?\s*[\s(]\s*["'`]([^"'`]+)["'`]/,
      );
      const name = nameMatch ? nameMatch[1] : `anonymous-${lineNum}`;

      currentTest = {
        name,
        line: lineNum,
        skipped: isX || isSkip || isTodo,
        hasAssertions: false,
        type,
      };
      inTest = true;
      braceDepth = 0;
      continue;
    }

    if (inTest && currentTest) {
      // Track brace depth
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      // Check for assertions
      if (
        /\b(expect|assert|assertThat|should|assert_eq!|self\.assert)\s*[.(!]/.test(line)
      ) {
        currentTest.hasAssertions = true;
      }

      // End of test block
      if (braceDepth <= 0 && line.includes("}")) {
        testBlocks.push(currentTest);
        currentTest = null;
        inTest = false;
      }
    }
  }

  // Handle unclosed test blocks
  if (currentTest) {
    testBlocks.push(currentTest);
  }

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
