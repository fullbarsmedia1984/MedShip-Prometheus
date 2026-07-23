/** Canonical Nursing Kit order classifier used across all Zeus views. */
export function isKitOrderNumber(soNumber: string): boolean {
  return /-KIT$/i.test(soNumber.trim())
}
