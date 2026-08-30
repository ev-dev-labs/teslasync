import { useMemo } from 'react';

import { useDataSaverPolicy } from '@/hooks/useLowBandwidthMode';
import { resolveChartPointBudget } from './chartSampling';

/**
 * Hook form of {@link resolveChartPointBudget} (PWA-07).
 *
 * Charts call this instead of hard-coding a cap so a single low-bandwidth
 * toggle changes every series at once:
 *
 * ```tsx
 * const budget = useChartPointBudget(400);
 * const { rows, disclosure } = downsampleChartRows(series, budget);
 * ```
 *
 * Keep passing the honest full dataset to totals, CSV export, and the
 * accessibility summary — sampling is a rendering optimisation only, and the
 * returned `disclosure` from `downsampleChartRows` is what tells the user the
 * chart is a sampled view.
 */
export function useChartPointBudget(requested: number): number {
  const { chartPointBudget } = useDataSaverPolicy();
  return useMemo(
    () => resolveChartPointBudget(requested, chartPointBudget),
    [requested, chartPointBudget],
  );
}
