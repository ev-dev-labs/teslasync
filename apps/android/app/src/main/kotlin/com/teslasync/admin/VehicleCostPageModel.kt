// Pure, framework-free model + derivations for the VehicleCostPage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/VehicleCostPage.tsx, the per-vehicle ingest-cost report). No Compose, no Android
// UI, no HTTP lives here: the feed arrives as the shared, already-decoded S8 payload (the KMP
// `OperatorConfidenceStore.vehicleCost(sinceIso, limit)` ▸ `GET /admin/observability/vehicle-cost`, a typed
// `VehicleCostResponse`), so this file owns only the client-side derivations the web component does inline: the
// observation-window catalog (web `WINDOW_OPTIONS`) and its `Date.now() - days` lower-bound fold (web `since`
// useMemo), the empty-vehicles guard (web `vehicles.length === 0`), the elevated-DLQ flag (web `failures > 0`),
// the row display-name fallback, the `last_seen_at` ISO parse, and the one PII-safe `view.opened` diagnostic.
// None of the cost fields is unit-bearing in the SI sense (row counts, byte estimates the backend already
// computed, a per-minute rate, DLQ counts and an ISO timestamp), so there is no SI conversion — locale number /
// byte / relative-time formatting is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.vehiclecost

import io.teslasync.shared.core.data.repo.OperatorConfidenceRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostResponse
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostRow
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object VehicleCostPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminVehicleCost", "/admin/vehicle-cost", …)`). */
    const val ROUTE_ID: String = "adminVehicleCost"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/vehicle-cost"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "VehicleCostPage"
}

/**
 * The HTTP status the operator-confidence endpoints return when their backing repo is nil — the web `503` /
 * `SUBSYSTEM_NOT_CONFIGURED` signal the page branches on to render the "subsystem unavailable" banner rather
 * than a hard error (web `isApiError(error) && error.status === 503`). For this page the 503 means the
 * ingest-x-ray subsystem (the populated `signal_log` hypertable) is not configured on this deployment.
 */
const val HTTP_SUBSYSTEM_UNAVAILABLE: Int = 503

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Milliseconds in a 24 h day — the web `windowDays * 24 * 60 * 60 * 1000` factor. */
internal const val MILLIS_PER_DAY: Long = 86_400_000L

/**
 * The observation-window choices in their web declaration order (web `WINDOW_OPTIONS`): 1, 7, 30, then 90 days.
 * The render boundary maps each entry to its localized label; [days] is the exact day count the web sends, both
 * as the `since` lower-bound factor and as the `Window: {{days}}d` totals sublabel.
 */
enum class VehicleCostWindow(
    val days: Int,
) {
    D1(1),
    D7(7),
    D30(30),
    D90(90),
}

/** The window choices in web order (web `WINDOW_OPTIONS`). */
val VEHICLE_COST_WINDOW_OPTIONS: List<VehicleCostWindow> =
    listOf(
        VehicleCostWindow.D1,
        VehicleCostWindow.D7,
        VehicleCostWindow.D30,
        VehicleCostWindow.D90,
    )

/** The default observation window — the web `useState<number>(30)`. */
val DEFAULT_VEHICLE_COST_WINDOW: VehicleCostWindow = VehicleCostWindow.D30

/**
 * Resolves a [VehicleCostWindow] from the day-count token a [io.teslasync.android.components.ui.Select] hands
 * back, falling back to the [DEFAULT_VEHICLE_COST_WINDOW] for any unrecognised token so an unexpected value can
 * never become an invalid selection.
 */
fun vehicleCostWindowFromDays(days: Int): VehicleCostWindow =
    VehicleCostWindow.entries.firstOrNull { it.days == days } ?: DEFAULT_VEHICLE_COST_WINDOW

/**
 * The page's local interaction snapshot — the union of the web component's `windowDays` `useState` and the
 * `since` `useMemo` derived from it, folded into one immutable value so the composable reads a single source.
 * [sinceIso] is the ISO-8601 lower bound the shared repository sends (the web `since.toISOString()`); it is
 * recomputed only when [window] changes (the web `useMemo([windowDays])` dependency) so an ordinary refresh
 * re-fetches the identical query key, exactly like the web `refetchInterval`.
 */
data class VehicleCostInteraction(
    val window: VehicleCostWindow = DEFAULT_VEHICLE_COST_WINDOW,
    val sinceIso: String,
)

/**
 * The ISO-8601 lower bound for a [days]-wide window anchored at [nowMs] — the native fold of the web
 * `new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()`. Emits the same millisecond-precision
 * `…Z` instant the web `toISOString()` produces, so the shared repository's `since` query param matches.
 */
fun vehicleCostSinceIso(
    nowMs: Long,
    days: Int,
): String = Instant.ofEpochMilli(nowMs - days.toLong() * MILLIS_PER_DAY).toString()

/**
 * Whether the report carries no per-vehicle rows — gates the native Empty phase (web `vehicles.length === 0`).
 * A response with at least one vehicle is content (the table), never empty. The fleet totals card row is driven
 * separately from `totals` so it still renders its zeroed summary over an empty vehicle list (web `{totals &&
 * …}`).
 */
val VehicleCostResponse.isEmptyVehicles: Boolean
    get() = vehicles.isEmpty()

/**
 * Whether this row had any DLQ (codec/writer) rejections in the last 24 h — the web `failures > 0` test that
 * recolors the cell amber instead of muted. A zero or (defensively) negative count reads as not-elevated.
 */
val VehicleCostRow.isDlqElevated: Boolean
    get() = dlqFailures24h > 0L

/**
 * The vehicle's display name, or `null` when the server sent none — the web `r.display_name ??` fallback gate.
 * The render boundary substitutes the localized `Vehicle #{id}` label when this is `null`, so a blank server
 * name collapses to the same fallback as an absent one.
 */
fun VehicleCostRow.displayNameOrNull(): String? = displayName?.takeIf { it.isNotBlank() }

/**
 * Parses a `last_seen_at` ISO-8601 stamp to epoch milliseconds for the render boundary's relative-time
 * formatter, or `null` when the value is blank or unparseable (the web `formatRelative` `'—'` fallback). Both
 * the `…Z` instant form (Go `time.Time` default) and an explicit-offset form are accepted so an unexpected
 * server encoding degrades to the em-dash rather than crashing the row.
 */
fun parseEpochMillis(iso: String): Long? {
    if (iso.isBlank()) return null
    runCatching { return Instant.parse(iso).toEpochMilli() }
    runCatching { return OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
    return null
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehicleCostPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, display name, or cost value.
 */
fun recordVehicleCostPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to VehicleCostPageRegistration.SLUG))
}

/** The shared row-limit the page requests (web `useVehicleCost(since, 100)`). */
val VEHICLE_COST_LIMIT: Int = OperatorConfidenceRepository.DEFAULT_VEHICLE_COST_LIMIT
