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
export declare function parseTestFile(filePath: string): ParsedTestFile;
/**
 * Parse Rust test files
 */
export declare function parseRustTestFile(filePath: string): ParsedTestFile;
/**
 * Parse Python test files
 */
export declare function parsePythonTestFile(filePath: string): ParsedTestFile;
/**
 * Parse any test file based on extension
 */
export declare function parseFile(filePath: string): ParsedTestFile;
