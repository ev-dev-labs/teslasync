import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * Phase 40 / Prompt 26 — shared chart-sync context.
 *
 * Recharts already has a powerful built-in mechanism for synchronizing tooltip
 * cursors and brush selections across charts: every chart that shares the same
 * `syncId` prop will mirror the active hover index and (when one of them owns
 * a `<Brush>`) the visible window.
 *
 * Rather than reimplement that logic with our own `hoveredAt` state and
 * `<ReferenceLine>` cursors, this provider just exposes a stable `syncId` to
 * every descendant chart via {@link useSyncedCursor}. Pages opt-in by wrapping
 * their stacked-time-series sections in `<ChartTimeRangeProvider>` once, and
 * each chart spreads `{...syncProps}` onto its `<LineChart>` / `<AreaChart>`.
 *
 * Important: index-based sync (the recharts default) requires every
 * participating chart to render from the **same data array** (or at least the
 * same length AND row order). For Drive Detail this is true — every chart
 * receives the `chartData` produced by `useDriveDetailData`. For datasets that
 * vary in length, pass `syncMethod="value"` and ensure the X-axis dataKey
 * carries a stable, non-formatted value (e.g., a raw timestamp) for matching.
 */
export interface ChartSyncContextValue {
  /** Stable identifier passed to recharts' `syncId` prop. */
  syncId: string
  /**
   * Recharts sync method. `'index'` (default) matches by row index — fast and
   * correct when all participating charts share the same dataset. `'value'`
   * matches by X-axis value — required when datasets differ in length.
   */
  syncMethod: 'index' | 'value'
}

const Ctx = createContext<ChartSyncContextValue | null>(null)

export interface ChartTimeRangeProviderProps {
  /** Stable, page-scoped identifier (e.g., `'drive-detail'`). Becomes the
   *  recharts `syncId` for every descendant chart. Required so multiple pages
   *  on screen at once never accidentally cross-sync. */
  syncId: string
  /** Defaults to `'index'` (fastest path; safe when all charts share dataset). */
  syncMethod?: 'index' | 'value'
  children: ReactNode
}

export function ChartTimeRangeProvider({
  syncId,
  syncMethod = 'index',
  children,
}: ChartTimeRangeProviderProps) {
  const value = useMemo<ChartSyncContextValue>(
    () => ({ syncId, syncMethod }),
    [syncId, syncMethod],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Read the current chart-sync context. Returns `null` outside a provider so
 * standalone charts (e.g., the dashboard widgets) keep working unchanged.
 */
export function useChartSync(): ChartSyncContextValue | null {
  return useContext(Ctx)
}

/**
 * Convenience hook: returns props ready to spread onto a recharts chart
 * component. Outside a provider, returns an empty object so chart components
 * can opt-in unconditionally without crashing on standalone use.
 *
 * @example
 *   const syncProps = useSyncedCursor()
 *   return (
 *     <LineChart data={data} {...syncProps}>
 *       ...
 *     </LineChart>
 *   )
 */
export function useSyncedCursor(): {
  syncId?: string
  syncMethod?: 'index' | 'value'
} {
  const ctx = useChartSync()
  if (!ctx) return {}
  return { syncId: ctx.syncId, syncMethod: ctx.syncMethod }
}
