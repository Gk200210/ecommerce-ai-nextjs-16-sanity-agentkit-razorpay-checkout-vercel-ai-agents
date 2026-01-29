import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
/**
 * Format a price amount with currency symbol
 * @param amount - The price amount (can be null/undefined)
 * @param currency - Currency symbol (default: "£")
 * @returns Formatted price string (e.g., "£599.99")
 */
export function formatPrice(
  amount: number | null | undefined,
  currency = "₹"
): string {
  return `${currency}${(amount ?? 0).toFixed(2)}`;
}