// Pure, framework-free model + projection for the Motor History dashboard widget — the native analogue
// of everything the web component computes (the `buildChartData` helper and the `chartData` /
// `latestTorque` / `latestStatorTemp` / `dangerThreshold` / `stats` `useMemo`s) before it returns JSX
// (web/src/features/dashboard/widgets/MotorHistoryWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Stator temperature arrives as SI degrees Celsius and is converted to
// the user's display unit here, at the single render-boundary seam (Phase-48 SI-canonical rule; web
// `convertTempFromSI` + `useUnits`). Torque (Nm) and the g-force overlays (g) are unit-less SI and pass
// through unconverted.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MotorHistoryWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling DrivetrainHealth /
// DriveEfficiencyChart widgets do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorhistory

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Em dash shown for a missing latest reading — the web `'—'` fallback for an absent torque / temp. */
internal const val EM_DASH: String = "\u2014"

/** Danger-zone threshold in SI Celsius (web `DANGER_TEMP_C = 100`); converted to the display unit. */
internal const val DANGER_TEMP_C: Double = 100.0

// Raw `/motor` (MotorSnapshot) document keys read by the widget — snake_case, served verbatim by the Go
// handler (no camelCaseKeys transform in the shared layer), so the native reads match the wire contract.
private const val FIELD_TS = "ts"
private const val FIELD_CREATED_AT = "created_at"
private const val FIELD_DI_TORQUE = "di_torque"
private const val FIELD_DI_STATOR_TEMP = "di_stator_temp"
private const val FIELD_MOTOR_TEMP_C_FRONT = "motor_temp_c_front"
private const val FIELD_LATERAL_ACCEL = "lateral_accel"
private const val FIELD_LONGITUDINAL_ACCEL = "longitudinal_accel"

