export const chartSizeHeights = {
  compact: { mobile: 200, desktop: 240 },
  standard: { mobile: 260, desktop: 300 },
  detail: { mobile: 300, desktop: 360 },
  hero: { mobile: 340, desktop: 420 },
} as const;

export type ChartSize = keyof typeof chartSizeHeights;

export interface ResolvedChartHeights {
  mobile: number;
  desktop: number;
}

function positiveHeight(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** Resolve the shared responsive chart-height scale while preserving explicit overrides. */
export function resolveChartHeights(
  size: ChartSize = 'standard',
  height?: number,
  mobileHeight?: number,
): ResolvedChartHeights {
  const preset = chartSizeHeights[size];
  const desktop = positiveHeight(height, preset.desktop);
  const mobile = positiveHeight(
    mobileHeight,
    height == null ? preset.mobile : Math.min(desktop, preset.mobile),
  );

  return { mobile, desktop };
}
