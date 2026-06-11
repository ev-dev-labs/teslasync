// Pure, framework-free model + projection for the Sentry Mode Activity chart feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/SentryModeChart.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (the security-access page) builds the
// `SentryDayBucket[]` via `buildSentryBuckets(history)` and passes it down. This file owns the parts the web
// render derives from that prop: the two stacked bar series (`sentryOn` / `sentryOff`), the X-axis day
// labels (web `<XAxis dataKey="date" tickFormatter={formatDateShort} />`), and the integer count formatting
// (web `<YAxis allowDecimals={false} />`). The bucket order is preserved exactly as received (the web helper
// already sorts ascending by date and the chart maps in array order), so the native categorical bar chart
// reads left-to-right in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SentryModeChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sentrymodechart

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown when a bucket date is missing or unparseable — the web `formatDateShort` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SentryModeChartRegistration {
    /** Stable surface id. */
    const val ID: String = "sentry-mode-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SentryModeChart"
}

/**
 * One day's Sentry Mode activity tally — the native mirror of the web `SentryDayBucket`
 * (`{ date: string; sentryOn: number; sentryOff: number }`). [date] is the `YYYY-MM-DD` day key,
 * [sentryOn] the count of armed observations that day and [sentryOff] the count of disarmed ones
 * (both non-negative integers, so `Long`).
 */
data class SentryDayBucket(
    val date: String,
    val sentryOn: Long,
    val sentryOff: Long,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the three
 * `admin.security.*` keys the web component resolves via `t(...)`: the panel [title] and the two series
 * legend labels ([sentryOnLabel] / [sentryOffLabel]). The lifecycle-chrome strings (empty / error / retry /
 * offline / freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin
 * content carrier.
 */
data class SentryModeChartStrings(
    val title: String,
    val sentryOnLabel: String,
    val sentryOffLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the props the web `<BarChart>`
 * reads from `sentryBuckets`. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host: the composable wraps [sentryOnValues] / [sentryOffValues] into two `ChartSeries`, feeds [xLabels] to
 * the bar chart's bottom axis, and shows the empty state when [isEmpty].
 */
data class SentryModeChartProjectionResult(
    val xLabels: List<String>,
    val sentryOnValues: List<Double>,
    val sentryOffValues: List<Double>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart data mapping.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SentryModeChartProjection {
    /**
     * Projects the loaded [buckets] into render-ready chart inputs, preserving the received order. Each
     * bucket contributes one X-axis label ([formatDate] of its `date`), one `sentryOn` bar value and one
     * `sentryOff` bar value. Injecting the date formatter keeps this function locale/zone-deterministic for
     * tests (the composable supplies the real localized formatter).
     */
    fun project(
        buckets: List<SentryDayBucket>,
        formatDate: (date: String) -> String,
    ): SentryModeChartProjectionResult =
        SentryModeChartProjectionResult(
            xLabels = buckets.map { formatDate(it.date) },
            // `+ 0.0` widens each Long count to the chart series' Double value type.
            sentryOnValues = buckets.map { it.sentryOn + 0.0 },
            sentryOffValues = buckets.map { it.sentryOff + 0.0 },
            isEmpty = buckets.isEmpty(),
        )

    /** Locale-grouped integer formatting for the Y axis — the web `<YAxis allowDecimals={false} />`. */
    fun formatCount(
        count: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", count)
}

/**
 * Tolerant date → localized "short month + day" formatter — the native analogue of the web `formatDateShort`
 * (`toLocaleDateString` with `{ month: 'short', day: 'numeric' }`, e.g. `Apr 4`). Pure (java.time only) so it
 * is unit-tested deterministically with a fixed zone/locale. A blank or unparseable input yields [EM_DASH],
 * exactly like the web helper's invalid-date guard. The bucket key is normally a date-only `YYYY-MM-DD`, but
 * the decode chain also tolerates a full ISO date-time (web `new Date(iso)` accepts both).
 */
object SentryDateFormatting {
    private const val MONTH_DAY_PATTERN = "MMM d"

    fun format(
        date: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val localDate = parseDate(date, zone) ?: return EM_DASH
        return DateTimeFormatter.ofPattern(MONTH_DAY_PATTERN, locale).format(localDate)
    }

    // Tolerant decode chain: a date-only `YYYY-MM-DD`, then an offset date-time, then a zoneless local
    // date-time, then an RFC-3339 instant resolved in [zone]. The first that parses wins; none parsing
    // yields the em-dash guard above.
    private val parsers: List<(String, ZoneId) -> LocalDate?> =
        listOf(
            { raw, _ -> tryParse { LocalDate.parse(raw) } },
            { raw, _ -> tryParse { OffsetDateTime.parse(raw).toLocalDate() } },
            { raw, _ -> tryParse { LocalDateTime.parse(raw).toLocalDate() } },
            { raw, zone -> tryParse { Instant.parse(raw).atZone(zone).toLocalDate() } },
        )

    private fun parseDate(
        raw: String,
        zone: ZoneId,
    ): LocalDate? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw, zone) }

    private fun tryParse(block: () -> LocalDate): LocalDate? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Empty-state glyph mirroring the web `<Activity />` (lucide) icon, drawn as a 24×24 stroked
 * [ImageVector] in the shared monochrome style so it recolors via the `Icon` tint. Kept local to this
 * surface (the mandated allowed-files path) rather than expanding the shared icon set from a feature prompt.
 * The path is the lucide `activity` heartbeat polyline (`M22 12h-4l-3 9L9 3l-3 9H2`).
 */
val SentryActivityGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "SentryActivity",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(22f, 12f)
                horizontalLineToRelative(-4f)
                lineToRelative(-3f, 9f)
                lineTo(9f, 3f)
                lineToRelative(-3f, 9f)
                horizontalLineTo(2f)
            }
        }.build()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SentryModeChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordSentryModeChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SentryModeChartRegistration.SLUG))
}
