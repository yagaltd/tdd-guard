/**
 * Rule: test-per-export
 * Checks that each public export has ≥1 test referencing it
 */
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { Violation, TddGuardConfig } from "../types.js";
import { parseFile } from "../parser.js";

export function ruleTestPerExport(
  srcFiles: string[],
  testFiles: string[],
  config: TddGuardConfig,
): Violation[] {
  const violations: Violation[] = [];
  const publicExports = config.public_api_exports;

  // If no public_api_exports configured, skip
  if (publicExports.length === 0) return violations;

  // Collect public exports from source files
  const exports = collectExports(srcFiles, publicExports);

  // Build a set of all test names and test file contents for searching
  const testContent = testFiles.map((f) => ({
    file: f,
    content: readFileSync(f, "utf-8"),
  }));
  const allTestText = testContent.map((t) => t.content).join("\n");

  // Check each export has at least one test referencing it
  for (const exp of exports) {
    const name = exp.name;
    // Simple heuristic: test references the export name
    const isReferenced =
      allTestText.includes(name) ||
      allTestText.includes(toSnakeCase(name)) ||
      allTestText.includes(toKebabCase(name));

    if (!isReferenced) {
      violations.push({
        file: exp.file,
        line: exp.line,
        message: `No test found referencing export '${name}' — add a test that exercises this public API.`,
        severity: "warn",
      });
    }
  }

  return violations;
}

interface ExportInfo {
  name: string;
  file: string;
  line: number;
}

function collectExports(
  srcFiles: string[],
  publicExports: string[],
): ExportInfo[] {
  const exports: ExportInfo[] = [];

  for (const file of srcFiles) {
    // Check if file matches a public export pattern
    const isPublic = publicExports.some((pe) => {
      const clean = pe.replace("/*", "").replace("/**", "");
      return file.includes(clean);
    });

    if (!isPublic) continue;

    const code = readFileSync(file, "utf-8");
    const lines = code.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // export function foo / export const foo / export class Foo
      const fnMatch = line.match(
        /export\s+(?:async\s+)?function\s+(\w+)/,
      );
      const constMatch = line.match(/export\s+const\s+(\w+)/);
      const classMatch = line.match(/export\s+class\s+(\w+)/);
      const typeMatch = line.match(
        /export\s+(?:type|interface)\s+(\w+)/,
      );

      const name =
        fnMatch?.[1] ||
        constMatch?.[1] ||
        classMatch?.[1] ||
        typeMatch?.[1];

      if (name) {
        exports.push({ name, file, line: lineNum });
      }
    }

    // Rust: pub fn foo / pub struct Foo / pub enum Foo
    if (file.endsWith(".rs")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(
          /pub\s+(?:async\s+)?fn\s+(\w+)|pub\s+struct\s+(\w+)|pub\s+enum\s+(\w+)/,
        );
        const name = match?.[1] || match?.[2] || match?.[3];
        if (name) {
          exports.push({ name, file, line: i + 1 });
        }
      }
    }

    // Python: def foo (in __init__.py or marked public)
    if (file.endsWith(".py") && file.includes("__init__")) {
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/def\s+(\w+)/);
        if (match && !match[1].startsWith("_")) {
          exports.push({ name: match[1], file, line: i + 1 });
        }
      }
    }
  }

  return exports;
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function toKebabCase(s: string): string {
  return s.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
}
