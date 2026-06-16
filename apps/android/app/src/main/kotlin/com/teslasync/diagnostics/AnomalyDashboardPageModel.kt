// Pure, framework-free model + projections for the AnomalyDashboardPage diagnostics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references kotlinx-serialization,
// java.time, and the shared-core Resource/Logger), so the composable stays a thin render layer and all of this is
// exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) decoding the one raw `/analytics/anomalies` envelope the page
// reads (`{anomalies, health_summary, signals_monitored, anomalies_last_7d, anomalies_last_24h}`, web `useAnomalies`)
// into a typed, null-safe model (web optional-chaining → null-safe reads); (2) the `signalFrequency` derivation the bar
// chart draws (group anomalies by signal, sort by descending count, top ten — web `useMemo`); and (3) the per-row
// derivations the timeline reads (the detected-at instant, the chip type label).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the anomaly `value`, `baseline` and `z_score` are raw,
// dimensionless signal readings on the wire (the detector reports them verbatim) and are rendered verbatim, exactly as
// the web does (`fmtNumber(value, 2)` / `fmtNumber(baseline, 2)` / `fmtNumber(z_score, 1)`). There is no distance /
// speed / energy field on this surface, so no SI→display conversion applies; number formatting is the only display
// concern and lives at the render boundary.
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web `useAnomalies` query is gated on a
// selected vehicle (`enabled: vehicleId !== null`) and otherwise always renders the body (the four stat cards read
// `data?.field ?? 0`, each panel guarding its own slice). The native surface keeps that per-panel guarding inside the
// loaded body, AND routes an absent / all-zero report (no vehicle selected, or a vehicle with no telemetry yet) to a
// single friendly top-level empty surface via [AnomalyReport.hasData] — so the four declared data states are genuinely
// reachable without ever hiding a populated section.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.diagnostics.anomalydashboard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant

/** The rolling window the report covers — the web `useAnomalies(activeIdStr)` default of 7 days. */
internal const val ANOMALY_WINDOW_DAYS: Int = 7

/** The bar chart shows only the busiest signals — the web `.slice(0, 10)` cap on the frequency derivation. */
private const val TOP_FREQUENCY: Int = 10

/** Canonical anomaly detector type tokens (web `AnomalyEntry.type`), mapped to the chip labels the timeline draws. */
private const val TYPE_Z_SCORE = "z_score"
private const val TYPE_RANGE = "range"
private const val TYPE_TREND = "trend"

/** The non-i18n chip labels the web reads as literals for each detector type (web `typeLabel`). */
private const val TYPE_LABEL_STATISTICAL = "Statistical"
private const val TYPE_LABEL_RANGE = "Range"
private const val TYPE_LABEL_TREND = "Trend"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `AnomalyDashboardPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("anomalyDetection", "/anomaly-detection", …)`, so the host binds this surface to that destination (and its
 * `/anomaly-detection` deep link) without the nav module depending on it. The web also routes `/analytics/anomalies`
 * to the same page; the Android nav graph keys the destination on the shorter `/anomaly-detection` path.
 */
object AnomalyDashboardPageRegistration {
    /** The navigation destination id (Destinations.kt `page("anomalyDetection", "/anomaly-detection", …)`). */
    const val ROUTE_ID: String = "anomalyDetection"

    /** The web deep-link path this surface mirrors. */
    const val WEB_PATH: String = "/anomaly-detection"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "AnomalyDashboardPage"
}

/**
 * One decoded anomaly (web `AnomalyEntry`). [value], [baseline] and [zScore] are raw, dimensionless signal readings
 * (SI/verbatim on the wire); [detectedAtMillis] is the parsed epoch-ms of the `detected_at` instant (null when the
 * timestamp is absent or unparseable, so the row shows the em dash). [type] is the raw detector token; [severity] the
 * raw wire severity (`critical` / `warning` / `info`) — both rendered through the model's label + the shared
 * severity-badge color mapping.
 */
data class AnomalyEntry(
    val signal: String,
    val type: String,
    val severity: String,
    val value: Double,
    val baseline: Double,
    val zScore: Double,
    val detectedAtMillis: Long?,
    val message: String,
) {
    /** The detector-type chip label (web `typeLabel`): `z_score`→Statistical, `range`→Range, `trend`→Trend, else raw. */
    val typeLabel: String
        get() =
            when (type) {
                TYPE_Z_SCORE -> TYPE_LABEL_STATISTICAL
                TYPE_RANGE -> TYPE_LABEL_RANGE
                TYPE_TREND -> TYPE_LABEL_TREND
                else -> type
            }

    /** Whether the statistical chip should show (web `a.z_score > 0`). */
    val hasZScore: Boolean get() = zScore > 0.0
}

/** One decoded `health_summary` entry (web `Object.entries(health_summary)`): a [category] name + its [status] token. */
data class AnomalyHealthCategory(
    val category: String,
    val status: String,
)

