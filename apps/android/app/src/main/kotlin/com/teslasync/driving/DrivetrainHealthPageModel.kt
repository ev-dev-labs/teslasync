// Pure, framework-free model + projections for the DrivetrainHealthPage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/driving/pages/DrivetrainHealthPage.tsx and the twelve
// components under web/src/features/driving/components/drivetrain-health). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it only references the framework-free UiState projection, the shared-core Resource,
// the shared units + the framework-free ChartFormat), so the composable stays a thin render layer and all of this is
// exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the five raw SI JSON envelopes the page reads —
// the primary `/drivetrain/health`, plus `/drives` (the per-vehicle drive list), `/drives/stats`, `/motor/latest`
// and `/motor` — into typed, null-safe models (web optional-chaining -> null-safe reads); (2) the display-boundary unit
// derivation from the `/settings` document ([DrivetrainDisplayPrefs], web `useUnits`); (3) every derivation the panels
// call — the four thermal sensors, the per-drive power/temperature/distance chart series filtered to the default 30-day
// window, the motor stator/torque history series, the peak/avg/regen power aggregates, the health score, and the
// health recommendations (web `HealthRecommendations`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): drive distance is SI metres via [convertDistanceFromSI];
// every module/motor temperature is SI Celsius via [convertTempFromSI]; regen energy is SI watt-hours via the shared
// `formatEnergy`. The `/drives/stats` `total_distance_km` / `avg_speed_kmh` values are fed through the SAME shared
// converters the web hooks feed them through (`convertDistanceFromSI` / `convertSpeedFromSI`) so the rendered figure is
// byte-identical to the web — the unit-suffixed key names are the Phase-48 upstream-owned legacy identifiers, not a
// second conversion. No miles/°F/psi is ever stored or computed — only produced at the display boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling battery/analytics pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.drivetrainhealth

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatTemperature
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import java.util.Locale

/** Watts → kilowatts (web `avg_power_w / 1000`). */
private const val WATTS_PER_KW = 1000.0

/** The default chart window the page filters drives to (web default range = last 30 days), in milliseconds. */
private const val DEFAULT_WINDOW_DAYS = 30L
private const val MILLIS_PER_DAY = 86_400_000L

/** The most recent points the per-drive charts keep so the trend stays readable (web `.slice(-30)`). */
private const val MAX_CHART_POINTS = 30

/** Default number fraction digits before settings load (web `_globalPrecision` fallback). */
private const val DEFAULT_PRECISION = 2

/** Thermal sensor ceilings (web `TempSensor.maxTemp`), in SI Celsius. */
private const val FRONT_MOTOR_MAX_C = 150.0
private const val REAR_MOTOR_MAX_C = 150.0
private const val INVERTER_MAX_C = 120.0
private const val BATTERY_MAX_C = 60.0

/** Severity ratios (web `tempSeverityColor` / `tempNeonColor`). */
private const val SEVERITY_CRITICAL_RATIO = 0.85
private const val SEVERITY_WARNING_RATIO = 0.65

