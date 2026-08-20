// Fixture exercising the no-assertionless-tests parser edge cases.
import { test } from "node:test";
import assert from "node:assert/strict";

test("destructuring with real assertion", () => {
  const { a, b } = compute();
  const obj = { x: 1, y: 2 };
  assert.equal(a + b + obj.x + obj.y, 4);
});

test("object literal with real assertion", () => {
  assert.deepEqual(
    renderNode({ tag: "h1", children: [{ text: "Hi" }] }),
    "<h1>Hi</h1>",
  );
});

test("brace inside string and comment with real assertion", () => {
  const s = "this string has a } brace";
  // this comment has a } brace too
  const t = `template ${"} literal"}`;
  assert.ok(s.length > 0 && t.length > 0);
});

test("genuinely assertionless", () => {
  const cart = [];
  cart.push("item-1");
  // no assertion here
});

test.skip("skipped test with no assertion", () => {
  const { only } = something();
  void only;
});
