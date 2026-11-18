import { describe, expect, test } from "vitest";

// Fixture replicating pi-workflows' requireLiveState pattern (plan
// 20261117-074 task 2): the conditional wrapper must unwrap so the extracted
// block carries the inner call's name and body.
const live = true;

describe("wrapper idiom replica", () => {
  test.skipIf(!live)("wrapped test with real assertions", () => {
    expect(1 + 1).toBe(2);
  });

  test.skipIf(!live)("wrapped test with empty body", () => {
    // nothing — the negative pin: no-assertionless must still flag this
  });
});
