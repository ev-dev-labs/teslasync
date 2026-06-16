// Pure, framework-free model + projections for the SignalExplorerPage telemetry surface — the native analogue of
// everything the web page derives before composing its controls panel
// (web/src/features/telemetry/pages/SignalExplorerPage.tsx). No Compose, no Android UI, no HTTP: every declaration
// here is plain Kotlin (it only references the framework-free shared-core Resource + signals read models), so the
// composable stays a thin render layer and the derivations are unit-tested off-device.
//
// The web page owns three concerns this file ports: (1) the page's local interaction state — the selected signal
// names, the inclusive date range, the page size, and the live toggle (web `useUrlArray`/`useRangeState`/
// `useUrlNumber`/`useState`); (2) the catalog read-model projection that turns the typed `useSignals`
// AvailableSignalsResponse into the flat `string[]` of names every consumer treats it as (web `useSignals`
// normalizes the rich catalog down to names); and (3) the cache-then-network Resource re-shaping plus the PII-safe
// `view.opened` diagnostic bookkeeping. The hard 5-signal cap and the explore-readiness predicate are reproduced
// verbatim so the controls behave exactly like the web filter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/telemetry — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling admin/system surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalexplorer

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SignalExplorerPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("signalExplorer", "/signal-explorer", NavGroup.Telemetry)`, so [io.teslasync.android.navigation.PageHosts]
 * binds this surface to that destination (and its `/signal-explorer` deep link) without the nav module depending on it.
 */
object SignalExplorerPageRegistration {
    /** The navigation destination id (Destinations.kt `page("signalExplorer", "/signal-explorer", …)`). */
    const val ROUTE_ID: String = "signalExplorer"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/signal-explorer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id or signal names. */
    const val SLUG: String = "SignalExplorerPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle/signal data. */
internal fun recordSignalExplorerPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SignalExplorerPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

// ── Controls vocabulary (web constants) ───────────────────────────────────────────────────────────────────────

/** Hard selection cap — web `MAX_SIGNALS = 5`, chosen so the resulting chart stays legible. */
const val MAX_SIGNALS: Int = 5

/** The page-size choices — web `PER_PAGE_OPTIONS` (25 / 50 / 100 / 500). */
val PER_PAGE_OPTIONS: List<Int> = listOf(25, 50, 100, 500)

/** The initial page size — web `useUrlNumber('size', 25)`. */
const val DEFAULT_PER_PAGE: Int = 25

// ── Local interaction state (web useState group) ──────────────────────────────────────────────────────────────

/**
 * The page's local interaction snapshot — the union of the web component's client-state cells: the ordered
 * [selectedSignals] (web `useUrlArray('signals')`), the inclusive `[startEpochDay, endEpochDay]` window (web
 * `useRangeState`), the [perPage] page size (web `useUrlNumber('size')`), the [isLive] stream toggle (web `isLive`),
 * the [liveConnected] SSE connection flag the live badge reads (web `live.connected`), and the [hasExplored] latch
 * that swaps the "pick signals" prompt for the results area (web `exploreKey !== null`).
 *
 * The live SSE pipeline (P1/S4/S6) is not a declared data source for this parity unit, so [liveConnected] stays
 * `false` until that stream is wired into the surface — the badge then honestly reads "Disconnected" rather than
 * claiming a connection the unit does not hold (honesty covenant: no red-as-green).
 */
data class SignalExplorerInteraction(
    val selectedSignals: List<String> = emptyList(),
    val startEpochDay: Long? = null,
    val endEpochDay: Long? = null,
    val perPage: Int = DEFAULT_PER_PAGE,
    val isLive: Boolean = false,
    val liveConnected: Boolean = false,
    val hasExplored: Boolean = false,
) {
    /**
     * Whether Explore is enabled — web `canExplore = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0`.
     */
    fun canExplore(vehicleId: Long?): Boolean =
        selectedSignals.isNotEmpty() && startEpochDay != null && endEpochDay != null && (vehicleId ?: 0L) > 0L

    /** Whether the Live toggle is enabled — web `disabled={selectedSignals.length === 0 && !isLive}` (negated). */
    val canToggleLive: Boolean get() = selectedSignals.isNotEmpty() || isLive

    /** Whether the "pick signals and click Explore" prompt shows — web `!hasHistorical && !isLive`. */
    val showPickPrompt: Boolean get() = !hasExplored && !isLive

    /** Clamp a freshly toggled selection to the hard cap — web `next.slice(0, MAX_SIGNALS)`. */
    fun withSignals(next: List<String>): SignalExplorerInteraction = copy(selectedSignals = next.take(MAX_SIGNALS))
}

// ── Catalog read-model projection (web useSignals normalization) ──────────────────────────────────────────────

/**
 * The flat list of signal names the controls' multi-select reads — the native mirror of the web `useSignals`
 * `queryFn`, which normalizes the rich `{ signals: AvailableSignal[] }` catalog down to `string[]` of names
 * because every consumer (the Signal Explorer selector included) treats the result as a flat name list.
 */
fun AvailableSignalsResponse.toSignalNames(): List<String> = signals.map { it.name }

// ── Resource re-shaping ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The
 * cached value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both
 * transformed; the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `AvailableSignalsResponse → List<String>` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
