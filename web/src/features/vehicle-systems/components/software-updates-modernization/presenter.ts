/** Presentation state only. Query keys, operands and wire rows stay with the page. */
export function softwareSourceState(data: unknown, loading: boolean, failed: boolean) {
  const available = Array.isArray(data);
  return {
    available,
    initialLoading: loading && !available,
    fatalError: failed && !available,
    retained: failed && available,
    empty: available && data.length === 0,
  };
}

/** Unknown source counts are not observed zeros; successful empty arrays are. */
export function observedCount(available: boolean, count: number): number | null {
  return available ? count : null;
}
