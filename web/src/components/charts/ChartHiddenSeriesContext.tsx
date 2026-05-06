import { createContext, useContext, type ReactNode } from 'react';
import { useHiddenSeries, type HiddenSeriesState } from '@/hooks/useHiddenSeries';

/**
 * Phase-46 / Prompt 67 — context bridge so `<ChartLegend />` and any
 * descendant component inside a `<ChartContainer chartKey="…">` can pull
 * the URL-persisted hidden-series state without prop-drilling.
 *
 * Default value is `null` so consumers (e.g. `<ChartLegend />` without an
 * explicit `state` prop) can branch on "no chartKey wired" and fall back
 * to a no-op render.
 */
export const ChartHiddenSeriesContext = createContext<HiddenSeriesState | null>(null);

/**
 * Hook variant of {@link ChartHiddenSeriesContext} for components that
 * sit inside a `<ChartContainer chartKey="…">`. Returns `null` when the
 * surrounding container did not opt into legend toggling.
 */
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
