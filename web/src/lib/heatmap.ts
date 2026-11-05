import { CHART_SEQUENTIAL, CHART_SEQUENTIAL_DARK } from './colors';

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;
export const HEATMAP_LEVELS = [0, 1, 2, 3, 4] as const;

/** Rank only active values; tied values share their midpoint rank. */
export function createHeatmapScale(values: readonly number[]) {
  const active = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return (value: number | null | undefined): HeatmapLevel | null => {
    if (value == null || !Number.isFinite(value) || value < 0) return null;
    if (value === 0) return 0;
    if (active.length < 2 || active[0] === active[active.length - 1]) return 2;
    const first = active.findIndex(sample => sample >= value);
    if (first < 0) return 4;
    const last = active.lastIndexOf(value);
    const rank = (first + Math.max(first, last)) / 2;
    return Math.min(4, 1 + Math.floor(4 * rank / (active.length - 1))) as HeatmapLevel;
  };
}

export function heatmapColor(level: HeatmapLevel | null): string {
  if (level == null) return 'transparent';
  if (level === 0) return 'var(--surface-2)';
  return `light-dark(${CHART_SEQUENTIAL[level]}, ${CHART_SEQUENTIAL_DARK[level]})`;
}

/** Numbered cells need readable text on both ends of the sequential scale. */
export function heatmapTextColor(level: HeatmapLevel | null): string {
  if (!level) return 'var(--text-secondary)';
  return `light-dark(${level === 1 ? '#101b25' : '#ffffff'}, #101b25)`;
}
