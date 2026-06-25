// Native parity port of web/src/components/charts/ChartHiddenSeriesContext.tsx.
// React Native has no browser URL/search-param state, so chart-keyed hidden
// series are retained in-memory for the app process while preserving the
// HiddenSeriesState API and context bridge.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface HiddenSeriesState {
  hidden: Set<string>;
  toggle: (seriesKey: string) => void;
  isHidden: (seriesKey: string) => boolean;
  reset: () => void;
}

const HIDDEN_SERIES_PREFIX = 'teslasync-hidden-series:';
const hiddenSeriesPrefs = new Map<string, readonly string[]>();

function readHiddenSeriesPref(chartKey: string): readonly string[] {
  return hiddenSeriesPrefs.get(HIDDEN_SERIES_PREFIX + chartKey) ?? [];
}

function writeHiddenSeriesPref(
  chartKey: string,
  hidden: readonly string[],
): void {
  const storageKey = HIDDEN_SERIES_PREFIX + chartKey;
  if (hidden.length === 0) {
    hiddenSeriesPrefs.delete(storageKey);
  } else {
    hiddenSeriesPrefs.set(storageKey, hidden);
  }
}

function useNativeHiddenSeries(chartKey: string): HiddenSeriesState {
  const [hiddenValues, setHiddenValues] = useState<readonly string[]>(() =>
    readHiddenSeriesPref(chartKey),
  );

  useEffect(() => {
    setHiddenValues(readHiddenSeriesPref(chartKey));
  }, [chartKey]);

  const hidden = useMemo(() => new Set(hiddenValues), [hiddenValues]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );

  const toggle = useCallback(
    (seriesKey: string) => {
      setHiddenValues(prev => {
        const next = new Set(prev);
        if (next.has(seriesKey)) {
          next.delete(seriesKey);
        } else {
          next.add(seriesKey);
        }

        const sorted = Array.from(next).sort();
        writeHiddenSeriesPref(chartKey, sorted);
        return sorted;
      });
    },
    [chartKey],
  );

  const reset = useCallback(() => {
    writeHiddenSeriesPref(chartKey, []);
    setHiddenValues([]);
  }, [chartKey]);

  return useMemo(
    () => ({hidden, toggle, isHidden, reset}),
    [hidden, isHidden, reset, toggle],
  );
}

/**
 * Context bridge for chart-keyed hidden-series state inside a native
 * `<ChartContainer chartKey="...">`, avoiding prop drilling to legends.
 *
 * `null` means the chart did not opt into legend toggling.
 */
export const ChartHiddenSeriesContext =
  createContext<HiddenSeriesState | null>(null);

/** Reads hidden-series state from the nearest chart container, or `null`. */
export function useChartHiddenSeries(): HiddenSeriesState | null {
  return useContext(ChartHiddenSeriesContext);
}

/**
 * Internal wrapper used by `<ChartContainer>`. Calls the native hidden-series
 * hook only when `chartKey` is truthy so charts that have not adopted toggling
 * do not allocate chart-keyed state.
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
  const state = useNativeHiddenSeries(chartKey);
  return (
    <ChartHiddenSeriesContext.Provider value={state}>
      {children(state)}
    </ChartHiddenSeriesContext.Provider>
  );
}
