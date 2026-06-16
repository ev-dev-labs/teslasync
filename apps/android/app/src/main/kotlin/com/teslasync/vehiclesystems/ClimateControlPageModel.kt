// Pure, framework-free model + projections for the ClimateControlPage vehicle-systems surface (P3/A7) — the native
// analogue of everything web/src/features/vehicle-systems/pages/ClimateControlPage.tsx derives before composing its
// panels. No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared
// SI converters + the framework-free ChartFormat number helper + the kotlinx-serialization JSON model), so the
// composable stays a thin render layer and the projections are exercisable off-device by the :android gate.
//
// The web page reads three backend sources — `GET /climate/latest` (the current HVAC snapshot), `GET /climate` (the
// 7-day change history), and `GET /charging-telemetry/latest` (only its `not_enough_power_to_heat` alert flag) — then
// folds them into the HVAC banner, the three temperature gauges, the thirteen climate-status cards, the four
// protection cards, the thermal-comfort indicator, the climate-efficiency stats, the seat-heater grid, the two
// history charts, and the climate-history table. This file ports the snake_case JSON decode ([parseClimateState] /
// [parseClimateHistory] / [parseChargingFlags]) and the verbatim `useMemo` derivations (comfort, efficiency, chart
// projections, table sort).
//
// SI boundary (unit-conversion.instructions): the cabin/outside/target temperatures stay °C on the wire; the only
// display conversion lives in the explicit [ClimateDisplayPrefs] helpers used at the render boundary
// (`convertTempFromSI`), so the SI source is never stored converted (Phase-48 SI-canonical rule; ADR-013 keeps the
// cache SI). Fan speed, seat-heat levels, and the comfort score are unit-less and pass through untouched.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehiclesystems.climatecontrol

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ClimateControlPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("climateControl", "/climate-control", NavGroup.VehicleSystems)`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/climate-control`
 * deep link) without the nav module depending on it.
 */
