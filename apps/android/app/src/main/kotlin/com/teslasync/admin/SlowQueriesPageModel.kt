// Pure, framework-free model + derivations for the SlowQueriesPage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/SlowQueriesPage.tsx, the pg_stat_statements top-N slow-query report). No
// Compose, no Android UI, no HTTP lives here: the feed arrives as the shared, already-decoded S8 payload (the
// KMP `OperatorConfidenceStore.slowQueries(orderBy, limit)` ▸ `GET /admin/observability/slow-queries`, a typed
// `SlowQueriesResponse`), so this file owns only the client-side derivations the web component does inline: the
// shared-buffer cache-hit-ratio fold (web `cacheHitRatio`), the empty-rows guard, the order-by / limit option
// catalogs (web `ORDER_BY_OPTIONS` / `LIMIT_OPTIONS`), the order-by wire round-trip, and the one PII-safe
// `view.opened` diagnostic. None of the slow-query fields is unit-bearing (counts, millisecond timings the
// backend already computed, and a derived percentage), so there is no SI conversion — locale number formatting
// is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.slowqueries

import io.teslasync.shared.core.data.repo.OperatorConfidenceRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryRow

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object SlowQueriesPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminSlowQueries", "/admin/slow-queries", …)`). */
    const val ROUTE_ID: String = "adminSlowQueries"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/slow-queries"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no query text. */
    const val SLUG: String = "SlowQueriesPage"
}

/**
 * The HTTP status the operator-confidence endpoints return when their backing repo is nil — the web `503` /
 * `SUBSYSTEM_NOT_CONFIGURED` signal the page branches on to render the "subsystem unavailable" banner rather
 * than a hard error (web `isApiError(error) && error.status === 503`). For this page the 503 means
 * pg_stat_statements is not installed on the PostgreSQL instance.
 */
const val HTTP_SUBSYSTEM_UNAVAILABLE: Int = 503

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The percentage scale for the cache-hit ratio (web `(hit / total) * 100`). */
private const val PERCENT_SCALE: Double = 100.0

/**
 * The order-by choices in their web declaration order (web `ORDER_BY_OPTIONS`): mean time, total time, calls,
 * then max time. The render boundary maps each enum to its localized label; the enum's `wire` is the exact
 * `order_by` query-string token the shared repository sends.
 */
val SLOW_QUERY_ORDER_OPTIONS: List<SlowQueryOrderBy> =
    listOf(
        SlowQueryOrderBy.MEAN_TIME,
        SlowQueryOrderBy.TOTAL_TIME,
        SlowQueryOrderBy.CALLS,
        SlowQueryOrderBy.MAX_TIME,
    )

/** The configurable row-limit choices (web `LIMIT_OPTIONS = [10, 25, 50, 100]`). */
val SLOW_QUERY_LIMIT_OPTIONS: List<Int> = listOf(10, 25, 50, 100)

/**
 * Resolves a `SlowQueryOrderBy` from the `wire` token a [io.teslasync.android.components.ui.Select] hands back,
 * falling back to the shared default (web `useSlowQueries(orderBy = 'mean_time')`) for any unrecognised token so
 * an unexpected value can never become an invalid request param.
 */
fun slowQueryOrderByFromWire(wire: String): SlowQueryOrderBy =
    SlowQueryOrderBy.entries.firstOrNull { it.wire == wire }
        ?: OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_ORDER_BY

/**
 * Whether the report carries no rows — gates the native Empty phase (web `rows.length === 0`). A response with
 * at least one row is content (the table), never empty.
 */
val SlowQueriesResponse.isEmptyRows: Boolean
    get() = slowQueries.isEmpty()

/**
 * The shared-buffer cache-hit percentage for a row — the native fold of the web `cacheHitRatio`. Returns `null`
 * when there were no shared-buffer block touches to derive a ratio from (web returns `'—'`), so the render
 * boundary shows the em-dash honestly instead of a misleading `0%`. Otherwise it is `hit / (hit + read) * 100`.
 */
fun SlowQueryRow.cacheHitPercent(): Double? {
    val hit = sharedBlksHit ?: 0
    val read = sharedBlksRead ?: 0
    val total = hit + read
    if (total <= 0) return null
    return hit * PERCENT_SCALE / total
}

/**
 * The fingerprint to render for a row, applying the web `r.fingerprint || '—'` fallback so a blank normalised
 * query collapses to the em-dash rather than an empty cell.
 */
fun SlowQueryRow.fingerprintOrDash(): String = fingerprint.ifBlank { EM_DASH }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SlowQueriesPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no fingerprint, query id, or row content.
 */
fun recordSlowQueriesPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SlowQueriesPageRegistration.SLUG))
}