/** Latest torque / stator-temp figures render as whole numbers (web `fmtNumber(value, 0)`). */
private const val STAT_DECIMALS = 0

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` / `isWide = size.cols >= 3` branches in the web source: a single column
 * drops the title + chart and shows only the latest-value stat pair (web `WidgetChartSummary compact`,
 * `chart={null}`), while three or more columns add the lateral / longitudinal g-force overlays.
 */
data class MotorHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): stats only, no title or chart. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): adds the g-force overlay lines. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 3

        /** Registry default footprint (2×4). */
        val Default: MotorHistorySize = MotorHistorySize(cols = 2, rows = 4)

        /** Registry minimum footprint (2×4). */
        val MinSize: MotorHistorySize = MotorHistorySize(cols = 2, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: MotorHistorySize = MotorHistorySize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: MotorHistorySize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: MotorHistorySize): MotorHistorySize =
            MotorHistorySize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`motor-history`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object MotorHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "motor-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MotorHistoryWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Motor torque and stator temp over time with danger zone highlighting"

    /** Recent-sample cap requested for the chart (web `useMotorHistory(vid, 200)`). */
    const val HISTORY_LIMIT: Int = 200

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: MotorHistorySize get() = MotorHistorySize.Default

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: MotorHistorySize get() = MotorHistorySize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: MotorHistorySize get() = MotorHistorySize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: MotorHistorySize): Boolean = MotorHistorySize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MotorHistorySize): MotorHistorySize = MotorHistorySize.clamp(size)
}

/**
 * The localized stat + series labels the projection folds into its output, resolved from the P1/S10 i18n
 * catalog at the Compose boundary (`stringResource`) and passed in so [MotorHistoryProjection.project]
 * stays pure and JVM-testable. Keys mirror the web `t('widget.motorHistory.*')` calls verbatim
 * (`torque`, `statorTemp`, `lateralG`, `longG`). The title + "No motor history" empty strings are
 * render-only chrome (the projection never needs them) and are resolved directly in the composable.
 */
data class MotorHistoryStrings(
    val torque: String,
    val statorTemp: String,
    val lateralG: String,
    val longG: String,
)

/**
 * One already-formatted summary statistic for the header — the native analogue of a web
 * `ChartSummaryStat`: a [label] over a pre-formatted [value] with its [unit] symbol.
 */
data class MotorStat(
    val label: String,
    val value: String,
    val unit: String,
)

/**
 * One projected, render-ready chart datum — the native analogue of the web `ChartDatum`. [timeIso] is
 * the raw ISO timestamp the points are sorted by (web `a.time.localeCompare(b.time)`); [timeLabel] is
 * the locale-formatted x-axis tick (web `formatTime`). [torqueNm] is front-axle torque in newton-metres
 * and the g-forces are in g — all unit-less SI, passed through unconverted — while [statorTempDisplay]
 * is already converted to the user's temperature unit. A `null` field is a gap the chart connects
 * across (web `connectNulls`).
 */
data class MotorHistoryPoint(
    val timeIso: String,
    val timeLabel: String,
    val torqueNm: Double?,
    val statorTempDisplay: Double?,
    val lateralG: Double?,
    val longitudinalG: Double?,
)

/**
 * The fully projected, render-ready view of one motor-history payload for one footprint — the native
 * analogue of everything the web component computes via `useMemo` (the `chartData` series, the
 * `latestTorque` / `latestStatorTemp` scans, the `dangerThreshold` and the `stats` pair) before
 * returning JSX. Pure data so the projection is unit-tested without a Compose host.
 *
 * @property dangerThresholdDisplay the 100 °C danger threshold converted to the user's unit — the web
 *   `dangerThreshold`. The web paints a `ReferenceArea` band above it; Vico 2.0 has no horizontal-band
 *   decoration (see SURVEY), so the danger zone is surfaced as color highlighting instead.
 * @property latestStatorInDanger whether the most-recent stator reading is at/above the danger
 *   threshold — tints the live Stator stat.
 * @property peakStatorInDanger whether any reading in the window reached the danger zone — tints the
 *   stator series so an entered danger zone stays visible across the whole chart.
 */
data class MotorHistoryDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val points: List<MotorHistoryPoint>,
    val stats: List<MotorStat>,
    val dangerThresholdDisplay: Double,
    val latestStatorInDanger: Boolean,
    val peakStatorInDanger: Boolean,
)

/**
 * The parsed payload backing the widget: the recent [rows] of the `/motor` history response, kept as
 * decoded [JsonObject]s exactly as the shared layer serves them (the repository already coerces the
 * response to a JSON array via `safeArray`). The web reads the same `MotorSnapshot[]`; keeping the rows
 * un-projected here lets the SI→display conversion + sorting live in the pure [MotorHistoryProjection].
 */
data class MotorHistorySnapshot(
    val rows: List<JsonObject>,
) {
    /** True when the response carried at least one row (drives the loading/empty/content fold). */
    val hasRows: Boolean get() = rows.isNotEmpty()

    companion object {
        /** The empty payload (no vehicle / no samples resolved) — drives the empty state. */
        val EMPTY: MotorHistorySnapshot = MotorHistorySnapshot(emptyList())

        /** Decodes a `/motor` history [element] (a JSON array of objects) into a snapshot, tolerating nulls. */
        fun fromJson(element: JsonElement?): MotorHistorySnapshot = MotorHistorySnapshot((element as? JsonArray).orEmptyObjects())

        private fun JsonArray?.orEmptyObjects(): List<JsonObject> = this?.mapNotNull { it as? JsonObject } ?: emptyList()
    }
}

/**
 * Pure projection from a parsed [MotorHistorySnapshot] to the display model — the native port of the
 * `buildChartData` helper and the `chartData` / `latestTorque` / `latestStatorTemp` / `dangerThreshold`
 * / `stats` `useMemo`s in the web source. Stator temperature is converted to the user's unit with the
 * shared [convertTempFromSI] at this boundary; torque and g-forces pass through. Rows missing both
 * timestamps are dropped and the series is sorted oldest→newest (web filter + `localeCompare`). Every
 * label is supplied already-localized.
 */
object MotorHistoryProjection {
    /**
     * Build the sorted chart series from the snapshot [rows] — the native port of web `buildChartData`:
     * keep rows carrying a `ts` or `created_at`, map each field with the web's nullish fallbacks
     * (`di_stator_temp ?? motor_temp_c_front` for the stator), convert the stator reading to [tempUnit],
     * and sort ascending by the raw ISO time. [formatTime] renders each tick label at the caller's
     * locale.
     */
    fun buildPoints(
        rows: List<JsonObject>,
        tempUnit: TemperatureUnitPref,
        formatTime: (String) -> String,
    ): List<MotorHistoryPoint> =
        rows
            .mapNotNull { row -> row.toPointOrNull(tempUnit, formatTime) }
            .sortedBy { it.timeIso }

    /**
     * Project [snapshot] for [size] using the user's [tempUnit] (the temperature display unit + symbol),
     * the localized [strings] for the stat labels, the [formatTime] boundary for the x-axis ticks, and
     * [locale] for number grouping. Computes the latest non-null torque + stator readings (web's reverse
     * scans), the converted danger threshold and the in-danger flags, and the Torque / Stator stat pair
     * (only when there is data, web `hasData ? [...] : []`).
     */
    @Suppress("LongParameterList")
    fun project(
        snapshot: MotorHistorySnapshot,
        size: MotorHistorySize,
        tempUnit: TemperatureUnitPref,
        strings: MotorHistoryStrings,
        formatTime: (String) -> String,
        locale: Locale = Locale.getDefault(),
    ): MotorHistoryDisplay {
        val points = buildPoints(snapshot.rows, tempUnit, formatTime)
        val hasData = points.isNotEmpty()
        val latestTorque = points.lastNotNullOf { it.torqueNm }
        val latestStator = points.lastNotNullOf { it.statorTempDisplay }
        val danger = convertTempFromSI(DANGER_TEMP_C, tempUnit)
        val tempUnitLabel = tempUnit.label

        return MotorHistoryDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = hasData,
            points = points,
            stats = if (hasData) statPair(latestTorque, latestStator, strings, tempUnitLabel, locale) else emptyList(),
            dangerThresholdDisplay = danger,
            latestStatorInDanger = latestStator != null && latestStator >= danger,
            peakStatorInDanger = points.any { it.statorTempDisplay != null && it.statorTempDisplay >= danger },
        )
    }

    private fun statPair(
        latestTorque: Double?,
        latestStator: Double?,
        strings: MotorHistoryStrings,
        tempUnitLabel: String,
        locale: Locale,
    ): List<MotorStat> =
        listOf(
            MotorStat(strings.torque, formatStat(latestTorque, locale), UNIT_TORQUE),
            MotorStat(strings.statorTemp, formatStat(latestStator, locale), tempUnitLabel),
        )

    /** Whole-number stat formatting (web `fmtNumber(value, 0)`); a missing value renders as [EM_DASH]. */
    private fun formatStat(
        value: Double?,
        locale: Locale,
    ): String = if (value == null) EM_DASH else ChartFormat.number(value, STAT_DECIMALS, locale)

    private fun JsonObject.toPointOrNull(
        tempUnit: TemperatureUnitPref,
        formatTime: (String) -> String,
    ): MotorHistoryPoint? {
        // web filter `d.ts || d.created_at`: a row needs a non-blank timestamp on either field.
        val ts = stringField(FIELD_TS)
        val createdAt = stringField(FIELD_CREATED_AT)
        if (ts.isNullOrBlank() && createdAt.isNullOrBlank()) return null
        val statorRaw = doubleField(FIELD_DI_STATOR_TEMP) ?: doubleField(FIELD_MOTOR_TEMP_C_FRONT)
        val time = ts ?: createdAt ?: "" // web `time: d.ts ?? d.created_at ?? ''`
        return MotorHistoryPoint(
            timeIso = time,
            timeLabel = formatTime(time),
            torqueNm = doubleField(FIELD_DI_TORQUE),
            statorTempDisplay = statorRaw?.let { convertTempFromSI(it, tempUnit) },
            lateralG = doubleField(FIELD_LATERAL_ACCEL),
            longitudinalG = doubleField(FIELD_LONGITUDINAL_ACCEL),
        )
    }

    /** The last non-null result of [selector] over the series — the web reverse-scan for a latest value. */
    private inline fun List<MotorHistoryPoint>.lastNotNullOf(selector: (MotorHistoryPoint) -> Double?): Double? {
        for (i in indices.reversed()) {
            selector(this[i])?.let { return it }
        }
        return null
    }

    /** Torque is reported in newton-metres (web `'Nm'`); a unit symbol, not a translated string. */
    private const val UNIT_TORQUE = "Nm"
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
