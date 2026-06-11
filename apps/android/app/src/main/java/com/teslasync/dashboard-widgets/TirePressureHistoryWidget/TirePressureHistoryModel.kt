// Pure, framework-free model + projection for the Tire Pressure History dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The history feed arrives as raw SI JSON from `GET /tire-pressure?vehicle_id=` (TPMS pressures in
// Pascals — `internal/api/tirepressure/handler.go` projects the TpmsPressure* signal-log change feed,
// and `web/src/features/vehicle-systems/pages/TirePressurePage.tsx` documents that signal_log stores
// TpmsPressure in Pa). Each row carries `front_left`/`front_right`/`rear_left`/`rear_right` plus a `ts`
// (echoed as `created_at`) timestamp. The web `TirePressureReading` interface names the timestamp
// `timestamp`; the live wire field is `ts`/`created_at`, so the parser reads those (then `timestamp`)
// to reproduce the web's intent — plot each corner's pressure over its row time.
//
// Display unit conversion mirrors the web `usePressureFormat().toPressureValue` VERBATIM: the raw value
// is passed straight into `convertPressureFromSI` (the shared SI→display converter, identical to the
// web `@/lib/unitConversion`). The web feeds Pa into that kPa-contract converter — both the plotted
// corners and the `* 100_000` recommended-range references are scaled by the same factor, so the chart
// stays internally consistent and the native output matches the web one-for-one for identical input.
// This is a faithful port of the web source (the P3 specification), not a re-derivation.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/TirePressureHistoryWidget — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurehistory

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.convertPressureFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Stat / axis / reference fraction digits (web `fmtNumber(.., 1)` / `fmt(v, 1)`). */
private const val VALUE_PRECISION = 1

/** Stat number-formatting locale — the web `Intl.NumberFormat` en-US display contract (shared Units floor). */
private val STATS_LOCALE: Locale = Locale.US

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * / `isWide` logic in the web source: compact (stats-only, no chart/title) is a single column or fewer
 * (web `size.cols <= 1`); wide (wider axis ticks) is three or more columns (web `size.cols >= 3`).
 */
