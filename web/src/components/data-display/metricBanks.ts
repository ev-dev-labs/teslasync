/** Distribute metric tiles into balanced rows without leaving a short orphan row. */
export function metricBanks<T>(items: readonly T[], maxPerRow: number): T[][] {
  const rowCount = Math.ceil(items.length / maxPerRow);
  if (rowCount === 0) return [];

  const baseSize = Math.floor(items.length / rowCount);
  const largerRowCount = items.length % rowCount;
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const rowSize = baseSize + (rowIndex < largerRowCount ? 1 : 0);
    const start = rowIndex * baseSize + Math.min(rowIndex, largerRowCount);
    return items.slice(start, start + rowSize);
  });
}
