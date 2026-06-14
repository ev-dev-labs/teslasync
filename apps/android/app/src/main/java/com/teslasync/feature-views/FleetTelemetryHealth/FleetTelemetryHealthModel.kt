// Pure, framework-free model + projection for the FleetTelemetryHealth feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx): the `vinList`/`errorList`
// fallbacks, the `isRecent` 24-hour recency test that recolors the Last Seen / Reported At cells, and
// the two DataTable column projections (the VIN summary table and the paginated error log). No Compose,
// no Android framework, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. Timestamps arrive as
// the raw ISO strings the Go backend serves and are rendered verbatim as relative ages here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FleetTelemetryHealth — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling TelemetryErrorsPanel
// surface does. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleettelemetryhealth

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN or error
 * payload, so a diagnostics line can never leak the fleet's telemetry posture.
 */
const val FLEET_TELEMETRY_HEALTH_SLUG: String = "FleetTelemetryHealth"

/** Em dash shown wherever a timestamp is missing/unparseable — the web `TimeStamp` `'—'` fallback. */
internal const val FLEET_HEALTH_EM_DASH: String = "\u2014"

/** A datum is "recent" when seen within this window (web `isRecent`: `diff < 24 * 60 * 60 * 1000`). */
internal const val FLEET_HEALTH_RECENT_WINDOW_MS: Long = 24L * 60L * 60L * 1000L

/** The web `DataTable` default `defaultPageSize` (25) — the Error Log uses bare `pagination`. */
const val FLEET_HEALTH_ERRORS_PAGE_SIZE: Int = 25

/**
 * The localized relative-time words the projection folds into its timestamp labels, resolved from the
 * P1/S10 i18n catalog at the Compose boundary (`stringResource`) and passed in so the projection stays
 * pure and JVM-testable. Mirrors the shared `translation_freshness_justNow` / `translation_widget_ago`
 * keys the sibling TelemetryErrorsWidget uses for its relative labels.
 *
 * @property justNow the "< 1m" relative word (shared `translation_freshness_justNow`).
 * @property ago the relative-time suffix appended after the magnitude (shared `translation_widget_ago`).
 */
data class FleetTelemetryHealthLabels(
    val justNow: String,
    val ago: String,
)

/**
 * One projected, render-ready Error-VIN row — the native analogue of a web `vinColumns` row. Pure data
 * (no Compose types): the [vin] (also the table key, web `keyExtractor={(r) => r.vin}`), the already
 * relative [firstSeenText] / [lastSeenText], and whether the last sighting was within the last 24 h
 * ([lastSeenRecent]) which recolors the Last Seen cell (web `isRecent ? rose : amber`).
 */
data class FleetVinRow(
    val vin: String,
    val firstSeenText: String,
    val lastSeenText: String,
    val lastSeenRecent: Boolean,
)

/**
 * One projected, render-ready Error-Log row — the native analogue of a web `errorColumns` row. Pure
 * data: the table [key] (web `keyExtractor={(r) => String(r.id)}`), the [vin], the optional
 * [errorCode] (a danger Badge when present, else a muted em dash — web `r.error_code ? Badge : '—'`),
 * the [errorMessage] (web `r.error_message ?? '—'`), the relative [reportedAtText], and whether it was
 * reported within the last 24 h ([reportedAtRecent]) which recolors the cell (web
 * `r.reported_at && isRecent(r.reported_at) ? rose : secondary`).
 */
data class FleetErrorRow(
    val key: String,
    val vin: String,
    val errorCode: String?,
    val errorMessage: String,
    val reportedAtText: String,
    val reportedAtRecent: Boolean,
)

/**
 * Pure projection from the decoded cache-then-network payloads to the render-ready rows — the native
 * port of the web component's column `render` callbacks plus the `isRecent` recency math and the
 * `?? '—'` / `?? []` fallbacks. [nowMillis] is the clock the recent/relative-time math reads
 * (injectable for deterministic tests).
 */
object FleetTelemetryHealthProjection {
    /**
     * Project the Error-VIN summary rows (web `vinList = errorVINs ?? []` → `vinColumns`). An absent
     * (blank/unparseable) `first_seen_at` / `last_seen_at` renders as the em dash, never a crash.
     */
    fun projectVins(
        vins: List<FleetTelemetryErrorVIN>,
        labels: FleetTelemetryHealthLabels,
        nowMillis: Long,
    ): List<FleetVinRow> =
        vins.map { vin ->
            val firstMillis = parseTimestampMillis(vin.firstSeenAt)
            val lastMillis = parseTimestampMillis(vin.lastSeenAt)
            FleetVinRow(
                vin = vin.vin,
                firstSeenText = relativeLabel(firstMillis, nowMillis, labels),
                lastSeenText = relativeLabel(lastMillis, nowMillis, labels),
                lastSeenRecent = isRecent(lastMillis, nowMillis),
            )
        }

    /**
     * Project the Error-Log rows (web `errorList = errors ?? []` → `errorColumns`). A missing
     * `reported_at` is never "recent" (web `r.reported_at && isRecent(...)`), so the cell stays the
     * neutral secondary color.
     */
    fun projectErrors(
        errors: List<FleetTelemetryError>,
        labels: FleetTelemetryHealthLabels,
        nowMillis: Long,
    ): List<FleetErrorRow> =
        errors.map { error ->
            val reportedMillis = parseTimestampMillis(error.reportedAt)
            FleetErrorRow(
                key = error.id.toString(),
                vin = error.vin,
                errorCode = error.errorCode,
                errorMessage = error.errorMessage ?: FLEET_HEALTH_EM_DASH,
                reportedAtText = relativeLabel(reportedMillis, nowMillis, labels),
                reportedAtRecent = error.reportedAt != null && isRecent(reportedMillis, nowMillis),
            )
        }

    /** True when [millis] is within the last 24 h of [nowMillis] (web `now - time < 24h`). */
    fun isRecent(
        millis: Long?,
        nowMillis: Long,
    ): Boolean = millis != null && nowMillis - millis < FLEET_HEALTH_RECENT_WINDOW_MS

    /**
     * The localized relative-time label for a [millis] timestamp — reuses the shared, tested
     * [relativeAge] bucketing (whose < 1m / < 1h / < 24h cutoffs match the web `TimeStamp`). The i18n
     * words are injected so this stays pure + unit-testable; an absent timestamp folds to the em dash.
     */
    fun relativeLabel(
        millis: Long?,
        nowMillis: Long,
        labels: FleetTelemetryHealthLabels,
    ): String =
        when (val age = relativeAge(computeAgeSeconds(millis, nowMillis))) {
            FreshnessAge.Unknown -> FLEET_HEALTH_EM_DASH
            FreshnessAge.JustNow -> labels.justNow
            is FreshnessAge.Seconds -> labels.justNow
            is FreshnessAge.Minutes -> "${age.value}m ${labels.ago}"
            is FreshnessAge.Hours -> "${age.value}h ${labels.ago}"
            is FreshnessAge.Days -> "${age.value}d ${labels.ago}"
            is FreshnessAge.Weeks -> "${age.value}w ${labels.ago}"
        }

    /**
     * Parse a `first_seen_at` / `last_seen_at` / `reported_at` wire string to epoch millis (tolerant
     * of a `Z` suffix, an explicit offset, or a zoneless local timestamp), or `null` when absent or
     * unparseable — so a malformed stamp renders the em dash rather than throwing.
     */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FLEET_TELEMETRY_HEALTH_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls
 * it from the composable's first-composition effect.
 */
fun recordFleetTelemetryHealthOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FLEET_TELEMETRY_HEALTH_SLUG))
}
