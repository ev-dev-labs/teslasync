import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import {
  clearCursorSync,
  setCursorSyncPosition,
  useCursorSyncPosition,
  type CursorSyncValue,
} from './cursorSync'

/**
 * Phase 40 / Prompt 26 — shared chart-sync context.
 * Phase 40 / Prompt 62 — extended with persistent cursor sync.
 *
 * Recharts already has a powerful built-in mechanism for synchronizing tooltip
 * cursors and brush selections across charts: every chart that shares the same
 * `syncId` prop will mirror the active hover index and (when one of them owns
 * a `<Brush>`) the visible window.
 *
 * Rather than reimplement that logic with our own `hoveredAt` state and
 * `<ReferenceLine>` cursors, this provider exposes a stable `syncId` to every
 * descendant chart via {@link useSyncedCursor}. Pages opt-in by wrapping their
 * stacked-time-series sections in `<ChartTimeRangeProvider>` once, and each
 * chart spreads `{...syncProps}` onto its `<LineChart>` / `<AreaChart>`.
 *
 * Phase-62 layers a *persistent* vertical reference line on top: the last
 * hovered x value survives mouseleave so users can compare the same moment
 * across every synced chart even after their cursor moves away. Charts opt in
 * by also calling {@link useSyncedReferenceLineX} and rendering a
 * `<ReferenceLine x={syncedX} />` whenever the value is non-null.
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
  // Phase-40 / Prompt 62: drop persistent reference-line state for this
  // syncId on unmount so navigating between pages doesn't leak a stale cursor
  // into the next page that happens to reuse the same syncId.
  useEffect(() => {
    return () => {
      clearCursorSync(syncId)
    }
  }, [syncId])
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
 * Phase-40 / Prompt 62 added the `onMouseMove` handler which feeds the active
 * x-axis label into the persistent cursor-sync store. Pair with
 * {@link useSyncedReferenceLineX} on the same chart to draw a vertical
 * `<ReferenceLine>` that survives mouseleave.
 *
 * @example
 *   const syncProps = useSyncedCursor()
 *   const syncedX = useSyncedReferenceLineX()
 *   return (
 *     <LineChart
 *       data={data}
 *       syncId={syncProps.syncId}
 *       syncMethod={syncProps.syncMethod}
 *       onMouseMove={syncProps.onMouseMove}
 *     >
 *       {syncedX != null && <ReferenceLine x={syncedX} stroke="..." />}
 *     </LineChart>
 *   )
 */
export interface SyncedCursorProps {
  syncId?: string
  syncMethod?: 'index' | 'value'
  /**
   * Recharts onMouseMove handler. Wired by the provider so the active hover
   * x-axis label is persisted into the cursor-sync store. Spreading this onto
   * `<LineChart>` / `<AreaChart>` / `<ComposedChart>` is enough to keep all
   * synced charts in lockstep.
   */
  onMouseMove?: (state: RechartsMouseState | null) => void
}

interface RechartsMouseState {
  activeLabel?: string | number
}

export function useSyncedCursor(): SyncedCursorProps {
  const ctx = useChartSync()
  const syncId = ctx?.syncId
  const onMouseMove = useCallback(
    (state: RechartsMouseState | null) => {
      if (!syncId) return
      const next = state?.activeLabel ?? null
      setCursorSyncPosition(syncId, next as CursorSyncValue)
    },
    [syncId],
  )
  if (!ctx) return {}
  return {
    syncId: ctx.syncId,
    syncMethod: ctx.syncMethod,
    onMouseMove,
  }
}

/**
 * Phase-40 / Prompt 62 — companion to {@link useSyncedCursor}. Returns the
 * persistent x value that every synced chart should render as a vertical
 * `<ReferenceLine>`. Returns `null` outside a `<ChartTimeRangeProvider>` or
 * before any chart in the group has been hovered.
 *
 * Kept as a separate hook (rather than folded into `useSyncedCursor`) so
 * call sites can spread `{...syncProps}` onto recharts charts without
 * accidentally forwarding `syncedX` (an unknown prop) to the underlying SVG.
 */
export function useSyncedReferenceLineX(): CursorSyncValue {
  const ctx = useChartSync()
  return useCursorSyncPosition(ctx?.syncId)
}