object ClimateControlPageRegistration {
    /** The navigation destination id (Destinations.kt `page("climateControl", "/climate-control", …)`). */
    const val ROUTE_ID: String = "climateControl"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/climate-control"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "ClimateControlPage"
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** RadialGauge ceiling for the cabin/outside/target temperature gauges, in °C (web `tempGaugeMax`). */
private const val TEMP_GAUGE_MAX_C = 55.0

/** RadialGauge ceiling for the same gauges, in °F (web `tempGaugeMax`). */
private const val TEMP_GAUGE_MAX_F = 131.0

/** The highest discrete seat-heater / steering-wheel level (web `Math.min(level, 3)`). */
const val MAX_HEAT_LEVEL = 3

/** A comfort score at/above this reads "Excellent" / green (web `comfortScore >= 80`). */
private const val COMFORT_EXCELLENT = 80.0

/** A comfort score at/above this reads "Moderate" / amber (web `comfortScore >= 50`). */
private const val COMFORT_MODERATE = 50.0

/** Temperatures within this °C band of target read "Comfortable" / near-target (web `delta <= 1`). */
private const val COMFORT_NEAR_C = 1.0

/** Temperatures within this °C band of target read "Adjusting" (web `delta <= 3`). */
private const val COMFORT_ADJUSTING_C = 3.0

/** A signed delta beyond this °C reads "Too Warm" / "Too Cold" in the status tile (web `tempDelta > 2`). */
private const val DELTA_STATUS_C = 2.0

/* ------------------------------------------------------------------ */
/*  Backend snapshot (GET /climate/latest, GET /climate)              */
/* ------------------------------------------------------------------ */

/**
 * One decoded climate snapshot/history row — the native analogue of the web `ClimateState`. Every figure is the raw
 * backend value on the wire (temperatures °C SI; fan/seat levels unit-less ints; the rest enum strings/booleans);
 * display conversion happens only at the render boundary via [ClimateDisplayPrefs]. All fields are nullable so a
 * sparse forward-folded row never fabricates a zero.
 */
data class ClimateState(
    val id: Long? = null,
    val timestamp: String? = null,
    val insideTemp: Double? = null,
    val outsideTemp: Double? = null,
    val driverTempSetting: Double? = null,
    val passengerTempSetting: Double? = null,
    val hvacPower: String? = null,
    val isAcOn: Boolean? = null,
    val hvacAutoMode: String? = null,
    val fanSpeed: Int? = null,
    val hvacFanStatus: Int? = null,
    val climateKeeperMode: String? = null,
    val defrostMode: String? = null,
    val defrostForPreconditioning: Boolean? = null,
    val rearDefrostEnabled: Boolean? = null,
    val wiperHeatEnabled: Boolean? = null,
    val rearDisplayHvacEnabled: Boolean? = null,
    val batteryHeater: Boolean? = null,
    val overheatProtection: String? = null,
    val cabinOverheatProtectionTempLimit: String? = null,
    val hvacSteeringWheelHeatAuto: Boolean? = null,
    val hvacSteeringWheelHeatLevel: Int? = null,
    val seatHeaterLeft: Int? = null,
    val seatHeaterRight: Int? = null,
    val seatHeaterRearLeft: Int? = null,
    val seatHeaterRearCenter: Int? = null,
    val seatHeaterRearRight: Int? = null,
    val autoSeatClimateLeft: Boolean? = null,
    val autoSeatClimateRight: Boolean? = null,
    val climateSeatCoolingFrontLeft: Int? = null,
    val climateSeatCoolingFrontRight: Int? = null,
    val seatVentEnabled: Boolean? = null,
) {
    /** True when the snapshot carries no renderable field (an empty `/climate/latest` map → the Empty surface). */
    fun isBlank(): Boolean =
        insideTemp == null && outsideTemp == null && driverTempSetting == null && passengerTempSetting == null &&
            hvacPower == null && isAcOn == null && hvacAutoMode == null && fanSpeed == null && hvacFanStatus == null &&
            climateKeeperMode == null && defrostMode == null && defrostForPreconditioning == null &&
            rearDefrostEnabled == null && wiperHeatEnabled == null && rearDisplayHvacEnabled == null &&
            batteryHeater == null && overheatProtection == null && cabinOverheatProtectionTempLimit == null &&
            hvacSteeringWheelHeatAuto == null && hvacSteeringWheelHeatLevel == null && seatHeaterLeft == null &&
            seatHeaterRight == null && seatHeaterRearLeft == null && seatHeaterRearCenter == null &&
            seatHeaterRearRight == null && autoSeatClimateLeft == null && autoSeatClimateRight == null &&
            climateSeatCoolingFrontLeft == null && climateSeatCoolingFrontRight == null && seatVentEnabled == null
}

/** The `not_enough_power_to_heat` alert from `GET /charging-telemetry/latest` (web `chargingLatest`). */
data class ChargingTelemetryFlags(
    val notEnoughPowerToHeat: Boolean = false,
)

/**
 * Decodes the raw `/climate/latest` map (or one `/climate` history row) into a [ClimateState]. A non-object input
 * yields an all-null snapshot (which reads as [ClimateState.isBlank], routing the surface to its empty state). The
 * wire is snake_case (the backend serialises raw `signal.SignalValue` before the frontend's camelCase transform), so
 * the booleans may arrive as JSON booleans, `"true"`/`"false"` strings, or `1`/`0` numbers — all handled by [bool].
 */
fun parseClimateState(json: JsonElement?): ClimateState {
    val obj = json as? JsonObject ?: return ClimateState()
    return ClimateState(
        id = obj.long("id"),
        timestamp = obj.string("timestamp") ?: obj.string("created_at") ?: obj.string("ts"),
        insideTemp = obj.double("inside_temp"),
        outsideTemp = obj.double("outside_temp"),
        driverTempSetting = obj.double("driver_temp_setting"),
        passengerTempSetting = obj.double("passenger_temp_setting"),
        hvacPower = obj.string("hvac_power"),
        isAcOn = obj.bool("is_ac_on"),
        hvacAutoMode = obj.string("hvac_auto_mode"),
        fanSpeed = obj.int("fan_speed"),
        hvacFanStatus = obj.int("hvac_fan_status"),
        climateKeeperMode = obj.string("climate_keeper_mode"),
        defrostMode = obj.string("defrost_mode"),
        defrostForPreconditioning = obj.bool("defrost_for_preconditioning"),
        rearDefrostEnabled = obj.bool("rear_defrost_enabled"),
        wiperHeatEnabled = obj.bool("wiper_heat_enabled"),
        rearDisplayHvacEnabled = obj.bool("rear_display_hvac_enabled"),
        batteryHeater = obj.bool("battery_heater"),
        overheatProtection = obj.string("overheat_protection"),
        cabinOverheatProtectionTempLimit = obj.string("cabin_overheat_protection_temp_limit"),
        hvacSteeringWheelHeatAuto = obj.bool("hvac_steering_wheel_heat_auto"),
        hvacSteeringWheelHeatLevel = obj.int("hvac_steering_wheel_heat_level"),
        seatHeaterLeft = obj.int("seat_heater_left"),
        seatHeaterRight = obj.int("seat_heater_right"),
        seatHeaterRearLeft = obj.int("seat_heater_rear_left"),
        seatHeaterRearCenter = obj.int("seat_heater_rear_center"),
        seatHeaterRearRight = obj.int("seat_heater_rear_right"),
        autoSeatClimateLeft = obj.bool("auto_seat_climate_left"),
        autoSeatClimateRight = obj.bool("auto_seat_climate_right"),
        climateSeatCoolingFrontLeft = obj.int("climate_seat_cooling_front_left"),
        climateSeatCoolingFrontRight = obj.int("climate_seat_cooling_front_right"),
        seatVentEnabled = obj.bool("seat_vent_enabled"),
    )
}

/** Decodes the `/climate` history array (web `useClimateHistory` ▸ `safeArray`); a non-array input yields empty. */
fun parseClimateHistory(json: JsonElement?): List<ClimateState> {
    val arr = json as? JsonArray ?: return emptyList()
    return arr.mapNotNull { element -> (element as? JsonObject)?.let { parseClimateState(it) } }
}

/** Decodes the `not_enough_power_to_heat` flag from `/charging-telemetry/latest` (web `chargingLatest`). */
fun parseChargingFlags(json: JsonElement?): ChargingTelemetryFlags {
    val obj = json as? JsonObject ?: return ChargingTelemetryFlags()
    return ChargingTelemetryFlags(notEnoughPowerToHeat = obj.bool("not_enough_power_to_heat") ?: false)
}

/* ------------------------------------------------------------------ */
/*  Display preferences (useUnits)                                    */
/* ------------------------------------------------------------------ */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the
 * `/settings` document: the temperature unit (gauge/axis/value labels) plus the locale + precision used by the
 * grouped-number formatter. The backend stores and serves SI; this is the single place a preference becomes a
 * display unit so the SI source is never stored converted (Phase-48; ADR-013 keeps the cache SI).
 */
data class ClimateDisplayPrefs(
    val unitPref: UnitPref,
) {
    /** The user's locale for grouped-number formatting (web `_globalLocale`, en-US fallback). */
    val locale: Locale =
        runCatching { Locale.forLanguageTag(unitPref.locale ?: "en-US") }.getOrDefault(Locale.US)

    /** The temperature unit's display label, e.g. "°C" / "°F" (web `tempUnit`). */
    val temperatureLabel: String get() = unitPref.temperature.label

    /** Whether the user reads temperature in Fahrenheit (web `isFahrenheit`). */
    val isFahrenheit: Boolean get() = unitPref.temperature == TemperatureUnitPref.FAHRENHEIT

    /** The RadialGauge ceiling in the user's unit (web `tempGaugeMax`: 131 °F else 55 °C). */
    val tempGaugeMax: Double get() = if (isFahrenheit) TEMP_GAUGE_MAX_F else TEMP_GAUGE_MAX_C

    /** SI °C → the user's display temperature (web `toTemperatureDisplay` / `convertTempFromSI`). */
    fun toTemperatureDisplay(celsius: Double): Double = convertTempFromSI(celsius, unitPref.temperature)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int = 1,
    ): String = ChartFormat.number(value, decimals, locale)