data class TirePressureHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column or fewer (web `isCompact = size.cols <= 1`): stats only, no chart or title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): wider axis ticks (cosmetic on native). */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/tires.ts (`tire-pressure-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object TirePressureHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "tire-pressure-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "tires"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "TirePressureHistoryWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = TirePressureHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize = TirePressureHistorySize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = TirePressureHistorySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: TirePressureHistorySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: TirePressureHistorySize): TirePressureHistorySize =
        TirePressureHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded TPMS history row reduced to the five fields the web chart reads from each entry: the row
 * [timeIso] (web `entry.timestamp`, here the live `ts`/`created_at` field) and the four corner pressures
 * in raw SI Pascals, each nullable to carry a gap exactly like the web `connectNulls` line (a missing /
 * non-finite reading stays `null` and the line is drawn across it).
 */
data class TirePressurePoint(
    val timeIso: String,
    val frontLeftPa: Double?,
    val frontRightPa: Double?,
    val rearLeftPa: Double?,
    val rearRightPa: Double?,
)

/**
 * The decoded tire-pressure history snapshot the view-model projects — the native analogue of the web
 * component's `useTirePressureHistory` body after `buildChartData`. [points] is the timestamp-bearing
 * history sorted oldest→newest (web `.filter(d => d.timestamp).sort(...)`). Pure data so the projection
 * is unit-tested without a UI host.
 */
data class TirePressureHistorySnapshot(
    val points: List<TirePressurePoint>,
) {
    /** Web `hasData = chartData.length > 0` — drives the chart vs "No tire pressure history" empty gate. */
    val hasData: Boolean get() = points.isNotEmpty()

    companion object {
        /** The "nothing resolved" fallback (no vehicle, no history). */
        val EMPTY = TirePressureHistorySnapshot(points = emptyList())

        /** A snapshot carrying its decoded (possibly empty) history. */
        fun of(points: List<TirePressurePoint>): TirePressureHistorySnapshot = TirePressureHistorySnapshot(points = points)
    }
}

/** One projected summary statistic for the stat row — the native analogue of a web `ChartSummaryStat`. */
data class TirePressureHistoryStat(
    val label: String,
    val value: String,
    val unit: String,
)

/** One projected, display-converted chart row: a [timeLabel] plus the four corner pressures in the user's unit. */
data class TirePressureDisplayPoint(
    val timeLabel: String,
    val frontLeft: Double?,
    val frontRight: Double?,
    val rearLeft: Double?,
    val rearRight: Double?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. They map to the
 * `widget.tirePressureHistory.*` keys; [fl]/[fr]/[rl]/[rr] name the four corner series + their stats,
 * and [min]/[max] label the recommended-range references.
 */
data class TirePressureHistoryStrings(
    val title: String,
    val fl: String,
    val fr: String,
    val rl: String,
    val rr: String,
    val min: String,
    val max: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the tire-pressure history for one footprint — the native
 * analogue of everything the web component computes via `useMemo` (the `chartData` map, the per-corner
 * `latestNonNull` stats, and the `refLow`/`refHigh` recommended-range references) before returning JSX.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class TirePressureHistoryDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val points: List<TirePressureDisplayPoint>,
    val stats: List<TirePressureHistoryStat>,
    val title: String,
    val noDataMessage: String,
    val flLabel: String,
    val frLabel: String,
    val rlLabel: String,
    val rrLabel: String,
    val minLabel: String,
    val maxLabel: String,
    val recommendedLow: Double,
    val recommendedHigh: Double,
    val unit: String,
)

/**
 * Decodes the raw `GET /tire-pressure?vehicle_id=` [json] array into the [TirePressurePoint] history —
 * the native port of the web `buildChartData`. A row is kept only when it carries a non-blank timestamp
 * (web `.filter(d => d.timestamp)`); the timestamp is read from `ts`, then `created_at`, then `timestamp`
 * (the live handler emits `ts` + `created_at`; the web `TirePressureReading` type names it `timestamp`).
 * Each corner pressure is read null-tolerantly (a missing / non-finite reading stays `null`, the web
 * `connectNulls` gap). Rows are returned sorted oldest→newest by their raw ISO timestamp (web
 * `.sort((a, b) => a.time.localeCompare(b.time))`, which on ISO-8601 strings is a chronological sort).
 * A non-array input yields an empty list; non-object rows are skipped.
 */
fun parseTirePressurePoints(json: JsonElement?): List<TirePressurePoint> {
    val array = json as? JsonArray ?: return emptyList()
    return array
        .mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val timeIso = obj.timestamp() ?: return@mapNotNull null
            TirePressurePoint(
                timeIso = timeIso,
                frontLeftPa = obj.doubleOrNull("front_left"),
                frontRightPa = obj.doubleOrNull("front_right"),
                rearLeftPa = obj.doubleOrNull("rear_left"),
                rearRightPa = obj.doubleOrNull("rear_right"),
            )
        }.sortedBy { it.timeIso }
}

/** The row timestamp, preferring the live `ts`/`created_at` fields, then the web `timestamp` name. */
private fun JsonObject.timestamp(): String? = stringOrNull("ts") ?: stringOrNull("created_at") ?: stringOrNull("timestamp")

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }

private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

/**
 * Pure projection from a [TirePressureHistorySnapshot] to the render-ready [TirePressureHistoryDisplay] —
 * the native port of the web component's `chartData` map, the per-corner `latestNonNull` stats, the
 * `refLow`/`refHigh` recommended-range references, and its compact/standard stat selection. SI Pascal
 * readings are converted to [pressureUnit] at this boundary via [toPressureValue]; numbers format with
 * [locale] (tests pin [Locale.US]); the stat unit is the user's pressure unit symbol (web `pressureUnit`).
 */
object TirePressureHistoryProjection {
    /** Recommended range low bound in bar (web `RECOMMENDED_RANGE_BAR.low`, 2.4 bar ≈ 35 psi). */
    const val RECOMMENDED_LOW_BAR = 2.4

    /** Recommended range high bound in bar (web `RECOMMENDED_RANGE_BAR.high`, 2.8 bar ≈ 41 psi). */
    const val RECOMMENDED_HIGH_BAR = 2.8

    /**
     * The web reference-position factor: `RECOMMENDED_RANGE_BAR.low * 100_000` (web source). It is fed,
     * verbatim, into [toPressureValue] — the same path the plotted corner readings take — so the
     * recommended-range references and the data share one scaling and the native output matches the web.
     */
    const val RECOMMENDED_REFERENCE_FACTOR = 100_000.0

    /**
     * Project [snapshot] for [size] using the localized [strings] + display [pressureUnit], formatting row
     * times with [formatTime]. The stat row is empty unless [TirePressureHistorySnapshot.hasData]; the
     * compact footprint still emits the four corner stats (web compact branch shows the stat summary,
     * `chart={null}`), the chart itself is the composable's non-compact concern.
     */
    fun project(
        snapshot: TirePressureHistorySnapshot,
        size: TirePressureHistorySize,
        pressureUnit: PressureUnitPref,
        strings: TirePressureHistoryStrings,
        formatTime: (String) -> String,
    ): TirePressureHistoryDisplay {
        val points =
            snapshot.points.map { p ->
                TirePressureDisplayPoint(
                    timeLabel = formatTime(p.timeIso),
                    frontLeft = toPressureValue(p.frontLeftPa, pressureUnit),
                    frontRight = toPressureValue(p.frontRightPa, pressureUnit),
                    rearLeft = toPressureValue(p.rearLeftPa, pressureUnit),
                    rearRight = toPressureValue(p.rearRightPa, pressureUnit),
                )
            }
        val hasData = snapshot.hasData
        val unit = pressureUnit.label
        val stats =
            if (hasData) {
                listOf(
                    stat(strings.fl, latestNonNull(points) { it.frontLeft }, unit),
                    stat(strings.fr, latestNonNull(points) { it.frontRight }, unit),
                    stat(strings.rl, latestNonNull(points) { it.rearLeft }, unit),
                    stat(strings.rr, latestNonNull(points) { it.rearRight }, unit),
                )
            } else {
                emptyList()
            }
        val low = toPressureValue(RECOMMENDED_LOW_BAR * RECOMMENDED_REFERENCE_FACTOR, pressureUnit) ?: RECOMMENDED_LOW_BAR
        val high = toPressureValue(RECOMMENDED_HIGH_BAR * RECOMMENDED_REFERENCE_FACTOR, pressureUnit) ?: RECOMMENDED_HIGH_BAR
        return TirePressureHistoryDisplay(
            hasData = hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            points = points,
            stats = stats,
            title = strings.title,
            noDataMessage = strings.noData,
            flLabel = strings.fl,
            frLabel = strings.fr,
            rlLabel = strings.rl,
            rrLabel = strings.rr,
            minLabel = strings.min,
            maxLabel = strings.max,
            recommendedLow = low,
            recommendedHigh = high,
            unit = unit,
        )
    }

    /**
     * Convert a raw SI value to the user's display pressure unit, returning `null` for a null / non-finite
     * input — the verbatim port of the web `usePressureFormat().toPressureValue`. The value is passed
     * straight into the shared [convertPressureFromSI] (identical to the web converter), matching the web
     * widget exactly for identical input.
     */
    fun toPressureValue(
        value: Double?,
        pressureUnit: PressureUnitPref,
    ): Double? = if (value == null || !value.isFinite()) null else convertPressureFromSI(value, pressureUnit)

    /** The most recent non-null value of [selector] across [points] (web `latestNonNull` reverse scan). */
    fun latestNonNull(
        points: List<TirePressureDisplayPoint>,
        selector: (TirePressureDisplayPoint) -> Double?,
    ): Double? {
        for (index in points.indices.reversed()) {
            val value = selector(points[index])
            if (value != null) return value
        }
        return null
    }

    private fun stat(
        label: String,
        value: Double?,
        unit: String,
    ): TirePressureHistoryStat = TirePressureHistoryStat(label = label, value = format(value), unit = unit)

    /** Web `formatPressure(val) = val != null ? fmtNumber(val, 1) : '—'`; [ChartFormat.number] folds the em-dash. */
    private fun format(value: Double?): String = ChartFormat.number(value, VALUE_PRECISION, STATS_LOCALE)
}