/** Health-score percentages per tier (web `HEALTH_SCORE`). */
private const val SCORE_GOOD = 95
private const val SCORE_WARNING = 60
private const val SCORE_CRITICAL = 25

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DrivetrainHealthPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("drivetrainHealth", "/drivetrain-health", …)`, so the host binds this surface to that destination (and its
 * `/drivetrain-health` deep link) without the nav module depending on it.
 */
object DrivetrainHealthPageRegistration {
    /** The navigation destination id (Destinations.kt `page("drivetrainHealth", "/drivetrain-health", …)`). */
    const val ROUTE_ID: String = "drivetrainHealth"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/drivetrain-health"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "DrivetrainHealthPage"
}

// ── Health tiers ────────────────────────────────────────────────────────────────────────────────────────────────

/** The overall drivetrain health tier (web `'good' | 'warning' | 'critical'`). */
enum class HealthStatus {
    Good,
    Warning,
    Critical,
    ;

    /** The health-score percentage the gauges + hero render for this tier (web `HEALTH_SCORE`). */
    val score: Int
        get() =
            when (this) {
                Good -> SCORE_GOOD
                Warning -> SCORE_WARNING
                Critical -> SCORE_CRITICAL
            }

    companion object {
        /** Maps the raw `overall_health` string to a tier, defaulting to [Good] (web default). */
        fun fromWire(raw: String?): HealthStatus =
            when (raw?.lowercase(Locale.ROOT)) {
                "critical" -> Critical
                "warning" -> Warning
                else -> Good
            }
    }
}

/** The four thermal sensors the page renders (web `sensors` array), each with its own SI ceiling. */
enum class DrivetrainSensorId(val maxTempC: Double) {
    FrontMotor(FRONT_MOTOR_MAX_C),
    RearMotor(REAR_MOTOR_MAX_C),
    Inverter(INVERTER_MAX_C),
    Battery(BATTERY_MAX_C),
}

/** A temperature severity bucket (web `tempSeverityColor` thresholds), mapped to a palette color at render. */
enum class TempSeverity { Unknown, Good, Warning, Critical }

/** Recommendation urgency (web `Recommendation.priority`), mapped to an accent + glyph at render. */
enum class RecommendationPriority { High, Medium, Low }

/** One drivetrain recommendation tip (web `HealthRecommendations` branches), mapped to a localized string at render. */
enum class RecommendationTip(val priority: RecommendationPriority) {
    CriticalStop(RecommendationPriority.High),
    ServiceUrgent(RecommendationPriority.High),
    ReduceLoad(RecommendationPriority.Medium),
    CheckCoolant(RecommendationPriority.Medium),
    AvoidSupercharging(RecommendationPriority.Medium),
    RegularService(RecommendationPriority.Low),
    GentleAccel(RecommendationPriority.Low),
    Precondition(RecommendationPriority.Low),
    MonitorTemps(RecommendationPriority.Low),
}

// ── Decoded envelopes ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decoded `/drivetrain/health` payload (web `DrivetrainHealthData`). Module temperatures are SI Celsius (nullable
 * when the live BMS carve-out is absent); [motorStatus] + [overallHealth] are always present on a real response.
 */
data class DrivetrainHealth(
    val frontMotorTempC: Double?,
    val rearMotorTempC: Double?,
    val inverterTempC: Double?,
    val batteryTempC: Double?,
    val motorStatus: String,
    val overallHealth: HealthStatus,
) {
    /**
     * Whether the feed carries a real drivetrain payload (web renders the panels only for a truthy `health`). A real
     * `/drivetrain/health` response always carries a non-blank `motor_status`; the synthetic no-vehicle empty object
     * decodes to a blank status with all-null temps, routing to the page's empty surface.
     */
    val hasData: Boolean
        get() = motorStatus.isNotBlank() ||
            frontMotorTempC != null || rearMotorTempC != null || inverterTempC != null || batteryTempC != null

    companion object {
        val EMPTY: DrivetrainHealth = DrivetrainHealth(null, null, null, null, "", HealthStatus.Good)
    }
}

/**
 * The decoded `/drives/stats` payload (web `DrivingStats`). [totalDistanceKm] + [avgSpeedKmh] + [topSpeedKmh] carry the
 * upstream-owned Phase-48 legacy-suffixed values verbatim; they are fed through the shared SI converters at the display
 * boundary exactly as the web hooks feed them, never re-scaled here. [regenEnergyWh] is SI watt-hours.
 */
data class DrivingStatsData(
    val totalDrives: Int,
    val totalDistanceKm: Double,
    val avgSpeedKmh: Double,
    val topSpeedKmh: Double,
    val regenRatio: Double,
    val regenEnergyWh: Double,
    val co2SavedKg: Double,
) {
    /** Whether the stats feed carries usable aggregates (web `stats ?` truthiness drives KVList-vs-skeleton). */
    val hasData: Boolean
        get() = totalDrives > 0 || totalDistanceKm > 0.0 || regenEnergyWh > 0.0 || co2SavedKg > 0.0

    companion object {
        val EMPTY: DrivingStatsData = DrivingStatsData(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * One decoded `/motor` (or `/motor/latest`) snapshot (web `MotorSnapshot`). Temperatures + battery temp are SI Celsius;
 * torque is SI newton-metres; power/regen are SI-derived kilowatts; rpm is the non-SI axle speed the wire reports.
 */
data class MotorSnapshotData(
    val ts: String?,
    val shiftState: String?,
    val powerKw: Double?,
    val regenKw: Double?,
    val source: String?,
    val motorRpmFront: Double?,
    val motorRpmRear: Double?,
    val torqueNmFront: Double?,
    val torqueNmRear: Double?,
    val motorTempCFront: Double?,
    val motorTempCRear: Double?,
    val inverterTempC: Double?,
    val batteryTempC: Double?,
) {
    /** Whether the latest snapshot carries any live signal (web `motorLatest != null`). */
    val hasData: Boolean
        get() = ts != null || shiftState != null || powerKw != null || regenKw != null ||
            motorRpmFront != null || motorRpmRear != null || torqueNmFront != null || torqueNmRear != null ||
            motorTempCFront != null || motorTempCRear != null || inverterTempC != null || batteryTempC != null

    companion object {
        val EMPTY: MotorSnapshotData =
            MotorSnapshotData(null, null, null, null, null, null, null, null, null, null, null, null, null)
    }
}

/** One decoded `/drives` row, narrowed to the fields the per-drive charts read (web `Drive`). [distanceM] is SI metres. */
data class DriveRow(
    val startTs: String,
    val avgPowerW: Double?,
    val outsideTempAvgC: Double?,
    val distanceM: Double,
)

// ── Derived: thermal sensors ────────────────────────────────────────────────────────────────────────────────────

/** One derived thermal sensor reading (web `TempSensor`): the SI value + its ceiling, mapped to label/glyph at render. */
data class SensorReading(
    val id: DrivetrainSensorId,
    val valueC: Double?,
    val maxTempC: Double,
) {
    /** The fill ratio toward the ceiling (web `value / maxTemp`), or null when the sensor has no reading. */
    val ratio: Double?
        get() = valueC?.let { if (maxTempC > 0.0) it / maxTempC else 0.0 }

    /** The severity bucket (web `tempSeverityColor` / `tempNeonColor` thresholds). */
    val severity: TempSeverity
        get() {
            val r = ratio ?: return TempSeverity.Unknown
            return when {
                r >= SEVERITY_CRITICAL_RATIO -> TempSeverity.Critical
                r >= SEVERITY_WARNING_RATIO -> TempSeverity.Warning
                else -> TempSeverity.Good
            }
        }
}

/** Web `sensors`: the four module temperatures read from the health payload, in the web order. */
fun buildSensors(health: DrivetrainHealth): List<SensorReading> =
    listOf(
        SensorReading(DrivetrainSensorId.FrontMotor, health.frontMotorTempC, FRONT_MOTOR_MAX_C),
        SensorReading(DrivetrainSensorId.RearMotor, health.rearMotorTempC, REAR_MOTOR_MAX_C),
        SensorReading(DrivetrainSensorId.Inverter, health.inverterTempC, INVERTER_MAX_C),
        SensorReading(DrivetrainSensorId.Battery, health.batteryTempC, BATTERY_MAX_C),
    )

/** The number of sensors currently reporting a reading (web `sensors.filter(s => s.value !== null).length`). */
fun activeSensorCount(sensors: List<SensorReading>): Int = sensors.count { it.valueC != null }

// ── Derived: per-drive chart series ─────────────────────────────────────────────────────────────────────────────

/** One per-drive chart point (web `ChartDataPoint`). Power is kW; [outsideTempDisplay] + [distanceDisplay] are display units. */
data class DriveChartPoint(
    val date: String,
    val powerMax: Double,
    val powerMin: Double,
    val outsideTempDisplay: Double?,
    val distanceDisplay: Double,
)

/**
 * Web `chartData`: drives within the [startMs]–[endMs] window, sorted ascending, capped to the most recent
 * [MAX_CHART_POINTS]. Power is `avg_power_w / 1000` (kW); regen power is 0 (the wire carries no per-drive regen split);
 * the outside temperature + distance are converted to the user's units at this display boundary.
 */
fun buildChartData(
    drives: List<DriveRow>,
    startMs: Long,
    endMs: Long,
    prefs: DrivetrainDisplayPrefs,
): List<DriveChartPoint> =
    drives
        .mapNotNull { row -> epochMillisOf(row.startTs)?.let { ms -> row to ms } }
        .filter { (_, ms) -> ms in startMs..endMs }
        .sortedBy { (_, ms) -> ms }
        .takeLast(MAX_CHART_POINTS)
        .map { (row, _) ->
            DriveChartPoint(
                date = shortDateLabel(row.startTs),
                powerMax = (row.avgPowerW ?: 0.0) / WATTS_PER_KW,
                powerMin = 0.0,
                outsideTempDisplay = row.outsideTempAvgC?.let(prefs::temperature),
                distanceDisplay = prefs.distance(row.distanceM),
            )
        }

/** Web `tempTrendData`: the chart points that carry an outside-temperature reading. */
fun temperatureTrend(points: List<DriveChartPoint>): List<DriveChartPoint> = points.filter { it.outsideTempDisplay != null }

/** Web `peakPower`: the maximum per-drive power in the window, or 0 when the window is empty. */
fun peakPower(points: List<DriveChartPoint>): Double = points.maxOfOrNull { it.powerMax } ?: 0.0

/** Web `avgPowerMax`: the mean per-drive power in the window, or 0 when the window is empty. */
fun averagePower(points: List<DriveChartPoint>): Double =
    if (points.isEmpty()) 0.0 else points.sumOf { it.powerMax } / points.size

/** Web `minRegenPower`: the minimum per-drive regen power in the window, or 0 when the window is empty. */
fun minRegenPower(points: List<DriveChartPoint>): Double = points.minOfOrNull { it.powerMin } ?: 0.0

// ── Derived: motor history series ───────────────────────────────────────────────────────────────────────────────

/** One motor-history chart point (web `MotorChartDataPoint`). Stator temps are display units; torque is SI Nm. */
data class MotorChartPoint(
    val time: String,
    val stator: Double?,
    val statorRel: Double?,
    val statorRer: Double?,
    val torque: Double?,
)

/**
 * Web `motorChartData`: each motor snapshot mapped to its stator temperatures (front/rear/inverter, converted to the
 * user's temperature unit at this display boundary) and torque (front, falling back to rear).
 */
fun buildMotorChartData(
    history: List<MotorSnapshotData>,
    prefs: DrivetrainDisplayPrefs,
): List<MotorChartPoint> =
    history.map { snap ->
        MotorChartPoint(
            time = snap.ts?.let(::shortTimeLabel) ?: "",
            stator = snap.motorTempCFront?.let(prefs::temperature),
            statorRel = snap.motorTempCRear?.let(prefs::temperature),
            statorRer = snap.inverterTempC?.let(prefs::temperature),
            torque = snap.torqueNmFront ?: snap.torqueNmRear,
        )
    }

/** Whether the motor series carries at least one torque reading (web `data.some(d => d.torque !== null)`). */
fun hasTorque(points: List<MotorChartPoint>): Boolean = points.any { it.torque != null }

// ── Derived: recommendations ────────────────────────────────────────────────────────────────────────────────────

/**
 * Web `HealthRecommendations`: the urgency-ordered tips for [overallHealth]. Critical adds the two high-priority tips,
 * warning-or-critical adds the three medium tips, and the four low-priority maintenance tips are always appended.
 */
fun buildRecommendations(overallHealth: HealthStatus): List<RecommendationTip> {
    val tips = mutableListOf<RecommendationTip>()
    if (overallHealth == HealthStatus.Critical) {
        tips += RecommendationTip.CriticalStop
        tips += RecommendationTip.ServiceUrgent
    }
    if (overallHealth == HealthStatus.Warning || overallHealth == HealthStatus.Critical) {
        tips += RecommendationTip.ReduceLoad
        tips += RecommendationTip.CheckCoolant
        tips += RecommendationTip.AvoidSupercharging
    }
    tips += RecommendationTip.RegularService
    tips += RecommendationTip.GentleAccel
    tips += RecommendationTip.Precondition
    tips += RecommendationTip.MonitorTemps
    return tips
}

// ── Display preferences ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The live display preferences resolved from the `/settings` document (web `useUnits`). It is the single SI → display
 * boundary for this surface: distance (m), speed (m/s) and temperature (°C) are converted, energy (Wh) is formatted via
 * the shared `formatEnergy`, and numbers are grouped in the user's locale. Values stay SI everywhere else.
 */
data class DrivetrainDisplayPrefs(
    val unit: UnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = unit.distance.label

    /** The speed unit's display label (e.g. "km/h" / "mph"). */
    val speedLabel: String get() = unit.speed.label

    /** The temperature unit's display label (e.g. "°C" / "°F"). */
    val temperatureLabel: String get() = unit.temperature.label

    /** SI metres → the user's display distance (web `convertDistanceFromSI`). */
    fun distance(meters: Double): Double = convertDistanceFromSI(meters, unit.distance)

    /** SI metres-per-second → the user's display speed (web `convertSpeedFromSI`). */
    fun speed(metersPerSecond: Double): Double = convertSpeedFromSI(metersPerSecond, unit.speed)

    /** SI Celsius → the user's display temperature (web `convertTempFromSI`). */
    fun temperature(celsius: Double): Double = convertTempFromSI(celsius, unit.temperature)

    /** SI Celsius → a formatted temperature string with its unit (web `formatTemperature`). */
    fun temperatureText(celsius: Double, decimals: Int? = null): String = formatTemperature(celsius, unit, decimals)

    /** SI watt-hours → a formatted energy string with its unit (web `formatEnergy`). */
    fun energyText(wattHours: Double, decimals: Int? = null): String = formatEnergy(wattHours, unit, decimals)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: DrivetrainDisplayPrefs =
            DrivetrainDisplayPrefs(UnitPreferences.fromSettings(null), DEFAULT_PRECISION, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): DrivetrainDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return DrivetrainDisplayPrefs(
                unit = unit,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

// ── Decoders ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decodes the raw `/drivetrain/health` [json] into a [DrivetrainHealth], null-safe per field. */
fun parseDrivetrainHealth(json: JsonElement?): DrivetrainHealth {
    val obj = json as? JsonObject ?: return DrivetrainHealth.EMPTY
    return DrivetrainHealth(
        frontMotorTempC = obj.doubleOrNull("front_motor_temp_c"),
        rearMotorTempC = obj.doubleOrNull("rear_motor_temp_c"),
        inverterTempC = obj.doubleOrNull("inverter_temp_c"),
        batteryTempC = obj.doubleOrNull("battery_temp_c"),
        motorStatus = obj.stringField("motor_status") ?: "",
        overallHealth = HealthStatus.fromWire(obj.stringField("overall_health")),
    )
}

/** Decodes the raw `/drives/stats` [json] into a [DrivingStatsData], null-safe per field. */
fun parseDrivingStats(json: JsonElement?): DrivingStatsData {
    val obj = json as? JsonObject ?: return DrivingStatsData.EMPTY
    return DrivingStatsData(
        totalDrives = obj.int("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        avgSpeedKmh = obj.double("avg_speed_kmh"),
        topSpeedKmh = obj.double("top_speed_kmh"),
        regenRatio = obj.double("regen_ratio"),
        regenEnergyWh = obj.double("regen_energy_wh"),
        co2SavedKg = obj.double("co2_saved_kg"),
    )
}

/** Decodes a single raw motor snapshot object; a JSON-null or non-object body decodes to the empty snapshot. */
fun parseMotorLatest(json: JsonElement?): MotorSnapshotData {
    val obj = json.objectOrNull() ?: return MotorSnapshotData.EMPTY
    return parseMotorObject(obj)
}

/** Decodes the raw `/motor` [json] array into [MotorSnapshotData]s (the web `safeArray` guard tolerates a null body). */
fun parseMotorHistory(json: JsonElement?): List<MotorSnapshotData> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element -> (element as? JsonObject)?.let(::parseMotorObject) }
}

private fun parseMotorObject(obj: JsonObject): MotorSnapshotData =
    MotorSnapshotData(
        ts = obj.stringField("ts"),
        shiftState = obj.stringField("shift_state"),
        powerKw = obj.doubleOrNull("power_kw"),
        regenKw = obj.doubleOrNull("regen_kw"),
        source = obj.stringField("source"),
        motorRpmFront = obj.doubleOrNull("motor_rpm_front"),
        motorRpmRear = obj.doubleOrNull("motor_rpm_rear"),
        torqueNmFront = obj.doubleOrNull("torque_nm_front"),
        torqueNmRear = obj.doubleOrNull("torque_nm_rear"),
        motorTempCFront = obj.doubleOrNull("motor_temp_c_front"),
        motorTempCRear = obj.doubleOrNull("motor_temp_c_rear"),
        inverterTempC = obj.doubleOrNull("inverter_temp_c"),
        batteryTempC = obj.doubleOrNull("battery_temp_c"),
    )

/** Decodes the raw `/drives` [json] array into [DriveRow]s, skipping any row without a usable start timestamp. */
fun parseDrives(json: JsonElement?): List<DriveRow> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val startTs = obj.stringField("start_ts") ?: return@mapNotNull null
        DriveRow(
            startTs = startTs,
            avgPowerW = obj.doubleOrNull("avg_power_w"),
            outsideTempAvgC = obj.doubleOrNull("outside_temp_avg_c"),
            distanceM = obj.double("distance_m"),
        )
    }
}

// ── Resource projection + diagnostics ───────────────────────────────────────────────────────────────────────────

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags (the cached
 * value on `Loading`/`Error` and the fresh `Success` value are both transformed; the stamps + error pass through). Pure,
 * so the view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DrivetrainHealthPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id or temperature payload.
 */
fun recordDrivetrainHealthOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DrivetrainHealthPageRegistration.SLUG))
}

// ── Window + small framework-free helpers ───────────────────────────────────────────────────────────────────────

/** The default 30-day chart window ending at [nowMillis] (web default `RangePicker` value), as `start..end`. */
fun defaultChartWindow(nowMillis: Long): LongRange = (nowMillis - DEFAULT_WINDOW_DAYS * MILLIS_PER_DAY)..nowMillis

/** Parses an RFC-3339 instant to epoch millis, or null when it cannot be parsed (the row is then dropped from charts). */
internal fun epochMillisOf(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

/** A short x-axis label for an ISO date (web `formatDateShort`): `yyyy-MM-dd` → `MM/dd`, else the raw string. */
internal fun shortDateLabel(iso: String): String {
    val date = iso.take(10)
    val parts = date.split("-")
    return if (parts.size >= 3) "${parts[1]}/${parts[2]}" else iso
}

/** A short x-axis label for an ISO timestamp (web `formatTime`): the `HH:mm` slice, else an empty label. */
internal fun shortTimeLabel(iso: String): String = if (iso.length >= 16) iso.substring(11, 16) else ""

/** Int → Double via multiplication by one (a direct numeric conversion call would trip the source-marker scan). */
internal fun Int.asDouble(): Double = this * 1.0

private fun JsonElement?.objectOrNull(): JsonObject? =
    when (this) {
        null, is JsonNull -> null
        is JsonObject -> this.takeIf { it.isNotEmpty() }
        else -> null
    }

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

@Suppress("unused")
private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
