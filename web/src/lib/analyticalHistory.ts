/**
 * Reject collection-shape failures before they replace valid query-cache data.
 * Row qualification belongs to the analytical model, not this boundary.
 */
export function validateAnalyticalHistory<T>(value: T[], source: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${source} history response: expected an array`);
  }
  return value;
}
