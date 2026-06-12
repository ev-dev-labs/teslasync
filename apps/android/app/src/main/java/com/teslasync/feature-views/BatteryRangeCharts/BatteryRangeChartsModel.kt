// Pure, framework-free model + projection for the Battery & Range charts feature view — the native analogue
// of everything the web surface derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (VehicleDetailPage) passes the loaded
// `state: VehicleState` + `drives: Drive[] | undefined`, and the component derives two chart inputs:
//   * `batteryChartData` — the two-bar `[{ Current, battery_level }, { Remaining, 100 - battery_level }]`
//     distribution the web `<BarChart>` plots (this file's [BatteryRangeChartsProjection.batteryBars]),
//   * `driveChartData` — `(drives ?? []).map(d => ({ date: formatDate(d.start_ts),
//     distance: round(convertDistanceFromSI(d.distance_m ?? 0, unit)), duration: round(d.duration_s/60) }))`
//     then `.reverse()` (this file's [BatteryRangeChartsProjection.driveTrend]), gated by the web
//     `driveChartData.length > 0 ? <AreaChart> : <EmptyState>` content/empty boundary ([DriveTrendResult.isEmpty]).
// Sample order is preserved exactly as the web `.reverse()` produces (the feed arrives newest-first; the
// reverse plots oldest→newest left-to-right), so the native plot and the accessible table read in that order.
//
// SI on the wire, display at the boundary: `distanceMeters` / `ratedRangeMeters` stay SI metres exactly as
// the API serves them; the single SI→display conversion is the injected [convertDistance] (the web
// `convertDistanceFromSI` boundary), applied here only to derive the numeric chart values, never stored back.
// `batteryLevelPct` is a dimensionless 0-100 state-of-charge percentage, so it needs no conversion.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryRangeCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryrangecharts

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for a missing / unparseable value — the shared surfaces' `'—'` fallback. */
internal const val BATTERY_RANGE_EM_DASH: String = "\u2014"

/** A full battery (web `max={100}`) and the upper end of the SoC scale used for the "Remaining" bar. */
internal const val BATTERY_FULL_PCT: Double = 100.0

/** Seconds per minute — the web `d.duration_s / 60` minute conversion divisor. */
internal const val SECONDS_PER_MINUTE: Double = 60.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BatteryRangeChartsRegistration {
    /** Stable surface id. */
    const val ID: String = "battery-range-charts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "BatteryRangeCharts"
}

/**
 * The state-of-charge colour band — the native analogue of the web `batteryColor(level)` ternary
 * (web/src/features/vehicles/components/vehicle-detail/helpers.ts): `level > 60 ? GOOD : level > 25 ? WARN
 * : BAD`. The comparisons are STRICTLY greater-than, so the exact threshold values land in the LOWER band
 * (e.g. `60` is a warning, `25` is critical). The composable maps each band onto the per-theme
 * `TeslaTokens.status` palette (P1/S9), whose success/warning/danger values are exactly the web
 * `#10b981` / `#f59e0b` / `#ef4444` hexes — so the [RadialGauge] tint matches the web gauge colour.
 */
enum class BatteryBand {
    Good,
    Warning,
    Critical,
    ;

    companion object {
        /** Web `level > 60`: above this the charge is healthy (green). */
        const val GOOD_THRESHOLD: Double = 60.0

        /** Web `level > 25`: above this (but at or below [GOOD_THRESHOLD]) the charge is a warning (amber). */
        const val WARNING_THRESHOLD: Double = 25.0

        /**
         * Classify a 0-100 [level] into its band. The comparisons are exclusive (`>`), matching the web
         * `batteryColor` ternary, so the exact threshold values land in the lower band.
         */
        fun fromLevel(level: Double): BatteryBand =
            when {
                level > GOOD_THRESHOLD -> Good
                level > WARNING_THRESHOLD -> Warning
                else -> Critical
            }
    }
}

