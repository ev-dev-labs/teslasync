// Pure, framework-free model + external store + projection + diagnostics for the ChartTimeRangeContext
// shared surface — the native analogue of every decision the web source makes before Compose is involved
// (web/src/components/charts/ChartTimeRangeContext.tsx and its dependency cursorSync.ts). No Compose, no
// Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate,
// keeping the composable layer (ChartTimeRangeContext.kt) a thin binding.
//
// What the web source actually is (and therefore the COMPLETE behaviour this surface reproduces): a chart
// cursor-sync COORDINATION layer, not a data-fetching view. It exposes a React context carrying
// `{ syncId, syncMethod }` ([ChartSync]), a provider that drops its persistent cursor entry on unmount, and
// three reader hooks over a tiny external store (`cursorSync.ts`) that remembers the last hovered x-axis
// value per `syncId` so every synced chart can draw a persistent vertical reference line. The store value is
// `string | number | null` — modelled here as [CursorSyncValue] (Text | Numeric) with Kotlin `null` for the
// web `null`. The reader hooks live in the composable file; their pure decisions live here in
// [CursorSyncProjection] and [CursorSyncStore].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing. Inventing a network lifecycle would add behaviour the web spec does not have
// (honesty covenant: no scope narrowing, no silent drift). Its real, fully-reproduced states are the ones
// the web source and its tests assert: outside-provider (no context, empty cursor props, null reference
// line), inside-provider (the memoised `{ syncId, syncMethod }`), cursor-unset, cursor-set-by-string,
// cursor-set-by-number, cursor-cleared, and provider-dispose-clears. Each is reduced here and asserted in
// the off-device model test.
//
// Relationship to the components/charts lane: that lane (io.teslasync.android.components.charts) ports the
// same web file as an index-only ChartTimeRangeState + an Int-keyed CursorSyncStore for its Brush widget.
// This shared surface is the faithful port of the web hook API itself, whose persisted value domain is the
// web `string | number | null` (the web test stores the literal label "12:34"), so it carries its own
// value-typed store rather than narrowing to an index. The two lanes live in different packages and never
// cross-import; this divergence is disclosed here, not hidden.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/ChartTimeRangeContext — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path, exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charttimerangecontext

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The persisted cross-chart cursor value — the native port of the web `cursorSync.ts`
 * `CursorSyncValue = string | number | null`. Charts store the x-axis label under the pointer here so every
 * synced chart can render a persistent reference line at the same moment. The web `null` (cleared cursor)
 * is the Kotlin `null` of a `CursorSyncValue?`; a present value is a [Text] (web `string`) or a [Numeric]
 * (web `number`). Both are data classes so the store's "skip when unchanged" guard compares by value,
 * exactly like the web `current === value` check on a primitive.
 */
sealed interface CursorSyncValue {
    /** A string x-axis label, e.g. a formatted clock time `"12:34"` (web `string`). */
    data class Text(
        val value: String,
    ) : CursorSyncValue

    /** A numeric x-axis value, e.g. a raw timestamp used with [ChartSyncMethod.Value] (web `number`). */
    data class Numeric(
        val value: Double,
    ) : CursorSyncValue

    companion object {
        /** Lifts a nullable string label to a [Text], or `null` to clear (web `string | undefined → value ?? null`). */
        fun text(label: String?): CursorSyncValue? = label?.let { Text(it) }

        /** Lifts a nullable numeric label to a [Numeric], or `null` to clear (web `number | undefined → value ?? null`). */
        fun numeric(label: Double?): CursorSyncValue? = label?.let { Numeric(it) }
    }
}

/**
 * The recharts sync strategy — the native port of the web `'index' | 'value'` union on
 * `ChartSyncContextValue.syncMethod`. [Index] (the web default) matches synced charts by row index: fast and
 * correct when every participating chart renders from the same dataset. [Value] matches by x-axis value:
 * required when datasets differ in length, where the x dataKey must carry a stable, non-formatted value.
 */
enum class ChartSyncMethod {
    Index,
    Value,
}

/**
 * The chart-sync context value every descendant chart reads — the native port of the web
 * `ChartSyncContextValue { syncId, syncMethod }`. Exposed to the Compose tree through `LocalChartSync` and
 * returned by `useChartSync()`. A data class so equal `(syncId, syncMethod)` inputs compare equal, mirroring
 * the web provider's `useMemo` that keeps one stable reference across re-renders.
 *
 * @property syncId stable, page-scoped identifier passed to every descendant chart (web recharts `syncId`).
 * @property syncMethod row-index vs x-value matching strategy (web `syncMethod`).
 */
data class ChartSync(
    val syncId: String,
    val syncMethod: ChartSyncMethod,
)

/**
 * The keyed external store for persistent cross-chart cursor sync — the native port of the web `cursorSync.ts`
 * module store. Keyed by `syncId` (page-scoped, so cross-page leakage is impossible by construction); the
 * provider additionally clears its own entry on dispose. [set] is a no-op when the value is unchanged (web
 * `if (current === value) return`) so a synced sibling's per-tick mousemove does not spuriously re-notify,
 * and a `null` value deletes the entry (web `value == null` branch). Listeners model the web
 * `useSyncExternalStore` subscription; the composable bridge (`useCursorSyncPosition`) subscribes a
 * recomposition to them. A class (not an object) so a test uses a throwaway instance and the process-wide
 * [ProcessCursorSyncStore] singleton is never polluted across cases.
 */
class CursorSyncStore {
    private val positions = mutableMapOf<String, CursorSyncValue>()
    private val listeners = mutableSetOf<() -> Unit>()

