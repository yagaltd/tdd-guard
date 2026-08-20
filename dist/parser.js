/**
 * AST parsing utilities for JavaScript/TypeScript test files
 */
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import { isIdentifier, isMemberExpression, isStringLiteral, isTemplateLiteral, } from "@babel/types";
import { Parser as AcornParser } from "acorn";
import { tsPlugin } from "acorn-typescript";
const traverse = ("default" in traverseModule.default
    ? traverseModule.default.default
    : traverseModule.default);
const TS_AST_PARSER = AcornParser.extend(tsPlugin());
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
/**
 * Generic AST walker. Only descends into objects that look like AST nodes
 * (have a `type` string), which keeps it robust against acorn-typescript's
 * TypeScript-specific nodes and never walks loc/start/end metadata.
 */
function walkAcorn(node, visit) {
    if (node == null || typeof node !== "object")
        return;
    if (Array.isArray(node)) {
        for (const child of node)
            walkAcorn(child, visit);
        return;
    }
    const n = node;
    if (typeof n.type === "string") {
        visit(n);
        for (const key of Object.keys(n)) {
            if (key === "loc" || key === "start" || key === "end")
                continue;
            walkAcorn(n[key], visit);
        }
    }
}
/**
 * Find `test('name', fn)` / `it(...)` / `describe(...)` calls (and their
 * .skip/.todo/x- variants) via the real AST instead of a brace-depth heuristic.
 */
