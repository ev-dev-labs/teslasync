import { createContext, useContext, type ReactNode } from 'react';
import { useHiddenSeries, type HiddenSeriesState } from '@/hooks/useHiddenSeries';

/**
 * Context bridge for URL-persisted hidden-series state inside a
 * `<ChartContainer chartKey="…">`, avoiding prop drilling to legends.
 *
 * `null` means the chart did not opt into legend toggling.
 */
export const ChartHiddenSeriesContext = createContext<HiddenSeriesState | null>(null);

/** Reads hidden-series state from the nearest chart container, or `null`. */
export function useChartHiddenSeries(): HiddenSeriesState | null {
  return useContext(ChartHiddenSeriesContext);
}

/**
 * Internal wrapper used by `<ChartContainer>`. Calls
 * {@link useHiddenSeries} only when `chartKey` is truthy so charts that
 * have not adopted toggling don't incur a `react-router-dom`
 * `useSearchParams()` dependency (which throws when no `<Router>` is in
 * scope — the default in many isolated unit tests).
 *
 * The `children` render-prop receives the resolved state (or `null`) so
 * the caller can both provide it via context AND pass it into the
 * existing `<ChartContainer>` function-children render-props.
 */
export function ChartHiddenSeriesProvider({
  chartKey,
  children,
}: {
  chartKey?: string;
  children: (state: HiddenSeriesState | null) => ReactNode;
}) {
  if (!chartKey) {
    return <>{children(null)}</>;
  }
  return (
    <ChartHiddenSeriesProviderInner chartKey={chartKey}>
      {children}
    </ChartHiddenSeriesProviderInner>
  );
}

function ChartHiddenSeriesProviderInner({
  chartKey,
  children,
}: {
  chartKey: string;
  children: (state: HiddenSeriesState) => ReactNode;
}) {
  const state = useHiddenSeries(chartKey);
  return (
    <ChartHiddenSeriesContext.Provider value={state}>
      {children(state)}
    </ChartHiddenSeriesContext.Provider>
  );
}
