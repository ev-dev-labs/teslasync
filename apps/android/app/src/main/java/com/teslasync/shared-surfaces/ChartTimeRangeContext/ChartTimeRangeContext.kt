// The native Jetpack Compose + Material 3 ChartTimeRangeContext shared surface — a parity port of
// web/src/components/charts/ChartTimeRangeContext.tsx (and its dependency cursorSync.ts). The web source is a
// chart cursor-sync COORDINATION layer: a React context carrying `{ syncId, syncMethod }`, a provider that
// drops its persistent cursor on unmount, and three reader hooks over a tiny external store that remembers
// the last hovered x-axis value per `syncId` so every synced chart can draw a persistent vertical reference
// line. This file is the composable binding; every pure decision lives in ChartTimeRangeContextModel.kt.
//
// Element-for-element mapping of the web API:
//   • `createContext<ChartSyncContextValue | null>(null)` → [LocalChartSync], a CompositionLocal defaulting
//     to `null` so a standalone chart outside any provider keeps working unchanged.
//   • `<ChartTimeRangeProvider>` (`useMemo` of `{ syncId, syncMethod }` + `useEffect` cleanup
//     `clearCursorSync`) → [ChartTimeRangeProvider]: a `remember`ed [ChartSync] (stable reference across
//     recompositions) provided to the tree, with a `DisposableEffect` that clears the surface's persisted
//     cursor on dispose so navigating away never leaks a stale cursor into the next screen.
//   • `useChartSync()` → [useChartSync]; `useSyncedCursor()` → [useSyncedCursor]; `useSyncedReferenceLineX()`
//     → [useSyncedReferenceLineX]; `useCursorSyncPosition()` → [useCursorSyncPosition].
//
// The provider renders NO chrome of its own — exactly like the web component, which only wraps its children
// in a context provider. There is therefore no visible loading / empty / error / stale / offline state to
// paint (the surface fetches nothing); its real states are the binding ones documented on the model. The
// one PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartTimeRangeContext) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located reader hooks.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charttimerangecontext

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The chart-sync context exposed to descendant charts — the native port of the web
 * `createContext<ChartSyncContextValue | null>(null)`. Defaults to `null` so a standalone chart rendered
 * outside any [ChartTimeRangeProvider] keeps working unchanged (web `useChartSync` "returns null outside a
 * provider"). Read it through [useChartSync].
 */
val LocalChartSync: ProvidableCompositionLocal<ChartSync?> = staticCompositionLocalOf { null }

/**
 * Scopes a `syncId` (and [syncMethod]) to [content] so every descendant chart cursor-syncs through the same
 * [LocalChartSync] — the native port of the web `<ChartTimeRangeProvider>`. The [ChartSync] value is
 * `remember`ed by ([syncId], [syncMethod]) so consumers keep a stable reference across recompositions (web
 * `useMemo`), and the surface's persisted cursor entry is dropped on dispose (web `useEffect` cleanup
 * `clearCursorSync`) so navigating between pages never leaks a stale cursor into the next page that reuses
 * the same id. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition. The provider
 * renders no chrome of its own — exactly like the web component, which only wraps its children in a context
 * provider; it must therefore be given a [syncId] unique per on-screen group so two providers never
 * cross-sync.
 *
 * @param syncId stable, page-scoped identifier; becomes every descendant chart's sync key (web `syncId`).
 * @param syncMethod row-index vs x-value matching; defaults to [ChartSyncMethod.Index] (web default `index`).
 * @param store the cursor-sync store this scope clears on dispose; defaults to [ProcessCursorSyncStore]. A
 *   test passes a throwaway instance so the process-wide store is never polluted.
 * @param logger the sanctioned redacting logger the diagnostic routes through; defaults to the app's
 *   [LocalDataContainer]. A test passes a capturing logger.
 * @param content the charts scoped to this sync group.
 */
@Composable
fun ChartTimeRangeProvider(
    syncId: String,
    syncMethod: ChartSyncMethod = ChartSyncMethod.Index,
    store: CursorSyncStore = ProcessCursorSyncStore,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    val value =
        remember(syncId, syncMethod) {
            ChartSync(syncId = syncId, syncMethod = syncMethod)
        }

    LaunchedEffect(Unit) { recordChartTimeRangeContextOpened(logger) }

    DisposableEffect(syncId, store) {
        onDispose { store.clear(syncId) }
    }

    CompositionLocalProvider(LocalChartSync provides value, content = content)
}

/**
 * Reads the current chart-sync context — the native port of the web `useChartSync()`. Returns `null` outside
 * a [ChartTimeRangeProvider] so standalone charts opt in unconditionally without crashing.
 */
@Composable
fun useChartSync(): ChartSync? = LocalChartSync.current

/**
 * Returns the props a chart spreads to participate in cursor sync — the native port of the web
 * `useSyncedCursor()`. Outside a provider returns [SyncedCursorProps.EMPTY] (web `return {}`); inside, the
 * returned [SyncedCursorProps.onMouseMove] persists the hovered x-axis label into [store] for the active
 * syncId (web `setCursorSyncPosition`). The handler is `remember`ed by ([syncId], [store]) so it stays a
 * stable reference until the active sync group changes (web `useCallback`).
 */
@Composable
fun useSyncedCursor(store: CursorSyncStore = ProcessCursorSyncStore): SyncedCursorProps {
    val sync = useChartSync()
    val syncId = sync?.syncId
    val onMouseMove =
        remember(syncId, store) {
            { event: ChartCursorEvent? -> CursorSyncProjection.applyMove(store, syncId, event) }
        }
    return CursorSyncProjection.syncedCursorProps(sync, onMouseMove)
}

/**
 * Subscribes the caller to the persistent cursor value for the active sync group — the native port of the
 * web `useSyncedReferenceLineX()`. Returns `null` outside a [ChartTimeRangeProvider] or before any chart in
 * the group has been hovered; charts render a non-null value as a persistent vertical reference line.
 */
@Composable
fun useSyncedReferenceLineX(store: CursorSyncStore = ProcessCursorSyncStore): CursorSyncValue? =
    useCursorSyncPosition(useChartSync()?.syncId, store)

/**
 * Subscribes the calling composable to the persistent cursor value for [syncId] in [store] — the native port
 * of the web `useCursorSyncPosition(syncId)` built on `useSyncExternalStore`. Returns `null` when [syncId] is
 * `null` or nothing has been hovered yet, and recomposes when the stored value changes; the subscription is
 * released on dispose.
 */
@Composable
fun useCursorSyncPosition(
    syncId: String?,
    store: CursorSyncStore = ProcessCursorSyncStore,
): CursorSyncValue? {
    var value by remember(syncId, store) { mutableStateOf(store.get(syncId)) }
    DisposableEffect(syncId, store) {
        value = store.get(syncId)
        val unsubscribe = store.subscribe { value = store.get(syncId) }
        onDispose(unsubscribe)
    }
    return value
}
