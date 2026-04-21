/**
 * Config file loading with defaults
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG } from "./types.js";
export function loadConfig(configPath) {
    const paths = configPath
        ? [configPath]
        : [".tdd-guard.json", "tdd-guard.json"];
    for (const p of paths) {
        const full = resolve(p);
        if (existsSync(full)) {
            const raw = JSON.parse(readFileSync(full, "utf-8"));
            return mergeConfig(DEFAULT_CONFIG, raw);
        }
    }
    return DEFAULT_CONFIG;
}
function mergeConfig(base, override) {
    return {
        ...base,
        ...override,
        lint: {
            rules: {
                ...base.lint.rules,
                ...(override.lint?.rules ?? {}),
            },
        },
        mutation: {
            ...base.mutation,
            ...override.mutation,
        },
    };
}
