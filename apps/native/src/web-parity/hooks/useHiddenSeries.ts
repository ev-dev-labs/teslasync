// Native parity port of web/src/hooks/useHiddenSeries.ts.
//
// The web hook tracks which chart series (`dataKey`s) of a named chart are
// hidden and persists that set into the URL query string via the sibling
// `useUrlArray` hook (web/src/hooks/useUrlState.ts -> react-router-dom
// `useSearchParams`), so a pasted deep-link reproduces the toggled-off series.
// React Native has NO address bar / query string, so the URL persistence and
// cross-link shareability are STRUCTURALLY UNAVAILABLE. Following the
// established native precedent (web-parity/features/telemetry/pages/
// SignalLogViewerPage.tsx L287-297 and web-parity/features/analytics/pages/
// PeriodComparePage.tsx L321-352), the `./useUrlState` `useUrlArray` dependency
// is replaced by an inlined `useState`-backed shim: the [value, setter] tuple,
// the functional-updater contract, and the public HiddenSeriesState API
// (hidden / toggle / isHidden / reset) are preserved exactly; only the backing
// store moves from the URL to in-process component state (it lives for the
// screen's lifetime). The `hidden_{chartKey}` param name is still computed and
// threaded through as the shim `key`, but it is inert on native.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's useCallback / useMemo / useState.

import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * In-memory hidden-series state for a chart.
 *
 * Tracks which `dataKey`s of a named chart are currently hidden. On the web
 * this state is persisted to the URL so deep-links carry the toggle; on React
 * Native there is no address bar, so the state lives in component memory for
 * the lifetime of the screen. Pair with the native `<ChartContainer
 * chartKey="...">` and `<ChartLegend />` for tap-to-hide UX.
 *
 * Differs from a localStorage-backed legend store: this state is per-mount and
 * resets when the screen unmounts. The web URL-shareability / cross-tab /
 * private-mode-resilience notes do not apply on native — there is no URL to
 * share or reload.
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
  /** Clear every hidden flag (resets the in-memory hidden set for this chart). */
  reset: () => void;
}

const HIDDEN_PARAM_PREFIX = 'hidden_';

/* ── useUrlArray shim (web ./useUrlState useUrlArray) ── */
// Native has no address bar, so the hidden-series list lives in component state
// instead of the URL query string. The [value, setter] tuple and
// functional-updater contract the hook below consumes are preserved exactly;
// the `key` (the `hidden_{chartKey}` param name) is accepted but inert.
function useUrlArray(
  _key: string,
  defaultValue: readonly string[] = [],
): [string[], Dispatch<SetStateAction<string[]>>] {
  return useState<string[]>(() => [...defaultValue]);
}

/**
 * In-memory hidden-series tracker. On the web the hook stored an
 * alphabetically sorted, comma-joined list under `?hidden_{chartKey}=…` so the
 * view was bookmarkable; on native the same sorted list is kept in component
 * state (no URL), preserving the toggle behavior without the shareability.
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
      setArr(prev => {
        const next = new Set(prev);
        if (next.has(seriesKey)) next.delete(seriesKey);
        else next.add(seriesKey);
        // Sorted output keeps the stored list canonical (preserved from the
        // web hook, where it kept URLs canonical): toggling A then B yields
        // the same list as toggling B then A, so comparing two states is as
        // simple as a string equality check.
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
