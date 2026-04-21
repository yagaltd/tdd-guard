// Public API
export function calculatePrice(base: number, discount: number): number {
  return base - discount;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export class ShoppingCart {
  add(item: string): void { /* ... */ }
  total(): number { return 0; }
}
