/**
 * tdd-guard core types
 */
export const DEFAULT_CONFIG = {
    boundary_modules: [],
    public_api_exports: [],
    internal_paths: [],
    lint: {
        rules: {
            "no-internal-mocks": "error",
            "no-skipped-tests": "error",
            "no-assertionless-tests": "error",
            "public-interface-only": "error",
            "test-per-export": "warn",
            "no-implementation-coupling": "warn",
        },
    },
    mutation: {
        threshold: 60,
        strategy: "quick",
        ignore: ["**/*.test.ts", "**/*.spec.ts", "**/index.ts"],
    },
};