    /** Sets the active cursor value for [syncId]; `null` clears it. No-op when unchanged (web `cursorSync` parity). */
    fun set(
        syncId: String,
        value: CursorSyncValue?,
    ) {
        val current = positions[syncId]
        if (current == value) return
        if (value == null) positions.remove(syncId) else positions[syncId] = value
        emit()
    }

    /** Current cursor value for [syncId], or `null` when unset / [syncId] is null (web `getCursorSyncPosition`). */
    fun get(syncId: String?): CursorSyncValue? = if (syncId == null) null else positions[syncId]

    /** Drops the entry for [syncId] — called by the provider on dispose (web `clearCursorSync`). */
    fun clear(syncId: String) {
        if (positions.remove(syncId) != null) emit()
    }

    /** Subscribes [listener] to changes; returns an unsubscribe handle (web `subscribe`). */
    fun subscribe(listener: () -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    /** Test helper — fully resets the store (web `_resetCursorSyncStore`). */
    fun reset() {
        positions.clear()
        listeners.clear()
    }

    private fun emit() {
        listeners.toList().forEach { it() }
    }
}

/**
 * The process-wide cursor-sync store every chart shares by default — the native analogue of the web
 * module-level singleton in `cursorSync.ts`. Production composables default to it; a test constructs a
 * throwaway [CursorSyncStore] so the singleton is never polluted across cases.
 */
val ProcessCursorSyncStore: CursorSyncStore = CursorSyncStore()

/**
 * The pointer state a synced chart hands to [SyncedCursorProps.onMouseMove] — the native port of the web
 * recharts `{ activeLabel?: string | number }`. [activeLabel] is the x-axis label under the pointer, already
 * lifted to a [CursorSyncValue], or `null` when the pointer is off the plot (web `state?.activeLabel ?? null`),
 * which clears the synced cursor.
 */
data class ChartCursorEvent(
    val activeLabel: CursorSyncValue?,
)

/**
 * The props a chart spreads to opt into cursor sync — the native port of the web `SyncedCursorProps`
 * `{ syncId?, syncMethod?, onMouseMove? }`. [EMPTY] is the outside-provider value (web returns `{}`), so a
 * chart can opt in unconditionally and stay inert when no provider is above it.
 *
 * @property syncId the active sync key, or `null` outside a provider.
 * @property syncMethod the active matching strategy, or `null` outside a provider.
 * @property onMouseMove the handler that persists the hovered x-axis label into the store, or `null` outside
 *   a provider (so spreading it onto a standalone chart is a no-op).
 */
data class SyncedCursorProps(
    val syncId: String? = null,
    val syncMethod: ChartSyncMethod? = null,
    val onMouseMove: ((ChartCursorEvent?) -> Unit)? = null,
) {
    companion object {
        /** The outside-provider props — the web `useSyncedCursor` `return {}`. */
        val EMPTY: SyncedCursorProps = SyncedCursorProps()
    }
}

/**
 * The framework-free decisions behind the surface's reader hooks — every branch the web `useSyncedCursor`
 * effect body makes, lifted out of Compose so the JVM gate covers them and the composables stay thin.
 */
object CursorSyncProjection {
    /**
     * Applies a chart pointer move to [store] for [syncId] — the web `useSyncedCursor` `onMouseMove` body.
     * No-ops when no provider is active (web `if (!syncId) return`); otherwise writes the event's
     * [ChartCursorEvent.activeLabel] (web `setCursorSyncPosition(syncId, state?.activeLabel ?? null)`), so a
     * `null` label — or a `null` event (pointer left the chart) — clears the persisted cursor.
     */
    fun applyMove(
        store: CursorSyncStore,
        syncId: String?,
        event: ChartCursorEvent?,
    ) {
        if (syncId == null) return
        store.set(syncId, event?.activeLabel)
    }

    /**
     * Builds the props a chart spreads — the web `useSyncedCursor` return value. Outside a provider ([sync]
     * is `null`) returns [SyncedCursorProps.EMPTY] (web `if (!ctx) return {}`); inside, carries the
     * [ChartSync.syncId] / [ChartSync.syncMethod] and the [onMouseMove] handler already bound to that syncId.
     */
    fun syncedCursorProps(
        sync: ChartSync?,
        onMouseMove: (ChartCursorEvent?) -> Unit,
    ): SyncedCursorProps =
        if (sync == null) {
            SyncedCursorProps.EMPTY
        } else {
            SyncedCursorProps(syncId = sync.syncId, syncMethod = sync.syncMethod, onMouseMove = onMouseMove)
        }
}

/**
 * The PII-safe registration for this surface (P1/S11). [SLUG] is the prompt-mandated surface slug emitted
 * with the one-shot `view.opened` diagnostic; [ID] is its stable kebab-case identifier. Only the slug is
 * ever logged — never a syncId nor a cursor value — so a diagnostics line can never leak which chart group a
 * user was inspecting or where their pointer was.
 */
object ChartTimeRangeContextRegistration {
    /** Stable kebab-case surface id. */
    const val ID: String = "chart-time-range-context"

    /** Diagnostics surface slug emitted with `view.opened` (the prompt-mandated slug). */
    const val SLUG: String = "ChartTimeRangeContext"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * Emits the one-shot PII-safe `view.opened` diagnostic for this surface (P1/S11). Carries only the surface
 * slug, so the diagnostic can never leak the syncId or the hovered cursor value. Call from the provider's
 * first-composition effect.
 */
fun recordChartTimeRangeContextOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ChartTimeRangeContextRegistration.SLUG))
}
