// Internal service — should NOT be imported by tests
export function processPayment(amount: number): boolean {
  return amount > 0;
}
