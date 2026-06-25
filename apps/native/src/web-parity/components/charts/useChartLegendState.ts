import {useCallback, useEffect, useState} from 'react';

const STORAGE_PREFIX = 'teslasync.chart.';
const STORAGE_SUFFIX = '.hidden';

const nativeLegendStorage = new Map<string, readonly string[]>();

function storageKey(chartId: string): string {
  return `${STORAGE_PREFIX}${chartId}${STORAGE_SUFFIX}`;
}

function readHidden(chartId: string): Set<string> {
  const raw = nativeLegendStorage.get(storageKey(chartId)) ?? [];
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

function writeHidden(chartId: string, hidden: Set<string>): void {
  const key = storageKey(chartId);
  const values = Array.from(hidden).filter(
    (x): x is string => typeof x === 'string',
  );

  if (values.length === 0) {
    nativeLegendStorage.delete(key);
    return;
  }

  nativeLegendStorage.set(key, values);
}

export interface ChartLegendState {
  /** Set of dataKeys the user has hidden via the legend. */
  hidden: Set<string>;
  /** Returns true if the given dataKey is currently hidden. */
  isHidden: (dataKey: string) => boolean;
  /** Toggle visibility of a dataKey. */
  toggle: (dataKey: string) => void;
  /** Set visibility explicitly. */
  setHidden: (dataKey: string, hidden: boolean) => void;
  /** Reset all to visible. */
  reset: () => void;
}

/**
 * Native-safe legend visibility for a chart. React Native does not provide the
 * browser localStorage used by the web hook, so hidden series persist for the
 * current app process in a chart-keyed in-memory store.
 */
export function useChartLegendState(chartId: string): ChartLegendState {
  const [hidden, setHiddenState] = useState<Set<string>>(() =>
    readHidden(chartId),
  );

  useEffect(() => {
    setHiddenState(readHidden(chartId));
  }, [chartId]);

  const isHidden = useCallback(
    (dataKey: string) => hidden.has(dataKey),
    [hidden],
  );

  const persist = useCallback(
    (next: Set<string>) => {
      setHiddenState(next);
      writeHidden(chartId, next);
    },
    [chartId],
  );

  const toggle = useCallback(
    (dataKey: string) => {
      const next = new Set(hidden);
      if (next.has(dataKey)) {
        next.delete(dataKey);
      } else {
        next.add(dataKey);
      }
      persist(next);
    },
    [hidden, persist],
  );

  const setHidden = useCallback(
    (dataKey: string, h: boolean) => {
      const next = new Set(hidden);
      if (h) {
        next.add(dataKey);
      } else {
        next.delete(dataKey);
      }
      persist(next);
    },
    [hidden, persist],
  );

  const reset = useCallback(() => {
    persist(new Set());
  }, [persist]);

  return {hidden, isHidden, toggle, setHidden, reset};
}
