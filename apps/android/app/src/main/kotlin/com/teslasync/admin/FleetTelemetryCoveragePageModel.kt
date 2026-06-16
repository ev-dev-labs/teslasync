// Pure, framework-free model + derivations for the FleetTelemetryCoveragePage admin surface — the native
// analogue of everything the web page computes before it returns JSX
// (web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx, the package-derived Fleet-Telemetry routing
// snapshot). No Compose, no Android framework, no HTTP lives here: every type is exercised off-device,
// keeping the composable a thin render layer.
//
// The snapshot arrives as the shared, already-normalized S8 payload (the KMP
// `FleetTelemetryStore.coverage()` ▸ `GET /tesla/fleet-telemetry/coverage`, a typed, guaranteed-non-null
// `FleetTelemetryCoverageResponse`). So this file owns only the client-side derivations the web component
// does inline: the global summary stats (web `summarise`), the category/field text filter (web
// `filteredCategories` + the per-section field filter), and the destination-count ordering (web
// `Object.entries(...).sort((a, b) => b[1] - a[1])`). None of the routing metadata is unit-bearing
// (category/field/destination names, integer counts, routing booleans), so there is no SI conversion here —
// locale number formatting is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling ApiLogsPage / FeedbackQueuePage admin surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.fleettelemetry

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCategoryCoverage
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryFieldCoverage

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object FleetTelemetryCoverageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminTelemetryCoverage", "/admin/telemetry/coverage", …)`). */
    const val ROUTE_ID: String = "adminTelemetryCoverage"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/telemetry/coverage"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FleetTelemetryCoveragePage"
}

/**
 * The global summary stats the page header tiles render — the native mirror of the web `summarise(data)`
 * derivation. [unsubscribedRoutedFields] is `totalRoutedFields - subscribedFields`, matching the web
 * "Routed, not subscribed" tile.
 */
data class CoverageStats(
    val totalCategories: Int,
    val totalRoutedFields: Int,
    val subscribedFields: Int,
    val unsubscribedRoutedFields: Int,
    val orphanFields: Int,
) {
    companion object {
        /** The all-zero summary the web `summarise(undefined)` returns before any data resolves. */
        val EMPTY: CoverageStats = CoverageStats(0, 0, 0, 0, 0)
    }
}

/**
 * Folds the coverage snapshot into the five global tile values (web `summarise`). A `null` snapshot (the
 * defensive pre-load / hard-error case) yields [CoverageStats.EMPTY], exactly the web `if (!data)` branch.
 */
fun summarise(data: FleetTelemetryCoverageResponse?): CoverageStats {
    if (data == null) return CoverageStats.EMPTY
    val categories = data.categories
    var totalRouted = 0
    var subscribed = 0
    for (cat in categories) {
        val fields = cat.fields
        totalRouted += fields.size
        for (field in fields) {
            if (field.subscribed) subscribed += 1
        }
    }
    return CoverageStats(
        totalCategories = categories.size,
        totalRoutedFields = totalRouted,
        subscribedFields = subscribed,
        unsubscribedRoutedFields = totalRouted - subscribed,
        orphanFields = data.orphanFields.size,
    )
}

/**
 * Whether [field] matches the active text [query] (already trimmed + lower-cased) — the web per-row predicate
 * `field|destination|(column ?? '')` case-insensitive substring match. A blank query matches everything.
 */
fun fieldMatches(
    field: FleetTelemetryFieldCoverage,
    query: String,
): Boolean {
    if (query.isEmpty()) return true
    return field.field.lowercase().contains(query) ||
        field.destination.lowercase().contains(query) ||
        (field.column ?: "").lowercase().contains(query)
}

/**
 * The fields of [category] surviving the active [filter] (web `CategorySection`'s memoized `filtered`). A
 * blank filter returns every field unchanged.
 */
fun filteredFields(
    category: FleetTelemetryCategoryCoverage,
    filter: String,
): List<FleetTelemetryFieldCoverage> {
    val query = filter.trim().lowercase()
    if (query.isEmpty()) return category.fields
    return category.fields.filter { fieldMatches(it, query) }
}

/**
 * The categories surviving the active [filter] (web `filteredCategories`): a category is kept when its name
 * matches OR any of its fields match. A blank filter returns every category unchanged.
 */
fun filteredCategories(
    categories: List<FleetTelemetryCategoryCoverage>,
    filter: String,
): List<FleetTelemetryCategoryCoverage> {
    val query = filter.trim().lowercase()
    if (query.isEmpty()) return categories
    return categories.filter { cat ->
        cat.category.lowercase().contains(query) || cat.fields.any { fieldMatches(it, query) }
    }
}

/**
 * A destination-count map ordered by descending count (web `Object.entries(...).sort((a, b) => b[1] - a[1])`).
 * Used for both the page-level "Destination breakdown" badges and each category header's per-destination
 * chips. Ties keep their original insertion order (Kotlin `sortedByDescending` is stable).
 */
fun sortedDestinations(destinations: Map<String, Int>): List<Pair<String, Int>> =
    destinations.entries.sortedByDescending { it.value }.map { it.key to it.value }

/** Whether the snapshot returned no categories — gates the native Empty phase (web `categories.length === 0`). */
val FleetTelemetryCoverageResponse.isEmptyCoverage: Boolean get() = categories.isEmpty()

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no row content. */
internal fun recordCoveragePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FleetTelemetryCoverageRegistration.SLUG))
}
