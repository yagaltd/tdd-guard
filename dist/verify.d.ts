import type { VerifyOptions, VerifyResult } from "./types.js";
/**
 * @cc [label:verify] rust-selector-bare-name-suffix-match
 * Rust selectors match the test's short name: cargo listing entries carry
 * module paths (`crate::mod::test`), so matching anchors a bare selector
 * on `::` as a suffix — never a bare prefix or substring.
 */
export declare function verify(options: VerifyOptions): VerifyResult;
/**
 * Resolve a cargo project's test inventory: run `cargo test --quiet -- --list`
 * and parse the listing into the selector set.
 *
 * In a cargo project (Cargo.toml present), verify resolves spec selectors via
 * `cargo test --quiet -- --list` — the runner's own inventory — not JS parsing
 * of Rust sources. A selector absent from the listing reports not-found and
 * fails the run; a cargo failure yields an empty set (all Rust selectors
 * report not-found), keeping the exit loud. JS resolution is unchanged.
 */
export declare function cargoTestSelectors(cargoRoot: string): Set<string>;
/**
 * Parse a libtest `--list` output into test selector names.
 *
 * Terse format (with --quiet): one `name: test` line per test. Default format
 * adds blank lines and libtest summary lines (`2 tests, 0 benchmarks`) —
 * only `name: test` lines become selectors.
 */
export declare function parseCargoTestListing(listing: string): string[];
