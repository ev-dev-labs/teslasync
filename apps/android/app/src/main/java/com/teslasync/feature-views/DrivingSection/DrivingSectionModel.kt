// Pure, framework-free model + projection for the DrivingSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/DrivingSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// DrivingSection is purely presentational — the web component takes its `metrics` (a `DigestMetrics`) and
// `dailyDistanceData` as props from the weekly-digest page that owns the TanStack query, so this surface
// binds NO data hook of its own (its only web hook is `useTranslation`, mapped here to the i18n catalog).
// As in the sibling DriveHighlightSlide / SummaryStatsRow ports, the cache-then-network lifecycle (loading /
// error / stale / offline) is supplied by the owning page through the shared P1/S8 state-holder layer as a
// [UiState]; the composable renders every state that layer can carry without ever fetching. This pure file
// owns the parts the web render derives from its props: the formatted "Wh/km" / "km" / "min" / "%" metric
// strings, the `Hh Mm` total-driving-time split, the efficiency-change percentage (or em dash) and its trend
// direction, the formatted top-drive fields, and the daily-distance bar points.
//
// CRITICAL parity note: unlike DriveHighlightSlide, the web DrivingSection does NOT call `useUnits` — it reads
// `metrics.avgEfficiency` / `topDrive.distance` / `topDrive.efficiency_wh_km` directly and hard-labels them
// "Wh/km" / "km" (the digest is computed in metric already). This port reproduces that verbatim: no SI →
// display conversion, the unit symbols are literal suffixes exactly as the web template strings write them.
//
// Numeric formatting mirrors the web `fmtNumber` / `fmtInt` helpers (web/src/lib/numberFormat.ts): a
// non-finite input folds to 0 (web `safeNumber`), the value is then rendered with locale grouping and a fixed
// fraction-digit count. `pctChange` is the web helper verbatim (web/.../weekly-digest/helpers.ts). The date is
// the web `formatDate` (a localized medium date, em dash for blank/unparseable input).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DrivingSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingsection

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** Em dash shown wherever a value is absent — the web `'—'` / `formatDate` invalid-input marker. */
internal const val DRIVING_SECTION_EM_DASH: String = "\u2014"

/** Minutes per hour — the web `Math.floor(totalDuration / 60)` / `totalDuration % 60` split. */
private const val MINUTES_PER_HOUR: Double = 60.0

/** Whole percentage — the web `pctChange` multiplier and its zero-previous "+100%" sentinel. */
private const val PERCENT_FULL: Double = 100.0

/** Upper clamp on fraction digits, guarding the format specifier against absurd precision requests. */
private const val MAX_FRACTION_DIGITS: Int = 6

/** Decimal places for the "Wh/km" / "km" metrics — the web `fmtNumber(value, 1)`. */
private const val ONE_DECIMAL: Int = 1

/** Unit suffix the web hard-codes on the efficiency values (`{value} Wh/km`); not an i18n key in the source. */
private const val UNIT_EFFICIENCY: String = "Wh/km"

/** Unit suffix the web hard-codes on the top-drive distance (`{value} km`); not an i18n key in the source. */
private const val UNIT_DISTANCE: String = "km"

/** Unit suffix the web hard-codes on the top-drive duration (`{value} min`); not an i18n key in the source. */
private const val UNIT_DURATION: String = "min"

/**
 * One drive of the week — the native mirror of the subset of the web `Drive` interface the Top-Drive card
 * reads (web/.../weekly-digest/types.ts). snake_case wire names are kept via @SerialName and every field
 * defaults so a partial payload decodes without error (a decoder configured with `ignoreUnknownKeys` ignores
 * the columns this card does not render). Values are already metric, matching the web digest:
 * [distance] is kilometres, [efficiencyWhKm] is Wh/km, [durationMin] is minutes.
 */
@Serializable
data class DrivingTopDrive(
    @SerialName("start_date") val startDate: String = "",
    @SerialName("distance") val distance: Double = 0.0,
    @SerialName("duration_min") val durationMin: Double = 0.0,
    @SerialName("efficiency_wh_km") val efficiencyWhKm: Double = 0.0,
)