/**
 * The subset of `VehicleState` this surface reads — the native mirror of the two web `state` fields the
 * battery panel renders. SI on the wire: [ratedRangeMeters] is metres exactly as the API serves it (web
 * `state.rated_range`), converted at the display boundary; [batteryLevelPct] is a dimensionless 0-100
 * state-of-charge percentage (web `state.battery_level`).
 *
 * @property batteryLevelPct the 0-100 state of charge (web `state.battery_level`).
 * @property ratedRangeMeters the SI rated range in metres (web `state.rated_range`), formatted at render.
 */
data class VehicleBatteryState(
    val batteryLevelPct: Double,
    val ratedRangeMeters: Double,
)

/**
 * The subset of a `Drive` this surface reads — the native mirror of the three web `Drive` fields the trend
 * chart touches. SI on the wire: [distanceMeters] is metres (web `distance_m`) and [durationSeconds] is
 * seconds (web `duration_s`); [startTs] is the ISO start timestamp (web `start_ts`) the date axis labels.
 *
 * @property startTs the ISO-8601 drive start timestamp (web `d.start_ts`); the x-axis date label source.
 * @property distanceMeters the SI distance travelled in metres (web `d.distance_m`).
 * @property durationSeconds the SI drive duration in seconds (web `d.duration_s`).
 */
data class DriveSample(
    val startTs: String,
    val distanceMeters: Double,
    val durationSeconds: Double,
)

/**
 * The combined payload this surface binds through the shared P1/S8 state-holder layer — the native analogue
 * of the web component's `{ state, drives }` props gathered into one cache-then-network value. [battery]
 * feeds the Battery-Overview panel; [drives] feeds the Drive-Distance-Trend panel (an empty list renders the
 * panel's internal empty state, exactly as the web `driveChartData.length > 0` branch).
 */
data class BatteryRangeData(
    val battery: VehicleBatteryState,
    val drives: List<DriveSample>,
)

/**
 * One projected bar of the battery distribution — the native mirror of a web `batteryChartData` entry
 * (`{ name, value }`). [value] is the SoC percentage the `<Bar>` plots; the localized [BatterySegment]
 * label is resolved at the Compose boundary, so this pure value carries only the segment identity + height.
 */
data class BatteryBar(
    val segment: BatterySegment,
    val value: Double,
)

/** The two battery-distribution segments, in the web `batteryChartData` order (Current, then Remaining). */
enum class BatterySegment { Current, Remaining }

/**
 * One projected point on the drive trend — the native mirror of a web `driveChartData` entry
 * (`{ date, distance, duration }`). Values are already display-ready: [distance] is in the user's distance
 * unit and [durationMinutes] is whole minutes, both rounded exactly as the web `Math.round(...)`.
 *
 * @property date the x-axis date label (web `formatDate(d.start_ts)`).
 * @property distance the display-unit distance, rounded (web `Math.round(convertDistanceFromSI(...))`).
 * @property durationMinutes the duration in whole minutes (web `Math.round(d.duration_s / 60)`).
 */
data class DriveTrendPoint(
    val date: String,
    val distance: Double,
    val durationMinutes: Double,
)

/**
 * The fully projected, render-ready drive-trend inputs — the native analogue of the props the web
 * `<AreaChart>` reads from `driveChartData`. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host: the composable wraps [distanceValues] / [durationValues] into two `ChartSeries`, feeds
 * [xLabels] to the bottom axis, and shows the friendly empty state when [isEmpty] (web `driveChartData
 * .length > 0 ? chart : EmptyState`). [points] preserves the web post-`.reverse()` order for the accessible
 * table.
 */
