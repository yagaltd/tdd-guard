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

// FP class 2 (pi-workflows plan 013 T4 R4): template-literal interpolation
// in test bodies, around expect calls.
test("template interpolation with real assertion", () => {
  const who = "world";
  expect(`hello ${who}!`).toBe("hello world!");
  expect(`sum=${1 + 2}`).toMatch(/sum=3/);
});

// FP class 3: deeply nested object AND array literals containing expect calls.
test("deeply nested literals with real assertion", () => {
  const tree = {
    root: {
      children: [
        { id: 1, tags: ["a", { deep: true }] },
        { id: 2, meta: { rows: [[1, 2], [3, 4]] } },
      ],
    },
  };
  expect(tree.root.children[0].tags[1].deep).toBe(true);
  expect(tree.root.children[1].meta.rows).toEqual([[1, 2], [3, 4]]);
});

// FP class 4: non-ASCII (unicode) identifier names with expect calls.
test("unicode identifiers with real assertion", () => {
  const 値 = 42;
  const 測試 = () => 値 * 2;
  const κλειδί = "κλειδί";
  expect(測試()).toBe(84);
  expect(κλειδί.length).toBe(7);
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
