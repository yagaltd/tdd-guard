/**
 * Rule: public-interface-only
 * Detects tests that import from internal paths
 */
import { relative, resolve, basename } from "node:path";
import { globSync } from "glob";
import { Violation, TddGuardConfig } from "../types.js";
import { parseFile } from "../parser.js";

export function rulePublicInterfaceOnly(
  _srcFiles: string[],
  testFiles: string[],
  config: TddGuardConfig,
): Violation[] {
  const violations: Violation[] = [];
  const publicExports = config.public_api_exports;
  const internalPaths = config.internal_paths;

  // If neither configured, skip
  if (publicExports.length === 0 && internalPaths.length === 0) return violations;

  for (const file of testFiles) {
    const parsed = parseFile(file);

    for (const imp of parsed.imports) {
      const source = imp.source;

      // Only check relative imports (internal code)
      if (!source.startsWith(".") && !source.startsWith("/")) continue;

      // Check if import IS from a public export (allowed)
      const isPublic = publicExports.some((pe) => {
        const clean = pe.replace("/*", "").replace("/**", "").replace("src/", "");
        // Match against the import path
        return source.includes(clean) || source.endsWith(clean);
      });

      if (isPublic) continue;

      // Check if import matches an internal path pattern (forbidden)
      const isInternal = internalPaths.some((ip) => {
        // Convert glob pattern to path matcher
        const clean = ip
          .replace("/**", "")
          .replace("**/", "")
          .replace("/*", "");
        return source.includes(clean);
      });

      if (isInternal) {
        violations.push({
          file,
          line: imp.line,
          message: `Test imports internal path: '${source}' — tests should only import from public API (configured in .tdd-guard.json: public_api_exports).`,
          severity: "error",
        });
      }
    }
  }

  return violations;
}
