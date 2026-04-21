import { calculatePrice, formatCurrency } from "../src/index";
import { processPayment } from "../src/services/payment";  // BAD: internal import

// Good test — has assertions
test("calculatePrice applies discount", () => {
  expect(calculatePrice(100, 20)).toBe(80);
});

// BAD: skipped test
test.skip("formatCurrency formats correctly", () => {
  expect(formatCurrency(42)).toBe("$42.00");
});

// BAD: assertionless test
test("shopping cart adds items", () => {
  const cart = new ShoppingCart();
  cart.add("item-1");
  // No assertion!
});

// BAD: mocking internal module
jest.mock("../src/services/payment");  // Should only mock boundaries

// BAD: implementation coupling
test("processPayment called once", () => {
  const mockFn = jest.fn();
  mockFn(100);
  expect(mockFn).toHaveBeenCalledTimes(1);  // Coupling to call count
});
