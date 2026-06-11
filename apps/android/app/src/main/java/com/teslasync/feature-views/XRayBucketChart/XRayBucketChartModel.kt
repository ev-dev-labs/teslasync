// Pure, framework-free model + projection for the Ingest X-Ray bucket chart feature view — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent loads the `IngestXRayBucketPoint[]` and passes
// it down with a `loading` flag. This file owns the parts the web `useMemo` computes from that prop: the
// per-bucket count series, the X-axis time labels (web `formatTime(new Date(ts))`), and the accessible
// fallback table rows (web `dataColumns` → `[bucket_start, fmtInt(count)]`). The bucket order is preserved
// exactly as received (the backend already returns chronological buckets and the web data table maps in
// array order), so the native categorical bar chart and its table read left-to-right in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/XRayBucketChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xraybucketchart

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown when a bucket timestamp is missing or unparseable — the web `formatTime` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object XRayBucketChartRegistration {
    /** Stable surface id. */
    const val ID: String = "x-ray-bucket-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "XRayBucketChart"
}

/**
 * One ingest sample-count bucket — the native mirror of the web `IngestXRayBucketPoint`
 * (`{ bucket_start: string; count: number }`). [bucketStart] is the ISO-8601 start of the time bucket
 * and [count] is the number of telemetry rows ingested in it (a non-negative integer, so `Long`).
 */
data class XRayBucketPoint(
    val bucketStart: String,
    val count: Long,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the six
 * `admin.xray.chart.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier. [seriesLabel] is the web tooltip series name (`Samples`).
 */
data class XRayBucketChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val bucketColumn: String,
    val countColumn: String,
    val seriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's `series`
 * `useMemo` plus the `ChartContainer` `data`/`dataColumns` props. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host: the composable wraps [values] into a `ChartSeries`, feeds
 * [xLabels] to the bar chart's bottom axis, and renders [tableRows] as the accessible fallback table.
 */
data class XRayBucketChartProjectionResult(
    val xLabels: List<String>,
    val values: List<Double>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object XRayBucketChartProjection {
    /**
     * Projects the loaded [buckets] into render-ready chart inputs, preserving the received order. Each
     * bucket contributes one X-axis label ([formatTime] of its `bucketStart`), one bar value (its count),
     * and one accessible-table row (`[bucketStart, formatCount(count)]`, mirroring the web `dataColumns`
     * where the Bucket column is the raw ISO string and the Samples column is the grouped integer).
     * Injecting the two formatters keeps this function locale/zone-deterministic for tests.
     */
    fun project(
        buckets: List<XRayBucketPoint>,
        formatTime: (bucketStart: String) -> String,
        formatCount: (count: Long) -> String,
    ): XRayBucketChartProjectionResult =
        XRayBucketChartProjectionResult(
            xLabels = buckets.map { formatTime(it.bucketStart) },
            // `+ 0.0` widens each Long sample count to the chart series' Double value type.
            values = buckets.map { it.count + 0.0 },
            tableRows = buckets.map { listOf(it.bucketStart, formatCount(it.count)) },
            isEmpty = buckets.isEmpty(),
        )

    /** Locale-grouped integer formatting — the native analogue of the web `fmtInt` (e.g. `1,204`). */
    fun formatCount(
        count: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", count)
}

/**
 * Tolerant ISO-8601 → localized short-time formatter — the native analogue of the web `formatTime`
 * (`toLocaleTimeString` with `{hour:'2-digit', minute:'2-digit'}`). Pure (java.time only) so it is
 * unit-tested deterministically with a fixed zone/locale. A blank or unparseable input yields [EM_DASH],
 * exactly like the web helper's invalid-date guard.
 */
object XRayBucketTimeFormatting {
    fun format(
        bucketStart: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(bucketStart) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [XRayBucketChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordXRayBucketChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to XRayBucketChartRegistration.SLUG))
}
