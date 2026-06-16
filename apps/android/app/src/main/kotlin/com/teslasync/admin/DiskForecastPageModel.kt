// Pure, framework-free model + derivations for the DiskForecastPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/DiskForecastPage.tsx, the
// per-hypertable disk-usage forecast). No Compose, no Android framework, no HTTP lives here: the feed arrives
// already typed from the shared S8 OperatorConfidenceStore (`GET /admin/observability/disk-forecast` ▸
// diskForecast(), a typed `DiskForecastResponse`), so this file owns only the client-side derivations the web
// component does inline: the fleet-wide total/uncompressed/compressed/growth roll-up (web `fleetTotals` memo),
// the uncompressed/compressed share-of-total percentages (web `(part / total) * 100`, `null` when the fleet has
// no bytes so the render boundary substitutes the em-dash, web `fleetTotals.total > 0 ? … : '—'`), the
// empty-hypertables guard (web `rows.length === 0`), the severity-tier classification (web `SEVERITY_VARIANT` /
// `SEVERITY_LABEL` maps), the HTTP-503 "subsystem not configured" predicate (web
// `isApiError(error) && error.status === 503`), and the one PII-safe `view.opened` diagnostic.
//
// The byte sizes, growth rate (bytes/day) and days-to-quota estimate the backend already computed are not
// unit-bearing in the SI-conversion sense, so there is no SI conversion here — binary-prefix byte formatting and
// locale number formatting are applied at the render boundary (S5), exactly as the web `formatBytes` / `fmtNumber`
// helpers are.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/admin —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling admin surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.diskforecast

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.DiskForecastResponse
import io.teslasync.shared.core.presentation.operatorconfidence.HypertableSize

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The HTTP status the operator-confidence endpoints return when their backing repo is nil (web `503`). */
internal const val HTTP_SUBSYSTEM_NOT_CONFIGURED: Int = 503

/** The `* 100` factor folding a byte ratio into a share-of-total percentage (web `(part / total) * 100`). */
private const val PERCENT_SCALE: Double = 100.0

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object DiskForecastPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminDiskForecast", "/admin/disk-forecast", …)`). */
    const val ROUTE_ID: String = "adminDiskForecast"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/disk-forecast"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no hypertable name. */
    const val SLUG: String = "DiskForecastPage"
}

/**
 * The severity tier of one hypertable — the native mirror of the web `DiskForecastSeverity` union
 * (`ok | warn | critical | unknown`). The wire value arrives as a raw string (so an unexpected server token
 * round-trips verbatim instead of blanking the screen); [from] folds it to this closed tier, defaulting to
 * [Unknown] for anything unrecognised exactly as the web `SEVERITY_VARIANT[…] ?? 'neutral'` fallback does.
 */
enum class DiskSeverityTone {
    Ok,
    Warn,
    Critical,
    Unknown,
    ;

    internal companion object {
        /** Classify the raw `severity` string (web severity union), defaulting to [Unknown]. */
        fun from(raw: String): DiskSeverityTone =
            when (raw.lowercase()) {
                "ok" -> Ok
                "warn" -> Warn
                "critical" -> Critical
                else -> Unknown
            }
    }
}

/**
 * The fleet-wide roll-up over every hypertable — the native mirror of the web `fleetTotals` memo. Computed once
 * per payload and consumed by the four stat tiles; [uncompressedPercent] / [compressedPercent] are the
 * share-of-total figures the web renders as the uncompressed/compressed tile sublabels, `null` when the fleet
 * has no bytes so the render boundary substitutes the em-dash (web `fleetTotals.total > 0 ? … : '—'`).
 */
data class DiskFleetTotals(
    val totalBytes: Long,
    val uncompressedBytes: Long,
    val compressedBytes: Long,
    val growthBytesPerDay: Double,
) {
    /** Uncompressed share of the fleet total as a percentage, or `null` when there are no bytes (web `'—'`). */
    val uncompressedPercent: Double? get() = percentOfTotal(uncompressedBytes)

    /** Compressed share of the fleet total as a percentage, or `null` when there are no bytes (web `'—'`). */
    val compressedPercent: Double? get() = percentOfTotal(compressedBytes)

    private fun percentOfTotal(part: Long): Double? =
        if (totalBytes > 0L) part * PERCENT_SCALE / totalBytes else null

    internal companion object {
        val EMPTY: DiskFleetTotals = DiskFleetTotals(0L, 0L, 0L, 0.0)

        /** Fold [rows] into the fleet roll-up (web `fleetTotals` reducer). */
        fun from(rows: List<HypertableSize>): DiskFleetTotals {
            var total = 0L
            var uncompressed = 0L
            var compressed = 0L
            var growth = 0.0
            for (row in rows) {
                total += row.totalBytes
                uncompressed += row.uncompressedBytes
                compressed += row.compressedBytes
                growth += row.growthBytesPerDay
            }
            return DiskFleetTotals(
                totalBytes = total,
                uncompressedBytes = uncompressed,
                compressedBytes = compressed,
                growthBytesPerDay = growth,
            )
        }
    }
}

/**
 * The render-ready projection the surface binds to: the hypertable [rows] in server order and their derived
 * fleet [totals]. [isEmpty] gates the native Empty phase — the server returned no hypertables (web
 * `rows.length === 0`); [hasRows] gates the four-tile stats grid (web `rows.length > 0`).
 */
data class DiskForecastView(
    val rows: List<HypertableSize>,
    val totals: DiskFleetTotals,
) {
    val isEmpty: Boolean get() = rows.isEmpty()
    val hasRows: Boolean get() = rows.isNotEmpty()

    internal companion object {
        val EMPTY: DiskForecastView = DiskForecastView(emptyList(), DiskFleetTotals.EMPTY)

        /** Project the typed [response] into the totals-folded view (web `query.data?.hypertables ?? []`). */
        fun from(response: DiskForecastResponse?): DiskForecastView {
            val rows = response?.hypertables ?: emptyList()
            return DiskForecastView(rows = rows, totals = DiskFleetTotals.from(rows))
        }
    }
}

/**
 * Whether the disk-forecast subsystem is unconfigured on this deployment — the native mirror of the web
 * `subsystemMissing = isApiError(error) && error.status === 503`. The backend returns HTTP 503 with
 * `code: SUBSYSTEM_NOT_CONFIGURED` when TimescaleDB hypertable metrics are unavailable; the surface branches on
 * this to render an explanatory warning banner + empty table rather than a hard error.
 */
fun isSubsystemMissing(httpStatus: Int?): Boolean = httpStatus == HTTP_SUBSYSTEM_NOT_CONFIGURED

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DiskForecastPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no hypertable name or byte value.
 */
internal fun recordDiskForecastPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DiskForecastPageRegistration.SLUG))
}