function extractTestBlocks(code) {
    let ast;
    try {
        ast = TS_AST_PARSER.parse(code, {
            sourceType: "module",
            ecmaVersion: "latest",
            locations: true,
        });
    }
    catch {
        return [];
    }
    const blocks = [];
    // Named functions (declarations + function/arrow variable assignments) so a
    // test can delegate its assertions to local helpers (e.g. GOLDEN_CASES.forEach(assertGoldenParity)).
    const helperFns = collectNamedFunctions(ast);
    const asserting = new Map();
    const helperAsserts = (name, stack) => {
        if (asserting.has(name))
            return asserting.get(name);
        const fns = helperFns.get(name);
        if (!fns || fns.length === 0) {
            asserting.set(name, false);
            return false;
        }
        if (stack.has(name))
            return false; // helper cycle with no assertion yet resolved
        stack.add(name);
        let result = false;
        for (const fn of fns) {
            if (functionHasAssertions(fn.body, helperAsserts, stack)) {
                result = true;
                break;
            }
        }
        stack.delete(name);
        asserting.set(name, result);
        return result;
    };
    walkAcorn(ast, (node) => {
        if (node.type !== "CallExpression")
            return;
        const call = node;
        const info = classifyTestCall(call);
        if (!info)
            return;
        const fn = findTestFn(call.arguments);
        const hasAssertions = info.type === "describe"
            ? true // describe is a grouping construct, not an assertion-bearing test
            : fn != null && functionHasAssertions(fn.body, helperAsserts, new Set());
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
function classifyTestCall(call) {
    const callee = call.callee;
    if (callee.type === "Identifier") {
        const name = callee.name;
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
    if (callee.type === "MemberExpression") {
        const member = callee;
        if (member.computed)
            return null;
        if (member.object.type !== "Identifier" || member.property.type !== "Identifier") {
            return null;
        }
        const objName = member.object.name;
        const propName = member.property.name;
        let type = null;
        if (objName === "test" || objName === "specify")
            type = "test";
        else if (objName === "it")
            type = "it";
        else if (objName === "describe")
            type = "describe";
        else
            return null;
        const skipped = propName === "skip" || propName === "todo";
        return {
            name: extractTestName(call),
            skipped: skipped || optionsIndicateSkip(call),
            type,
        };
    }
    return null;
}
function extractTestName(call) {
    for (const arg of call.arguments) {
        if (arg.type === "Literal" && typeof arg.value === "string") {
            return arg.value;
        }
        if (arg.type === "TemplateLiteral") {
            const tl = arg;
            if (tl.expressions.length === 0 && tl.quasis.length > 0) {
                return tl.quasis[0].value.cooked ?? tl.quasis[0].value.raw;
            }
        }
    }
    return null;
}
function findTestFn(args) {
    for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
            return arg;
        }
    }
    return null;
}
function optionsIndicateSkip(call) {
    for (const arg of call.arguments) {
        if (arg.type !== "ObjectExpression")
            continue;
        const props = arg.properties;
        for (const prop of props) {
            if (prop.type !== "Property")
                continue;
            const p = prop;
            if (p.computed)
                continue;
            const key = p.key;
            const keyName = key.type === "Identifier"
                ? key.name
                : key.type === "Literal"
                    ? String(key.value)
                    : null;
            if (keyName !== "skip" && keyName !== "todo")
                continue;
            if (p.value.type === "Literal" && p.value.value === true) {
                return true;
            }
        }
    }
    return false;
}
function functionHasAssertions(body, helperAsserts, stack) {
    let found = false;
    walkAcorn(body, (node) => {
        if (found)
            return;
        if (node.type === "CallExpression") {
            const call = node;
            if (calleeIsAssertion(call.callee)) {
                found = true;
                return;
            }
            // A direct call to, or passing-as-callback of, a local assert helper.
            for (const candidate of [call.callee, ...call.arguments]) {
                if (candidate.type === "Identifier" &&
                    helperAsserts(candidate.name, stack)) {
                    found = true;
                    return;
                }
            }
        }
    });
    return found;
}
function collectNamedFunctions(ast) {
    const map = new Map();
    const add = (name, node) => {
        const existing = map.get(name);
        if (existing)
            existing.push(node);
        else
            map.set(name, [node]);
    };
    walkAcorn(ast, (node) => {
        if (node.type === "FunctionDeclaration") {
            const id = node.id;
            if (id && id.type === "Identifier")
                add(id.name, node);
        }
        else if (node.type === "VariableDeclarator") {
            const decl = node;
            if (decl.id.type === "Identifier" &&
                decl.init &&
                (decl.init.type === "ArrowFunctionExpression" ||
                    decl.init.type === "FunctionExpression")) {
                add(decl.id.name, decl.init);
            }
        }
    });
    return map;
}
function calleeIsAssertion(callee) {
    if (callee.type === "Identifier") {
        const name = callee.name;
        return name === "expect" || name === "assert";
    }
    if (callee.type === "MemberExpression") {
        const member = callee;
        if (member.computed)
            return false;
        const prop = member.property;
        if (prop.type === "Identifier" && ASSERT_METHODS.has(prop.name)) {
            return true;
        }
    }
    return false;
}
/**
 * Parse a JS/TS file into structured test information
 */
export function parseTestFile(filePath) {
    const code = readFileSync(filePath, "utf-8");
    const imports = [];
    const mockCalls = [];
    let ast;
    try {
        ast = parse(code, {
            sourceType: "module",
            plugins: ["typescript", "jsx", "decorators-legacy", "importMeta"],
        });
    }
    catch {
        ast = null;
    }
    if (ast) {
        traverse(ast, {
            // Track imports
            ImportDeclaration(path) {
                const source = path.node.source.value;
                const specifiers = path.node.specifiers.map((s) => {
                    if (s.type === "ImportDefaultSpecifier")
                        return s.local.name;
                    if (s.type === "ImportNamespaceSpecifier")
                        return s.local.name;
                    if (s.type === "ImportSpecifier") {
                        const imported = s.imported;
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
                if (isMemberExpression(callee) &&
                    isIdentifier(callee.object) &&
                    isIdentifier(callee.property) &&
                    callee.property.name === "mock") {
                    const obj = callee.object.name;
                    const arg = path.node.arguments[0];
                    if ((obj === "jest" || obj === "vi") && arg) {
                        const target = extractStringArg(arg);
                        if (target) {
                            mockCalls.push({
                                target,
                                line: path.node.loc?.start.line ?? 0,
                                type: `${obj}.mock`,
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
export function parseRustTestFile(filePath) {
    const code = readFileSync(filePath, "utf-8");
    const testBlocks = [];
    const imports = [];
    const mockCalls = [];
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
            if (last)
                last.hasAssertions = true;
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
            if (last)
                last.hasAssertions = true;
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
export function parsePythonTestFile(filePath) {
    const code = readFileSync(filePath, "utf-8");
    const testBlocks = [];
    const imports = [];
    const mockCalls = [];
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
            if (last)
                last.hasAssertions = true;
        }
    }
    return { file: filePath, testBlocks, imports, mockCalls };
}
/**
 * Parse any test file based on extension
 */
export function parseFile(filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (ext === "rs")
        return parseRustTestFile(filePath);
    if (ext === "py")
        return parsePythonTestFile(filePath);
    // ts, tsx, js, jsx
    return parseTestFile(filePath);
}
function extractStringArg(arg) {
    if (isStringLiteral(arg))
        return arg.value;
    if (isTemplateLiteral(arg) && arg.quasis.length === 1)
        return arg.quasis[0].value.raw;
    return null;
}
