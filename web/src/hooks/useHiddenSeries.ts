import { useCallback, useMemo } from 'react';
import { useUrlArray } from './useUrlState';

/**
 * URL-persisted hidden-series state for a chart.
 *
 * Tracks which `dataKey`s of a named chart are currently hidden, persisting
 * to URL state so deep-links carry the toggle. Pair with `<ChartContainer
 * chartKey="...">` and `<ChartLegend />` for click-to-hide UX.
 *
 * Differs from {@link import('@/components/charts').useChartLegendState
 * useChartLegendState} (localStorage-backed): URL state is shareable,
 * cross-tab via the URL, and survives page reloads even in private-mode
 * browsers where localStorage is restricted.
 *
 * Usage at page level:
 * ```tsx
 * const hidden = useHiddenSeries('battery-degradation-trend');
 * return (
 *   <ChartContainer chartKey="battery-degradation-trend">
 *     <LineChart>
 *       <ChartLegend state={hidden} />
 *       <Line dataKey="health"    hide={hidden.isHidden('health')} />
 *       <Line dataKey="projected" hide={hidden.isHidden('projected')} />
 *     </LineChart>
 *   </ChartContainer>
 * );
 * ```
 */
export interface HiddenSeriesState {
  /** Set of dataKeys currently hidden for this chart. */
  hidden: Set<string>;
  /** Toggle visibility of a series by dataKey. */
  toggle: (seriesKey: string) => void;
  /** Returns true when the given dataKey is currently hidden. */
  isHidden: (seriesKey: string) => boolean;
  /** Clear every hidden flag (drops `?hidden_{chartKey}` from the URL). */
  reset: () => void;
}

const HIDDEN_PARAM_PREFIX = 'hidden_';

/**
 * URL-state-backed hidden-series tracker. The hook stores an alphabetically
 * sorted, comma-joined list under `?hidden_{chartKey}=…` so
 *
 *   /battery/degradation?hidden_battery-degradation-trend=health,projected
 *
 * is a bookmarkable view with two series toggled off.
 *
 * Empty `chartKey` is allowed but yields a no-op param; this lets call
 * sites that may not always carry a chart-id keep the hook call site
 * stable (Rules of Hooks). When the key is empty the hook still works
 * but writes go to a placeholder param — callers should not invoke
 * `toggle()` in that case.
 */
export function useHiddenSeries(chartKey: string): HiddenSeriesState {
  const paramName = `${HIDDEN_PARAM_PREFIX}${chartKey}`;
  const [arr, setArr] = useUrlArray(paramName);

  const hidden = useMemo(() => new Set(arr), [arr]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );

  const toggle = useCallback(
    (seriesKey: string) => {
      setArr((prev) => {
        const next = new Set(prev);
        if (next.has(seriesKey)) next.delete(seriesKey);
        else next.add(seriesKey);
        // Sorted output keeps URLs canonical: toggling A then B yields the
        // same URL as toggling B then A, so comparing two pasted links is
        // as simple as a string equality check.
        return Array.from(next).sort();
      });
    },
    [setArr],
  );

  const reset = useCallback(() => {
    setArr([]);
  }, [setArr]);

  return { hidden, toggle, isHidden, reset };
}
