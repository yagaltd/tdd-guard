import { expect, test } from "vitest";

// Fixture for the other wrapper variants (plan 20261117-074 task 2):
// runIf/each/fails calls with assertions must all extract with name + body.
test.runIf(process.platform !== "win32")("runIf wrapped with real assertion", () => {
  expect(true).toBe(true);
});

test.each([1, 2])("each wrapped with real assertion %d", (n) => {
  expect(n).toBeGreaterThan(0);
});

test.fails("fails variant with real assertion", () => {
  expect(1).toBe(2);
});
