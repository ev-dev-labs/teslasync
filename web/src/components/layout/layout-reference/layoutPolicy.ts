export type CardSize = 'full' | 'half' | 'third' | 'quarter';
export type ContainerBand = 'phone' | 'tablet' | 'desktop' | 'wide';

export function containerBand(width: number): ContainerBand {
  if (!Number.isFinite(width) || width < 640) return 'phone';
  if (width < 1024) return 'tablet';
  return width < 1600 ? 'desktop' : 'wide';
}

export function containerPolicy(width: number) {
  const band = containerBand(width);
  return {
    band,
    columns: band === 'phone' ? 1 : band === 'tablet' ? 6 : 12,
    gutter: band === 'phone' ? 3 : band === 'tablet' ? 4 : band === 'desktop' ? 5 : 6,
    chartHeight: band === 'phone' ? 200 : band === 'tablet' ? 240 : 280,
  } as const;
}

/** Source order is never sorted. Spare columns are distributed within a row,
 * not filled with fabricated cards or CSS dense reordering. */
export function packCardRows(sizes: readonly CardSize[], width: number): number[] {
  const { columns } = containerPolicy(width);
  const spans = sizes.map(size => {
    if (columns === 1) return 1;
    if (columns === 6) return size === 'full' || size === 'half' ? 6 : 3;
    return { full: 12, half: 6, third: 4, quarter: 3 }[size];
  });
  let row: number[] = [];
  let used = 0;
  const fill = () => {
    if (!row.length) return;
    let spare = columns - used;
    let cursor = 0;
    while (spare > 0) {
      spans[row[cursor % row.length]] += 1;
      cursor += 1;
      spare -= 1;
    }
    row = [];
    used = 0;
  };
  spans.forEach((span, index) => {
    if (used + span > columns) fill();
    row.push(index);
    used += span;
    if (used === columns) fill();
  });
  fill();
  return spans;
}

/** Select axis positions only; never change the underlying source series. */
export function thinTickIndices(pointCount: number, plotWidth: number): number[] {
  if (pointCount <= 0) return [];
  const budget = Math.max(1, Math.floor(Math.max(0, plotWidth) / 64));
  const count = Math.min(pointCount, budget);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) =>
    Math.round(index * (pointCount - 1) / (count - 1)));
}

export function progressValue(current: number, required: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(required) || required <= 0) return null;
  return Math.min(1, Math.max(0, current / required));
}
