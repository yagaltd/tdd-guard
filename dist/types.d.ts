/**
 * tdd-guard core types
 */
export interface Violation {
    file: string;
    line: number;
    message: string;
    severity: "error" | "warn";
}
export interface RuleResult {
    rule: string;
    status: "pass" | "fail" | "warn";
    violations: Violation[];
}
export interface LintResult {
    command: "lint";
    exit_code: number;
    checks: RuleResult[];
}
export interface DecisionCoverage {
    decision: string;
    covered_by: string | null;
    status: "covered" | "uncovered";
}
export interface BoundaryCoverage {
    path: string;
    tested_files: string[];
    status: "covered" | "uncovered";
}
export interface TestSelectorCoverage {
    scenario: string;
    selector: string;
    found: boolean;
}
export interface VerifyResult {
    command: "verify";
    spec: string;
    decisions_coverage: DecisionCoverage[];
    boundaries_coverage: BoundaryCoverage[];
    test_selectors: TestSelectorCoverage[];
    exit_code: number;
}
export interface MutateResult {
    command: "mutate";
    language: string;
    tool: string;
    mutation_score: number;
    threshold: number;
    killed: number;
    survived: number;
    timeout: number;
    total: number;
    exit_code: number;
    details?: string;
}
export interface TddGuardConfig {
    boundary_modules: string[];
    public_api_exports: string[];
    internal_paths: string[];
    lint: {
        rules: Record<string, "error" | "warn" | "off">;
    };
    mutation?: {
        threshold: number;
        strategy: "quick" | "full";
        ignore: string[];
    };
}
export declare const DEFAULT_CONFIG: TddGuardConfig;
export interface LintOptions {
    src: string;
    tests: string;
    config: string;
    format: "json" | "text";
}
export interface MutateOptions {
    src: string;
    tests: string;
    threshold: number;
    since: string;
    config: string;
    format: "json" | "text";
}
export interface VerifyOptions {
    spec: string;
    tests: string;
    config: string;
    format: "json" | "text";
}
