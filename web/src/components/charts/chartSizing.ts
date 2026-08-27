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

function explicitHeight(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Resolve the shared responsive chart-height scale while preserving explicit overrides. */
export function resolveChartHeights(
  size: ChartSize = 'standard',
  height?: number,
  mobileHeight?: number,
): ResolvedChartHeights {
  const preset = chartSizeHeights[size];
  const desktop = explicitHeight(height, preset.desktop);
  const mobile = explicitHeight(
    mobileHeight,
    height == null ? preset.mobile : Math.min(desktop, preset.mobile),
  );

  return { mobile, desktop };
}

/**
 * Stable viewport values for a Recharts responsive container.
 *
 * A responsive chart must measure an ancestor with a finite height; using
 * `height="100%"` against an auto-height parent creates the classic
 * ResizeObserver feedback loop (every chart render makes the parent taller,
 * which makes the next measurement taller). The shared chart frame consumes
 * this result and fixes all three CSS height constraints to the same value.
 */
export function chartViewportStyle(heights: ResolvedChartHeights): Record<
  '--chart-height-mobile' | '--chart-height-desktop',
  string
> {
  return {
    '--chart-height-mobile': `${heights.mobile}px`,
    '--chart-height-desktop': `${heights.desktop}px`,
  };
}