/** One bar of the frequency chart: a [signal] name and the [count] of anomalies recorded against it (web `signalFrequency`). */
data class AnomalySignalFrequency(
    val signal: String,
    val count: Int,
)

/**
 * The decoded `/analytics/anomalies` report (web `AnomalyData`). [anomalies] is the timeline source; [healthCategories]
 * the system-health grid; [signalsMonitored] / [anomaliesLast7d] / [anomaliesLast24h] the summary stat-card counts.
 * Missing / JSON-null fields collapse to zero / empty, reproducing the web optional reads.
 */
data class AnomalyReport(
    val anomalies: List<AnomalyEntry>,
    val healthCategories: List<AnomalyHealthCategory>,
    val signalsMonitored: Int,
    val anomaliesLast7d: Int,
    val anomaliesLast24h: Int,
) {
    /** The number of health categories — the web `healthEntries.length` stat-card value. */
    val healthCategoryCount: Int get() = healthCategories.size

    /** The busiest signals as bar-chart rows (web `signalFrequency`): grouped, descending by count, top ten. */
    val signalFrequency: List<AnomalySignalFrequency> get() = computeSignalFrequency(anomalies)

    /**
     * Whether any meaningful signal-anomaly intelligence has accrued. A brand-new / unselected vehicle with no
     * monitored signals, no health categories and no anomalies routes to the friendly empty surface rather than a
     * grid of zeros (the documented divergence above).
     */
    val hasData: Boolean
        get() =
            signalsMonitored > 0 ||
                anomalies.isNotEmpty() ||
                healthCategories.isNotEmpty() ||
                anomaliesLast7d > 0 ||
                anomaliesLast24h > 0

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: AnomalyReport = AnomalyReport(emptyList(), emptyList(), 0, 0, 0)
    }
}

/**
 * Decodes the raw `/analytics/anomalies` [json] (snake_case on the wire) into an [AnomalyReport]. A non-object input,
 * a missing field, or a JSON-null field all collapse to zero / empty — reproducing the web optional reads.
 */
fun parseAnomalyReport(json: JsonElement?): AnomalyReport {
    val obj = json as? JsonObject ?: return AnomalyReport.EMPTY
    return AnomalyReport(
        anomalies = parseAnomalies(obj["anomalies"]),
        healthCategories = parseHealthCategories(obj["health_summary"]),
        signalsMonitored = obj.int("signals_monitored"),
        anomaliesLast7d = obj.int("anomalies_last_7d"),
        anomaliesLast24h = obj.int("anomalies_last_24h"),
    )
}

/** Decodes the `anomalies` [json] array into [AnomalyEntry]s, skipping any non-object / unnamed-signal row. */
fun parseAnomalies(json: JsonElement?): List<AnomalyEntry> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val signal = row.string("signal")?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
        AnomalyEntry(
            signal = signal,
            type = row.string("type").orEmpty(),
            severity = row.string("severity").orEmpty(),
            value = row.double("value"),
            baseline = row.double("baseline"),
            zScore = row.double("z_score"),
            detectedAtMillis = parseDetectedAtMillis(row.string("detected_at")),
            message = row.string("message").orEmpty(),
        )
    }
}

/**
 * Decodes the `health_summary` [json] object (a `{category: status}` map) into ordered [AnomalyHealthCategory]s.
 * Insertion order is preserved (web `Object.entries`); a non-string status falls back to a blank token.
 */
fun parseHealthCategories(json: JsonElement?): List<AnomalyHealthCategory> {
    val obj = json as? JsonObject ?: return emptyList()
    return obj.entries.map { (category, value) ->
        AnomalyHealthCategory(category = category, status = (value as? JsonPrimitive)?.contentOrNull.orEmpty())
    }
}

/**
 * Groups [anomalies] by signal and projects the busiest [TOP_FREQUENCY] into descending-count bars — the web
 * `signalFrequency` useMemo. Insertion order seeds the tie-break so the projection is deterministic.
 */
fun computeSignalFrequency(anomalies: List<AnomalyEntry>): List<AnomalySignalFrequency> {
    if (anomalies.isEmpty()) return emptyList()
    val counts = LinkedHashMap<String, Int>()
    for (entry in anomalies) {
        counts[entry.signal] = (counts[entry.signal] ?: 0) + 1
    }
    return counts.entries
        .map { AnomalySignalFrequency(signal = it.key, count = it.value) }
        .sortedByDescending { it.count }
        .take(TOP_FREQUENCY)
}

/** Parses an ISO-8601 `detected_at` [iso] to epoch-ms, or null when it is absent / unparseable (web `new Date(value)`). */
fun parseDetectedAtMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AnomalyDashboardPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, signal name, value or baseline payload.
 */
fun recordAnomalyDashboardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AnomalyDashboardPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