    /** SI °C → the formatted display string with the unit suffix (web ``${fmtNumber(toDisplay(c),1)}${unit}``). */
    fun temperatureDisplay(
        celsius: Double,
        decimals: Int = 1,
    ): String = "${number(toTemperatureDisplay(celsius), decimals)}$temperatureLabel"

    companion object {
        /** Metric + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: ClimateDisplayPrefs = ClimateDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): ClimateDisplayPrefs =
            ClimateDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/* ------------------------------------------------------------------ */
/*  Derived state (the page's useMemo chain)                          */
/* ------------------------------------------------------------------ */

/** The HVAC-on disposition vs the driver's target (web `comfortBadge`): the banner + status-tile badge variant. */
enum class ComfortDisposition { Comfortable, Adjusting, FarFromTarget }

/** The comfort-score band (web `comfortScore >= 80 / >= 50 / else`) — the score tile colour + efficiency card. */
enum class ComfortRating { Excellent, Moderate, Poor }

/** Where the cabin sits vs target for the delta chip (web `Near / Above / Below Target`). */
enum class DeltaTarget { Near, Above, Below }

/** The thermal-status tile disposition (web `tempDelta > 2 / < -2 / else`). */
enum class DeltaStatus { TooWarm, TooCold, Comfortable }

/** The Climate-Keeper mode (web `keeperLabel`); the backend string folded to the four known dispositions. */
enum class KeeperMode { On, DogMode, CampMode, Off }

/** Web `comfortBadge`: |inside − target| ≤ 1 → Comfortable, ≤ 3 → Adjusting, else FarFromTarget (null → 0). */
fun comfortDisposition(
    inside: Double?,
    target: Double?,
): ComfortDisposition {
    val delta = abs((inside ?: 0.0) - (target ?: 0.0))
    return when {
        delta <= COMFORT_NEAR_C -> ComfortDisposition.Comfortable
        delta <= COMFORT_ADJUSTING_C -> ComfortDisposition.Adjusting
        else -> ComfortDisposition.FarFromTarget
    }
}

/** Web `comfortScore`: `max(0, 100 − |inside − target| * 10)`; null when either temperature is absent. */
fun comfortScore(
    inside: Double?,
    target: Double?,
): Double? {
    if (inside == null || target == null) return null
    return (100.0 - abs(inside - target) * 10).coerceAtLeast(0.0)
}

/** The comfort-score band, or null when the score is absent (web `>= 80 / >= 50 / else`). */
fun comfortRating(score: Double?): ComfortRating? =
    when {
        score == null -> null
        score >= COMFORT_EXCELLENT -> ComfortRating.Excellent
        score >= COMFORT_MODERATE -> ComfortRating.Moderate
        else -> ComfortRating.Poor
    }

/** Web `tempDelta`: `round(inside − target, 1dp)`; null when either temperature is absent. */
fun tempDelta(
    inside: Double?,
    target: Double?,
): Double? {
    if (inside == null || target == null) return null
    return (inside - target).round1()
}

/** Web Temp-Delta chip: |delta| ≤ 1 → Near, delta > 0 → Above, else Below (null delta → null). */
fun deltaTarget(delta: Double?): DeltaTarget? =
    when {
        delta == null -> null
        abs(delta) <= COMFORT_NEAR_C -> DeltaTarget.Near
        delta > 0 -> DeltaTarget.Above
        else -> DeltaTarget.Below
    }

/** Web status tile: delta > 2 → TooWarm, delta < −2 → TooCold, else Comfortable (null delta → Comfortable). */
fun deltaStatus(delta: Double?): DeltaStatus =
    when {
        delta != null && delta > DELTA_STATUS_C -> DeltaStatus.TooWarm
        delta != null && delta < -DELTA_STATUS_C -> DeltaStatus.TooCold
        else -> DeltaStatus.Comfortable
    }

/** Web `keeperLabel`: folds the backend mode string to the four known dispositions (default Off). */
fun keeperMode(raw: String?): KeeperMode =
    when (raw) {
        "On" -> KeeperMode.On
        "Dog Mode" -> KeeperMode.DogMode
        "Camp Mode" -> KeeperMode.CampMode
        else -> KeeperMode.Off
    }

/** The clamped discrete heat level `0..3` (web `Math.min(Math.max(level, 0), 3)`). */
fun heatOrdinal(level: Int?): Int = (level ?: 0).coerceIn(0, MAX_HEAT_LEVEL)

/** The clamped discrete seat-cooling level `0..3` (web `coolStyle` rounds then clamps). */
fun coolOrdinal(level: Int?): Int = (level ?: 0).coerceIn(0, MAX_HEAT_LEVEL)

/**
 * The climate-efficiency summary (web `efficiencyStats` useMemo): the average + peak fan speed over rows whose fan
 * ran (`fanSpeed > 0`) and the share of rows with the AC on. Null when no history row has a running fan, surfacing
 * the em-dash fallbacks (web `efficiencyStats ? … : '—'`).
 */
data class ClimateEfficiencyStats(
    val avgFan: Double,
    val peakFan: Double,
    val acOnPct: Double,
)

/** Folds the chronological [history] into the efficiency summary (web `efficiencyStats`). */
fun efficiencyStats(history: List<ClimateState>): ClimateEfficiencyStats? {
    if (history.isEmpty()) return null
    val withFan = history.filter { (it.fanSpeed ?: 0) > 0 }
    if (withFan.isEmpty()) return null
    val speeds = withFan.map { (it.fanSpeed ?: 0) + 0.0 }
    val avgFan = speeds.sum() / speeds.size
    val peakFan = speeds.max()
    val acOnCount = history.count { it.isAcOn == true }
    val acOnPct = (acOnCount + 0.0) / history.size * 100
    return ClimateEfficiencyStats(avgFan = avgFan, peakFan = peakFan, acOnPct = acOnPct)
}

/**
 * The backend returns history newest-first; the charts plot it oldest-first (web `chronoHistory` sorts ascending by
 * timestamp). Rows without a parseable timestamp keep their relative order at the end.
 */
fun chronoHistory(history: List<ClimateState>): List<ClimateState> =
    history.sortedBy { it.timestamp?.let(::epochMillisOrNull) ?: Long.MAX_VALUE }

/* ------------------------------------------------------------------ */
/*  Chart projections (web convertedChartData)                        */
/* ------------------------------------------------------------------ */

/** The temperature-history line series in display units + their shared time labels (web `LineChart`). */
data class TemperatureChartData(
    val xLabels: List<String>,
    val inside: List<Double?>,
    val outside: List<Double?>,
    val driverSet: List<Double?>,
) {
    /** True when at least one series carries a point (else the panel shows its empty state). */
    val hasData: Boolean get() = inside.any { it != null } || outside.any { it != null } || driverSet.any { it != null }
}

/** Projects the chronological [history] into the temperature-history series, converting °C → the user's unit. */
fun temperatureChartData(
    history: List<ClimateState>,
    prefs: ClimateDisplayPrefs,
): TemperatureChartData =
    TemperatureChartData(
        xLabels = history.map { clockLabel(it.timestamp) },
        inside = history.map { row -> row.insideTemp?.let { prefs.toTemperatureDisplay(it) } },
        outside = history.map { row -> row.outsideTemp?.let { prefs.toTemperatureDisplay(it) } },
        driverSet = history.map { row -> row.driverTempSetting?.let { prefs.toTemperatureDisplay(it) } },
    )

/** The AC-on/off step + fan-speed series in one area+line chart (web `AreaChart`), with shared time labels. */
data class AcFanChartData(
    val xLabels: List<String>,
    val acActive: List<Double?>,
    val fanSpeed: List<Double?>,
) {
    /** True when the history carries any row (else the panel shows its empty state). */
    val hasData: Boolean get() = xLabels.isNotEmpty()
}

/** Projects the chronological [history] into the AC-state + fan-speed series (web `acActive` / `fanSpeed`). */
fun acFanChartData(history: List<ClimateState>): AcFanChartData =
    AcFanChartData(
        xLabels = history.map { clockLabel(it.timestamp) },
        acActive = history.map { if (it.isAcOn == true) 1.0 else 0.0 },
        fanSpeed = history.map { row -> row.fanSpeed?.let { it + 0.0 } },
    )

/* ------------------------------------------------------------------ */
/*  History table (web DataTable + useSortToggle)                     */
/* ------------------------------------------------------------------ */

/** The sortable columns of the climate-history table (web `climateAccessor` keys). */
enum class ClimateHistoryColumn { Timestamp, InsideTemp, OutsideTemp, DriverTempSetting, FanSpeed }

/**
 * Sorts the climate [history] by [column] in the given direction (web `useSortToggle` + `climateAccessor`). The
 * timestamp sort keys off epoch millis; the numeric columns key off the raw SI value (display conversion is
 * monotonic, so the order is unit-independent); absent values sort as 0 (web `?? 0`).
 */
fun sortClimateHistory(
    history: List<ClimateState>,
    column: ClimateHistoryColumn,
    ascending: Boolean,
): List<ClimateState> {
    val keyed =
        history.sortedBy { row ->
            when (column) {
                ClimateHistoryColumn.Timestamp -> (row.timestamp?.let(::epochMillisOrNull) ?: 0L) + 0.0
                ClimateHistoryColumn.InsideTemp -> row.insideTemp ?: 0.0
                ClimateHistoryColumn.OutsideTemp -> row.outsideTemp ?: 0.0
                ClimateHistoryColumn.DriverTempSetting -> row.driverTempSetting ?: 0.0
                ClimateHistoryColumn.FanSpeed -> (row.fanSpeed ?: 0) + 0.0
            }
        }
    return if (ascending) keyed else keyed.reversed()
}

/** Maps a [io.teslasync.android.components.ui.DataTable] sort key to its column, or null for an unknown key. */
fun climateHistoryColumnOf(key: String): ClimateHistoryColumn? =
    when (key) {
        "timestamp" -> ClimateHistoryColumn.Timestamp
        "insideTemp" -> ClimateHistoryColumn.InsideTemp
        "outsideTemp" -> ClimateHistoryColumn.OutsideTemp
        "driverTempSetting" -> ClimateHistoryColumn.DriverTempSetting
        "fanSpeed" -> ClimateHistoryColumn.FanSpeed
        else -> null
    }

/* ------------------------------------------------------------------ */
/*  Diagnostics + Resource mapping                                    */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ClimateControlPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, temperature, or HVAC payload.
 */
fun recordClimateControlPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ClimateControlPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags — the same
 * pure projection the sibling A7 pages use to turn a raw `JsonElement` feed into a typed model off the UI thread.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                      */
/* ------------------------------------------------------------------ */

/** Rounds to one fraction digit (web `+fmtNumber(x, 1)`). */
private fun Double.round1(): Double = (this * 10).roundToInt() / 10.0

/** The local `HH:mm` clock label for an ISO-8601 [iso] timestamp (web `formatTime`), or the raw string on failure. */
fun clockLabel(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    val millis = epochMillisOrNull(iso) ?: return iso
    return runCatching {
        CLOCK_FORMATTER.format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()))
    }.getOrDefault(iso)
}

/** Parses an ISO-8601 timestamp to epoch millis, or null when it is not parseable. */
private fun epochMillisOrNull(iso: String): Long? =
    runCatching { Instant.parse(iso).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .getOrNull()

private val CLOCK_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.doubleOrNull?.roundToInt()

private fun JsonObject.long(key: String): Long? = prim(key)?.doubleOrNull?.toLong()

private fun JsonObject.string(key: String): String? =
    prim(key)?.contentOrNull?.takeIf { it.isNotBlank() }

/** Lenient boolean read: a JSON boolean, a `"true"`/`"false"` string, or a non-zero number. Null when absent. */
private fun JsonObject.bool(key: String): Boolean? {
    val p = prim(key) ?: return null
    p.booleanOrNull?.let { return it }
    p.doubleOrNull?.let { return it != 0.0 }
    return when (p.contentOrNull?.lowercase()) {
        "true" -> true
        "false" -> false
        else -> null
    }
}
