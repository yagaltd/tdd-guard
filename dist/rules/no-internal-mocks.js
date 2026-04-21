import { globSync } from "glob";
import { parseFile } from "../parser.js";
export function ruleNoInternalMocks(_srcFiles, testFiles, config) {
    const violations = [];
    const boundaryModules = config.boundary_modules;
    const internalPaths = config.internal_paths;
    for (const file of testFiles) {
        const parsed = parseFile(file);
        for (const mock of parsed.mockCalls) {
            const target = mock.target;
            // Check if target is a boundary module (allowed to mock)
            const isBoundary = boundaryModules.some((b) => target === b ||
                target.includes(`/${b}`) ||
                target.includes(b) ||
                globSync(b, { cwd: target }).length > 0);
            if (isBoundary)
                continue;
            // Check if target is an internal module (forbidden to mock)
            const isInternal = target.startsWith(".") ||
                target.startsWith("/") ||
                internalPaths.some((ip) => {
                    try {
                        return globSync(ip).some((f) => target.includes(f));
                    }
                    catch {
                        return false;
                    }
                });
            if (isInternal) {
                violations.push({
                    file,
                    line: mock.line,
                    message: `${mock.type}('${target}') — mocking internal module. Only mock system boundaries (configured in .tdd-guard.json: boundary_modules).`,
                    severity: "error",
                });
            }
        }
    }
    return violations;
}