/**
 * One bar of the Daily Distance chart — the native mirror of the web `DailyDistanceEntry` (a `{ day,
 * distance }` row). [distance] is kilometres (the web `Daily Distance (km)` axis); [day] is the already-built
 * weekday label the web `XAxis dataKey="day"` plots.
 */
@Serializable
data class DailyDistanceEntry(
    @SerialName("day") val day: String = "",
    @SerialName("distance") val distance: Double = 0.0,
)

/**
 * The subset of the web `DigestMetrics` payload this section renders, plus the `dailyDistanceData` prop the
 * web component receives alongside it (web/.../weekly-digest/types.ts + the `DrivingSection` props). Every
 * field defaults so a still-loading or empty week decodes and projects without error — the [EMPTY] value is
 * the all-defaults week the composable renders for the Empty phase (zeros + the internal empty states),
 * mirroring how the web component renders its body even when the metrics are all zero.
 *
 * @property avgEfficiency the week's mean efficiency in Wh/km (web `metrics.avgEfficiency`).
 * @property prevAvgEfficiency the prior week's mean efficiency, the change baseline (web `prevAvgEfficiency`).
 * @property totalDuration the total drive time in minutes (web `metrics.totalDuration`).
 * @property totalDrives the drive count (web `metrics.totalDrives`).
 * @property topDrive the highlighted best drive, or `null` when the week has none (web `metrics.topDrive`).
 * @property dailyDistanceData the per-day distance bars (web `dailyDistanceData`).
 */
@Serializable
data class DrivingSectionData(
    @SerialName("avg_efficiency") val avgEfficiency: Double = 0.0,
    @SerialName("prev_avg_efficiency") val prevAvgEfficiency: Double = 0.0,
    @SerialName("total_duration") val totalDuration: Double = 0.0,
    @SerialName("total_drives") val totalDrives: Double = 0.0,
    @SerialName("top_drive") val topDrive: DrivingTopDrive? = null,
    @SerialName("daily_distance") val dailyDistanceData: List<DailyDistanceEntry> = emptyList(),
) {
    companion object {
        /** The all-zero, no-drives week — rendered for the Empty phase so the section is never a blank box. */
        val EMPTY: DrivingSectionData = DrivingSectionData()
    }
}

/**
 * The direction of the week-over-week efficiency change — the native analogue of the web icon choice
 * `avgEfficiency <= prevAvgEfficiency ? <TrendingDown class="text-emerald-400" /> : <TrendingUp
 * class="text-red-400" />`. Lower Wh/km is better, so [Improved] (down/emerald) is the "good" direction and
 * [Worsened] (up/red) is the "bad" one; the composable maps each to its glyph + status color.
 */
enum class EfficiencyTrend {
    Improved,
    Worsened,
}

/** One projected Daily Distance bar — the [day] label and its kilometre [distance] value the chart plots. */
data class DailyDistancePoint(
    val day: String,
    val distance: Double,
)

/**
 * The fully projected, render-ready Top-Drive card — the native analogue of the four values the web component
 * formats before returning JSX: the localized [date] (web `formatDate(start_date)`), the [distance] /
 * [efficiency] with their `fmtNumber(_, 1)` + unit suffix, and the [duration] with its `fmtInt` + `min`.
 */