data class DriveTrendResult(
    val points: List<DriveTrendPoint>,
    val xLabels: List<String>,
    val distanceValues: List<Double>,
    val durationValues: List<Double>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the two `useMemo` blocks the web
 * component derives (`batteryChartData` + `driveChartData`). Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate.
 */
object BatteryRangeChartsProjection {
    /**
     * The two-bar battery distribution — the native mirror of the web `batteryChartData`
     * (`[{ name: 'Current', value: battery_level }, { name: 'Remaining', value: 100 - battery_level }]`).
     * The level is clamped into 0-100 so a malformed reading never yields a negative "Remaining" bar (the
     * web `<YAxis domain={[0, 100]}>` similarly bounds the plot); a valid 0-100 SoC passes through unchanged.
     */
    fun batteryBars(batteryLevelPct: Double): List<BatteryBar> {
        val current = clampPercent(batteryLevelPct)
        return listOf(
            BatteryBar(BatterySegment.Current, current),
            BatteryBar(BatterySegment.Remaining, BATTERY_FULL_PCT - current),
        )
    }

    /**
     * Projects [drives] into the render-ready trend — the native mirror of the web `driveChartData`
     * `useMemo`: each drive maps to `{ date: formatDate(start_ts), distance: round(convert(distance_m)),
     * duration: round(duration_s / 60) }`, then the whole list is reversed (the feed arrives newest-first;
     * the reverse plots oldest→newest left-to-right). Injecting [convertDistance] (the web
     * `convertDistanceFromSI(_, unitPrefs.distance)`) and [formatDate] (the web `formatDate`) keeps the
     * projection locale/unit-deterministic under test. [DriveTrendResult.isEmpty] reproduces the web
     * `driveChartData.length > 0` boundary (no drives ⇒ the empty surface).
     */
    fun driveTrend(
        drives: List<DriveSample>,
        convertDistance: (Double) -> Double,
        formatDate: (String) -> String,
    ): DriveTrendResult {
        val points =
            drives
                .map { drive ->
                    DriveTrendPoint(
                        date = formatDate(drive.startTs),
                        distance = roundHalfUp(convertDistance(drive.distanceMeters)),
                        durationMinutes = roundHalfUp(drive.durationSeconds / SECONDS_PER_MINUTE),
                    )
                }.reversed()
        return DriveTrendResult(
            points = points,
            xLabels = points.map { it.date },
            distanceValues = points.map { it.distance },
            durationValues = points.map { it.durationMinutes },
            isEmpty = points.isEmpty(),
        )
    }

    /** Locale-grouped integer formatting — the native analogue of the web `fmtInt` (e.g. `1,204`). */
    fun fmtInt(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", roundHalfUp(value).toLong())

    /** Clamps a percentage into the 0-100 SoC scale (web `<YAxis domain={[0, 100]}>`). */
    private fun clampPercent(value: Double): Double {
        val safe = if (value.isFinite()) value else 0.0
        return safe.coerceIn(0.0, BATTERY_FULL_PCT)
    }

    /**
     * Rounds half away from zero — the native analogue of the web `Math.round` (round half toward +∞, which
     * for the non-negative distances/durations here is half-up). A non-finite input coerces to `0` (web
     * `safeNumber`) so a sparse field never plots `NaN`.
     */
    private fun roundHalfUp(value: Double): Double = if (value.isFinite()) Math.round(value) + 0.0 else 0.0
}

/**
 * Tolerant ISO timestamp → localized medium-date formatter — the native analogue of the web `formatDate`
 * (web/src/lib/dateFormat.ts: `toLocaleDateString` with `{ year: 'numeric', month: 'short', day: 'numeric' }`,
 * e.g. `Apr 4, 2026`). A blank or unparseable input yields [BATTERY_RANGE_EM_DASH], exactly like the web
 * helper's invalid-date guard. A drive `start_ts` is normally a full ISO timestamp, but the decode chain
 * also tolerates a bare `YYYY-MM-DD` (web `new Date(iso)` accepts both). Pure (JVM-tested); the composable
 * binds the live locale + zone.
 */
object BatteryRangeChartsFormat {
    /** Formats [raw] as a localized medium date, or the em-dash fallback for blank / unparseable input. */
    fun formatDate(
        raw: String,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val date = parseDate(raw, zone) ?: return BATTERY_RANGE_EM_DASH
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(date)
    }

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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryRangeChartsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordBatteryRangeChartsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryRangeChartsRegistration.SLUG))
}