data class TopDriveDisplay(
    val date: String,
    val distance: String,
    val duration: String,
    val efficiency: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property avgEfficiency the formatted "Avg Efficiency" value (web `${fmtNumber(avgEfficiency, 1)} Wh/km`).
 * @property totalDrivingTime the `Hh Mm` total drive time (web `${fmtInt(floor(d/60))}h ${fmtInt(d%60)}m`).
 * @property efficiencyChange the signed percent change, or an em dash when there is no prior-week baseline
 *   (web `prevAvgEfficiency > 0 ? ${fmtNumber(pctChange(...), 1)}% : '—'`).
 * @property efficiencyTrend the change direction driving the trend glyph + color.
 * @property drives the formatted drive count (web `fmtInt(totalDrives)`).
 * @property dailyDistance the Daily Distance bars; empty drives the chart's friendly empty state.
 * @property topDrive the Top-Drive card, or `null` when the week has none (drives that card's empty state).
 */
data class DrivingSectionDisplay(
    val avgEfficiency: String,
    val totalDrivingTime: String,
    val efficiencyChange: String,
    val efficiencyTrend: EfficiencyTrend,
    val drives: String,
    val dailyDistance: List<DailyDistancePoint>,
    val topDrive: TopDriveDisplay?,
) {
    /** True when there is at least one Daily Distance bar (web `dailyDistanceData.length > 0`). */
    val hasDailyDistance: Boolean get() = dailyDistance.isNotEmpty()

    /** The bar chart's x-axis labels (web `XAxis dataKey="day"`). */
    val dayLabels: List<String> get() = dailyDistance.map { it.day }

    /** The bar chart's y values (web `Bar dataKey="distance"`). */
    val distanceValues: List<Double> get() = dailyDistance.map { it.distance }
}

/**
 * Pure projection from a [DrivingSectionData] to its render-ready [DrivingSectionDisplay] — a 1:1 port of the
 * derivations the web component performs (the formatted metric strings, the duration split, the change
 * percentage + trend, the per-day bars, and the formatted top drive) before returning JSX. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate. [locale] feeds the locale-grouped
 * number formatting (web global locale); [zone] resolves zoned top-drive timestamps to a local date.
 */
object DrivingSectionProjection {
    /** Select the render-ready view for [data] in the user's [locale] / [zone]. */
    fun project(
        data: DrivingSectionData,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): DrivingSectionDisplay =
        DrivingSectionDisplay(
            avgEfficiency = "${fmtNumber(data.avgEfficiency, ONE_DECIMAL, locale)} $UNIT_EFFICIENCY",
            totalDrivingTime = totalDrivingTime(data.totalDuration, locale),
            efficiencyChange = efficiencyChange(data.avgEfficiency, data.prevAvgEfficiency, locale),
            efficiencyTrend = efficiencyTrend(data.avgEfficiency, data.prevAvgEfficiency),
            drives = fmtInt(data.totalDrives, locale),
            dailyDistance = data.dailyDistanceData.map { DailyDistancePoint(it.day, safe(it.distance)) },
            topDrive = data.topDrive?.let { projectTopDrive(it, locale, zone) },
        )

    /** Projects the highlighted [drive] into its render-ready card fields (web Top-Drive `<Badge>` row). */
    fun projectTopDrive(
        drive: DrivingTopDrive,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): TopDriveDisplay =
        TopDriveDisplay(
            date = formatDate(drive.startDate, locale, zone),
            distance = "${fmtNumber(drive.distance, ONE_DECIMAL, locale)} $UNIT_DISTANCE",
            duration = "${fmtInt(drive.durationMin, locale)} $UNIT_DURATION",
            efficiency = "${fmtNumber(drive.efficiencyWhKm, ONE_DECIMAL, locale)} $UNIT_EFFICIENCY",
        )

    /**
     * The `Hh Mm` total-driving-time string the web builds from `fmtInt(Math.floor(totalDuration / 60))` and
     * `fmtInt(totalDuration % 60)`. Both segments use the locale-grouped integer formatter, so a multi-day
     * total reads e.g. "1,000h 5m" exactly as the web template does.
     */
    fun totalDrivingTime(
        totalDurationMin: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val total = safe(totalDurationMin)
        val hours = floor(total / MINUTES_PER_HOUR)
        val minutes = total % MINUTES_PER_HOUR
        return "${fmtInt(hours, locale)}h ${fmtInt(minutes, locale)}m"
    }

    /**
     * The "Efficiency Change" value — the web `prevAvgEfficiency > 0 ? ${fmtNumber(pctChange(...), 1)}% :
     * '—'`. A non-positive baseline yields the em dash (there is nothing to compare the week against).
     */
    fun efficiencyChange(
        current: Double,
        previous: Double,
        locale: Locale = Locale.getDefault(),
    ): String =
        if (previous > 0.0) {
            "${fmtNumber(pctChange(current, previous), ONE_DECIMAL, locale)}%"
        } else {
            DRIVING_SECTION_EM_DASH
        }

    /**
     * The trend direction — web `avgEfficiency <= prevAvgEfficiency ? <TrendingDown …emerald> : <TrendingUp
     * …red>`. Lower Wh/km is better, so an equal-or-lower current efficiency is [EfficiencyTrend.Improved].
     */
    fun efficiencyTrend(
        current: Double,
        previous: Double,
    ): EfficiencyTrend = if (current <= previous) EfficiencyTrend.Improved else EfficiencyTrend.Worsened

    /**
     * The percent change the web `pctChange` helper computes verbatim
     * (web/.../weekly-digest/helpers.ts): a zero baseline yields +100% when the current value is positive
     * (else 0), otherwise `((current - previous) / |previous|) * 100`.
     */
    fun pctChange(
        current: Double,
        previous: Double,
    ): Double {
        if (previous == 0.0) return if (current > 0.0) PERCENT_FULL else 0.0
        return ((current - previous) / abs(previous)) * PERCENT_FULL
    }

    /**
     * Locale-grouped fixed-precision formatting — the native mirror of the web `fmtNumber` (a
     * `Number.toLocaleString` with `minimumFractionDigits == maximumFractionDigits == decimals`). A non-finite
     * input folds to 0 first (web `safeNumber`), so a malformed metric renders "0.0" rather than "NaN".
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safeDecimals = decimals.coerceIn(0, MAX_FRACTION_DIGITS)
        return String.format(locale, "%,.${safeDecimals}f", safe(value))
    }

    /** Locale-grouped integer formatting — the web `fmtInt(v)` (`fmtNumber(v, 0)`), rounding half away from 0. */
    fun fmtInt(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = fmtNumber(value, 0, locale)

    /**
     * Tolerant date → localized medium-date formatter — the native analogue of the web `formatDate`
     * (`toLocaleDateString` with `{ year: 'numeric', month: 'short', day: 'numeric' }`, e.g. `Mar 14, 2026`).
     * A blank or unparseable input yields [DRIVING_SECTION_EM_DASH], exactly like the web helper's
     * invalid-date guard. A drive `start_date` is normally a full ISO timestamp, but the decode chain also
     * tolerates a bare `YYYY-MM-DD` (web `new Date(iso)` accepts both).
     */
    fun formatDate(
        raw: String,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val date = parseDate(raw, zone) ?: return DRIVING_SECTION_EM_DASH
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(date)
    }

    // web safeNumber: a non-finite value (NaN / ±Infinity) is treated as 0 before formatting.
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    // Tolerant decode chain: a date-only `YYYY-MM-DD`, then an offset date-time resolved to [zone], then a
    // zoneless local date-time, then an RFC-3339 instant resolved in [zone]. The first that parses wins;
    // none parsing falls through to the em-dash guard. Offset/instant inputs are converted to [zone] so the
    // local calendar day matches the web `toLocaleDateString` (which renders in the browser's local zone).
    private val dateParsers: List<(String, ZoneId) -> LocalDate?> =
        listOf(
            { raw, _ -> tryParseDate { LocalDate.parse(raw) } },
            { raw, zone -> tryParseDate { OffsetDateTime.parse(raw).atZoneSameInstant(zone).toLocalDate() } },
            { raw, _ -> tryParseDate { LocalDateTime.parse(raw).toLocalDate() } },
            { raw, zone -> tryParseDate { Instant.parse(raw).atZone(zone).toLocalDate() } },
        )

    private fun parseDate(
        raw: String,
        zone: ZoneId,
    ): LocalDate? = if (raw.isBlank()) null else dateParsers.firstNotNullOfOrNull { it(raw, zone) }

    private fun tryParseDate(block: () -> LocalDate): LocalDate? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * efficiency, drive count, top-drive date, or distances — so a diagnostics line can never leak a user's
 * driving habits.
 */
object DrivingSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DrivingSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
