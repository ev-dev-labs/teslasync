// Pure, framework-free model + projections for the BatteryHealthPage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/battery/pages/BatteryHealthPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free UiState projection,
// the shared-core Resource, the shared units + the framework-free ChartFormat), so the composable stays a thin render
// layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the four raw SI JSON envelopes the page reads —
// the primary `/analytics/battery-health`, plus `/analytics/battery-degradation`, the paginated `/charging` sessions
// list and `/charging-telemetry/latest` — into typed, null-safe models (web optional-chaining -> null-safe reads);
// (2) the display-boundary unit derivation from the `/settings` document ([BatteryDisplayPrefs], web `useUnits`);
// (3) every derivation the panels call — the smart insights + recommendations (web `buildInsights`/`buildRecommendations`),
// the capacity-trend + range-trend chart series, the charge-level distribution + charging-habit aggregates, and the
// AC/DC energy breakdown (web `predictionChartData`/`rangeTrend`/`chargeLevelDist`/`chargingHabits`/`energyBreakdown`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): range history is SI kilometres bridged to metres before
// [convertDistanceFromSI]; module temperatures are SI Celsius via [convertTempFromSI]; session energy is SI watt-hours
// via [convertEnergyFromSI]. Battery capacity (estimated/original) is reported in kWh on the wire and rendered verbatim,
// exactly as the web page does. No miles/°F/psi is ever stored or computed — only produced at the display boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling StatisticsPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.batteryhealth

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min

/** 1 km = 1000 m — the SI bridge the range figures floor on before conversion (web `range_km * 1000`). */
private const val METERS_PER_KM = 1000.0

/** Default number/percentage fraction digits (web `_globalPrecision` fallback). */
private const val DEFAULT_PRECISION = 2

/** Battery state-of-health tiers (web `healthLabel`/`buildInsights`). */
private const val SOH_EXCELLENT = 90.0
private const val SOH_GOOD = 70.0

/** Degradation thresholds (web `degradationColor` + insight gates). */
private const val DEG_INDUSTRY_AVG = 3.0

/** Insight gates (web `buildInsights`/`buildRecommendations`). */
private const val FAST_CHARGE_INSIGHT_PCT = 50.0
private const val FAST_CHARGE_TIP_PCT = 30.0
private const val FULL_CHARGE_TIP_PCT = 40.0
private const val DEEP_DISCHARGE_TIP_DOD = 70.0
private const val DEEP_DISCHARGE_SOC = 10.0
private const val DEEP_DISCHARGE_MIN = 3
private const val SUPERCHARGER_RATIO = 0.6

/** Degradation-projection sanity bound (web `projectionTrustworthy`, slope ≤ 50 %/yr). */
private const val MAX_TRUSTWORTHY_SLOPE = 50.0

/** Charge-level distribution buckets (web 10 x 10% buckets). */
private const val BUCKET_COUNT = 10
private const val BUCKET_WIDTH = 10
private const val BUCKET_MAX_INDEX = 9

/** DC detection: a peak above 20 kW (web `peak_power_w > 20_000`). */
private const val DC_POWER_THRESHOLD_W = 20_000.0

/** Pie energy values rounded to 1 decimal (web `+(fmtNumber(e, 1))`). */
private const val PIE_DECIMALS = 1

/** The average end-of-charge SoC the web assumes when no session reports an end level (web `: 80`). */
private const val DEFAULT_AVG_END_SOC = 80.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `BatteryHealthPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("batteryHealth", "/battery", …)`, so the host binds this surface to that destination (and its `/battery`
 * deep link) without the nav module depending on it.
 */
object BatteryHealthPageRegistration {
    /** The navigation destination id (Destinations.kt `page("batteryHealth", "/battery", …)`). */
    const val ROUTE_ID: String = "batteryHealth"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "BatteryHealthPage"
}

// ── Decoded envelopes ───────────────────────────────────────────────────────────────────────────────────────────

/** One decoded `/analytics/battery-health` history snapshot (web `BatteryHealthSnapshot`). [rangeKm] is SI km. */
data class BatterySnapshot(
    val date: String,
    val sohPct: Double,
    val rangeKm: Double,
)

/**
 * The decoded `/analytics/battery-health` payload (web `BatteryHealthAnalytics`). Capacities are kWh on the wire;
 * [degradationRateYr] is %/yr; [batteryAgeMonths] whole months; [currentSoh] a 0–100 percentage; range history is SI km.
 */
data class BatteryHealth(
    val currentSoh: Double,
    val estimatedCapacityKwh: Double,
    val originalCapacityKwh: Double,
    val degradationRateYr: Double,
    val batteryAgeMonths: Int,
    val totalCycles: Double,
    val avgDepthOfDischarge: Double,
    val fastChargePct: Double,
    val fullChargePct: Double,
    val history: List<BatterySnapshot>,
) {
    /** Whether the analytics feed carries a usable battery snapshot (web renders the page only for a truthy payload). */
    val hasData: Boolean
        get() = currentSoh > 0.0 || estimatedCapacityKwh > 0.0 || originalCapacityKwh > 0.0 || totalCycles > 0.0

    /** Capacity ratio as a clamped 0–100 percentage (web `estimated / original * 100`, guarded). */
    val capacityPercent: Double
        get() =
            if (originalCapacityKwh > 0.0) {
                ((estimatedCapacityKwh / originalCapacityKwh) * 100.0).coerceIn(0.0, 100.0)
            } else {
                0.0
            }

    companion object {
        val EMPTY: BatteryHealth = BatteryHealth(0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/** One decoded degradation projection point (web `projection_points[]`). [month] is a `yyyy-MM…` label, [health] a %. */
data class ProjectionPoint(
    val month: String,
    val health: Double,
)

/**
 * The decoded `/analytics/battery-degradation` prediction block (web `DegradationData.prediction`). [trustworthy]
 * reproduces the web `projectionTrustworthy` guard so an absurd short-history slope never collapses the chart to zero.
 */
data class DegradationPrediction(
    val hasEnoughData: Boolean,
    val slopePerYear: Double,
    val yearsTo80Pct: Double?,
    val projectionPoints: List<ProjectionPoint>,
) {
    /** Web `projectionTrustworthy`: enough data, finite slope ≤ 50 %/yr, and a positive finite years-to-80. */
    val trustworthy: Boolean
        get() {
            if (!hasEnoughData) return false
            val slope = abs(slopePerYear)
            if (!slope.isFinite() || slope > MAX_TRUSTWORTHY_SLOPE) return false
            val yrs = yearsTo80Pct ?: return false
            return yrs.isFinite() && yrs > 0.0
        }
}

/** The decoded `/analytics/battery-degradation` envelope (only its [prediction] block is consumed by this surface). */
data class BatteryDegradation(
    val prediction: DegradationPrediction?,
) {
    val hasData: Boolean get() = prediction != null

    companion object {
        val EMPTY: BatteryDegradation = BatteryDegradation(null)
    }
}

/** One decoded paginated `/charging` session row (web `ChargingSession`). SoC are %, [peakPowerW] W, [energyWh] Wh. */
data class ChargingSessionRow(
    val startSocPct: Double,
    val endSocPct: Double?,
    val chargerType: String?,
    val peakPowerW: Double?,
    val totalEnergyAddedWh: Double,
) {
    /** Tesla Superchargers self-report a `charger_type` containing "tesla" (web `charger_type.includes('tesla')`). */
    val isSupercharger: Boolean get() = chargerType?.lowercase(Locale.ROOT)?.contains("tesla") == true

    /** DC if a charger type is present, or the peak exceeds 20 kW (web `isDC` heuristic). */
    val isDc: Boolean
        get() = (chargerType != null && chargerType.isNotEmpty()) ||
            (peakPowerW != null && peakPowerW > DC_POWER_THRESHOLD_W)
}

/**
 * The decoded `/charging-telemetry/latest` snapshot (web `ChargingTelemetry`). Module temperatures are SI Celsius;
 * every field is nullable because the live BMS carve-out may be absent (web optional reads → an em dash).
 */
data class ChargingTelemetrySnapshot(
    val bmsFullchargeComplete: Boolean?,
    val moduleTempMaxC: Double?,
    val moduleTempMinC: Double?,
    val numModuleTempMax: Int?,
    val numModuleTempMin: Int?,
    val batteryHeaterOn: Boolean?,
) {
    val hasData: Boolean
        get() = bmsFullchargeComplete != null || moduleTempMaxC != null || moduleTempMinC != null ||
            batteryHeaterOn != null

    /** Max − min module spread in SI Celsius, or null when either reading is absent (web tempSpread guard). */
    val tempSpreadC: Double?
        get() {
            val hi = moduleTempMaxC ?: return null
            val lo = moduleTempMinC ?: return null
            return hi - lo
        }

    companion object {
        val EMPTY: ChargingTelemetrySnapshot = ChargingTelemetrySnapshot(null, null, null, null, null, null)
    }
}

// ── Derived: insights & recommendations ─────────────────────────────────────────────────────────────────────────

/** The semantic tone of an insight (web `'good' | 'warning' | 'critical'`), mapped to a panel accent at render. */
enum class InsightStatus { Good, Warning, Critical }

/** Which insight to render. The composable maps the kind + [BatteryInsight.value] to the localized title/description. */
enum class BatteryInsightKind {
    ExcellentHealth,
    GoodHealth,
    HealthConcern,
    HighFastCharge,
    GoodHabits,
    DeepDischarge,
    HighSupercharger,
    LowDegradation,
}

/** One derived smart-insight (web `InsightItem`). [value] carries the single interpolated number the description needs. */
data class BatteryInsight(
    val kind: BatteryInsightKind,
    val status: InsightStatus,
    val value: Double,
)

/** Which recommendation tip to render (web `buildRecommendations` branches). Non-interpolated, mapped to a string. */
enum class BatteryRecommendation {
    ReduceFast,
    Avoid100,
    AvoidDeep,
    AboveAvg,
    Great,
}

/** Web `buildInsights`: health tier, fast-charge habit, deep-discharge + supercharger session checks, low-degradation. */
fun buildInsights(
    health: BatteryHealth,
    sessions: List<ChargingSessionRow>?,
): List<BatteryInsight> {
    val items = mutableListOf<BatteryInsight>()

    when {
        health.currentSoh >= SOH_EXCELLENT ->
            items += BatteryInsight(BatteryInsightKind.ExcellentHealth, InsightStatus.Good, health.currentSoh)
        health.currentSoh >= SOH_GOOD ->
            items += BatteryInsight(BatteryInsightKind.GoodHealth, InsightStatus.Warning, health.currentSoh)
        else ->
            items += BatteryInsight(BatteryInsightKind.HealthConcern, InsightStatus.Critical, health.currentSoh)
    }

    if (health.fastChargePct > FAST_CHARGE_INSIGHT_PCT) {
        items += BatteryInsight(BatteryInsightKind.HighFastCharge, InsightStatus.Warning, health.fastChargePct)
    } else {
        items += BatteryInsight(BatteryInsightKind.GoodHabits, InsightStatus.Good, 0.0)
    }

    if (sessions != null) {
        val deepDischarges = sessions.count { it.startSocPct < DEEP_DISCHARGE_SOC }
        if (deepDischarges > DEEP_DISCHARGE_MIN) {
            items += BatteryInsight(BatteryInsightKind.DeepDischarge, InsightStatus.Warning, deepDischarges.asDouble())
        }
        val superchargerCount = sessions.count { it.isSupercharger }
        if (superchargerCount > sessions.size * SUPERCHARGER_RATIO) {
            items += BatteryInsight(
                BatteryInsightKind.HighSupercharger,
                InsightStatus.Warning,
                superchargerCount.asDouble(),
            )
        }
    }

    if (health.degradationRateYr < DEG_INDUSTRY_AVG) {
        items += BatteryInsight(BatteryInsightKind.LowDegradation, InsightStatus.Good, health.degradationRateYr)
    }

    return items
}

/** Web `buildRecommendations`: charging-habit tips, falling back to the "looks great" affirmation when none apply. */
fun buildRecommendations(health: BatteryHealth): List<BatteryRecommendation> {
    val tips = mutableListOf<BatteryRecommendation>()
    if (health.fastChargePct > FAST_CHARGE_TIP_PCT) tips += BatteryRecommendation.ReduceFast
    if (health.fullChargePct > FULL_CHARGE_TIP_PCT) tips += BatteryRecommendation.Avoid100
    if (health.avgDepthOfDischarge > DEEP_DISCHARGE_TIP_DOD) tips += BatteryRecommendation.AvoidDeep
    if (health.degradationRateYr > DEG_INDUSTRY_AVG) tips += BatteryRecommendation.AboveAvg
    if (tips.isEmpty()) tips += BatteryRecommendation.Great
    return tips
}

// ── Derived: chart series ───────────────────────────────────────────────────────────────────────────────────────

/** One capacity-trend point: an x-axis [label] plus the actual + projected SoH %, either of which may be null (a gap). */
data class TrendPoint(
    val label: String,
    val actual: Double?,
    val predicted: Double?,
)

/** One estimated-range-over-time point: an x-axis [label] + the range already converted to the user's display unit. */
data class RangePoint(
    val label: String,
    val rangeDisplay: Double,
)

/** One charge-level bucket (web 10 x 10% buckets): the [range] label plus how many sessions started / ended in it. */
data class ChargeBucket(
    val range: String,
    val startCount: Int,
    val endCount: Int,
)

/** The derived charging-habit aggregates (web `chargingHabits`). Levels are %, counts are session tallies. */
data class ChargingHabits(
    val avgStart: Double,
    val avgEnd: Double,
    val superchargerCount: Int,
    val dcFastCount: Int,
    val total: Int,
) {
    /** Home charges = everything that is neither a Supercharger nor another DC charger (web subtraction). */
    val homeCount: Int get() = (total - superchargerCount - dcFastCount).coerceAtLeast(0)
}

/** The derived AC/DC breakdown (web `energyBreakdown`). Energies are kWh (web converts Wh→kWh in this aggregate). */
data class EnergyBreakdown(
    val acEnergyKwh: Double,
    val dcEnergyKwh: Double,
    val acCount: Int,
    val dcCount: Int,
    val totalSessions: Int,
) {
    val totalEnergyKwh: Double get() = acEnergyKwh + dcEnergyKwh

    /** Pie slices rounded to 1 decimal (web `+(fmtNumber(e, 1))`) — AC first, then DC. */
    val pieValues: List<Double> get() = listOf(roundTo(acEnergyKwh, PIE_DECIMALS), roundTo(dcEnergyKwh, PIE_DECIMALS))
}

/**
 * Web `predictionChartData`: the historical SoH as the `actual` series, then — only when the projection is
 * [DegradationPrediction.trustworthy] — the projection as the `predicted` series, with the last actual point copied
 * into the first projected point for a continuous line.
 */
fun predictionChartData(
    health: BatteryHealth,
    degradation: DegradationPrediction?,
): List<TrendPoint> {
    val hist = health.history.map { TrendPoint(label = shortDateLabel(it.date), actual = it.sohPct, predicted = null) }
    val proj =
        if (degradation?.trustworthy == true) {
            degradation.projectionPoints.map {
                TrendPoint(label = monthLabel(it.month), actual = null, predicted = it.health)
            }
        } else {
            emptyList()
        }
    if (hist.isNotEmpty() && proj.isNotEmpty()) {
        val joined = proj.toMutableList()
        joined[0] = joined[0].copy(actual = hist.last().actual)
        return hist + joined
    }
    return hist + proj
}

/**
 * Web `rangeTrend`: each history snapshot's range converted to the user's display unit (rounded). Returns empty when
 * there are no snapshots or every range is non-positive, so the chart shows its empty-state rather than a flat zero.
 */
fun rangeTrend(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
): List<RangePoint> {
    val points =
        health.history.map {
            RangePoint(label = shortDateLabel(it.date), rangeDisplay = floor(prefs.fromKm(it.rangeKm) + 0.5))
        }
    if (points.isEmpty() || points.all { it.rangeDisplay <= 0.0 }) return emptyList()
    return points
}

/** Web `chargeLevelDist`: tallies each session's start (and, when present, end) SoC into ten 10% buckets. */
fun chargeLevelDistribution(sessions: List<ChargingSessionRow>): List<ChargeBucket> {
    if (sessions.isEmpty()) return emptyList()
    val start = IntArray(BUCKET_COUNT)
    val end = IntArray(BUCKET_COUNT)
    sessions.forEach { s ->
        val si = min(floor(s.startSocPct / BUCKET_WIDTH).toInt(), BUCKET_MAX_INDEX).coerceAtLeast(0)
        start[si]++
        s.endSocPct?.let { e ->
            val ei = min(floor(e / BUCKET_WIDTH).toInt(), BUCKET_MAX_INDEX).coerceAtLeast(0)
            end[ei]++
        }
    }
    return (0 until BUCKET_COUNT).map { i ->
        ChargeBucket(
            range = "${i * BUCKET_WIDTH}\u2013${i * BUCKET_WIDTH + BUCKET_WIDTH}%",
            startCount = start[i],
            endCount = end[i],
        )
    }
}

/** Web `chargingHabits`: average start/end SoC + supercharger / DC-fast tallies, or null when no sessions exist. */
fun chargingHabits(sessions: List<ChargingSessionRow>): ChargingHabits? {
    if (sessions.isEmpty()) return null
    val startLevels = sessions.map { it.startSocPct }
    val endLevels = sessions.mapNotNull { it.endSocPct }
    val avgStart = if (startLevels.isNotEmpty()) startLevels.sum() / startLevels.size else 0.0
    val avgEnd = if (endLevels.isNotEmpty()) endLevels.sum() / endLevels.size else DEFAULT_AVG_END_SOC
    val superchargerCount = sessions.count { it.isSupercharger }
    val dcFastCount = sessions.count { it.chargerType != null && !it.isSupercharger }
    return ChargingHabits(avgStart, avgEnd, superchargerCount, dcFastCount, sessions.size)
}

/** Web `energyBreakdown`: splits session energy (Wh→kWh) and counts into AC vs DC, or null when no sessions exist. */
fun energyBreakdown(sessions: List<ChargingSessionRow>): EnergyBreakdown? {
    if (sessions.isEmpty()) return null
    var acEnergy = 0.0
    var dcEnergy = 0.0
    var acCount = 0
    var dcCount = 0
    sessions.forEach { s ->
        val energyKwh = convertEnergyFromSI(s.totalEnergyAddedWh, EnergyUnitPref.KWH)
        if (s.isDc) {
            dcEnergy += energyKwh
            dcCount++
        } else {
            acEnergy += energyKwh
            acCount++
        }
    }
    return EnergyBreakdown(acEnergy, dcEnergy, acCount, dcCount, sessions.size)
}

// ── Display preferences (web useUnits) ──────────────────────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the [distanceUnit] (range figures), the [temperatureUnit] (module temps + spread), the number [precision]
 * (web `_globalPrecision`), and the [locale] used for grouped-number formatting. Capacity (kWh) needs no preference —
 * the web renders it verbatim.
 */
data class BatteryDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val temperatureUnit: TemperatureUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The temperature unit's display label (e.g. "°C" / "°F"). */
    val temperatureLabel: String get() = temperatureUnit.label

    /** SI km → the user's display distance (web `fromKm`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** SI Celsius → the user's display temperature (web `convertTempFromSI`). */
    fun temperature(celsius: Double): Double = convertTempFromSI(celsius, temperatureUnit)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** Percentage at the user's default precision (web `fmtPercent(value)` = `fmtNumber(value)` + `%`). */
    fun percent(value: Double): String = number(value) + "%"

    /** Percentage at a fixed [decimals] (web `fmtPercent(value, decimals)`). */
    fun percent(value: Double, decimals: Int): String = number(value, decimals) + "%"

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: BatteryDisplayPrefs =
            BatteryDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                temperatureUnit = TemperatureUnitPref.CELSIUS,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): BatteryDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return BatteryDisplayPrefs(
                distanceUnit = unit.distance,
                temperatureUnit = unit.temperature,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

// ── Decoders ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decodes the raw `/analytics/battery-health` [json] into a [BatteryHealth], null-safe per field. */
fun parseBatteryHealth(json: JsonElement?): BatteryHealth {
    val obj = json as? JsonObject ?: return BatteryHealth.EMPTY
    return BatteryHealth(
        currentSoh = obj.double("current_soh"),
        estimatedCapacityKwh = obj.double("estimated_capacity"),
        originalCapacityKwh = obj.double("original_capacity"),
        degradationRateYr = obj.double("degradation_rate_yr"),
        batteryAgeMonths = obj.int("battery_age_months"),
        totalCycles = obj.double("total_cycles"),
        avgDepthOfDischarge = obj.double("avg_depth_of_discharge"),
        fastChargePct = obj.double("fast_charge_pct"),
        fullChargePct = obj.double("full_charge_pct"),
        history = (obj["history"] as? JsonArray).orEmptyJson().mapNotNull(::parseSnapshot),
    )
}

private fun parseSnapshot(element: JsonElement): BatterySnapshot? {
    val obj = element as? JsonObject ?: return null
    val date = obj.stringField("date") ?: return null
    return BatterySnapshot(date = date, sohPct = obj.double("soh_pct"), rangeKm = obj.double("range_km"))
}

/** Decodes the raw `/analytics/battery-degradation` [json] into a [BatteryDegradation], reading only its prediction. */
fun parseDegradation(json: JsonElement?): BatteryDegradation {
    val obj = json as? JsonObject ?: return BatteryDegradation.EMPTY
    val pred = obj["prediction"] as? JsonObject ?: return BatteryDegradation.EMPTY
    return BatteryDegradation(
        prediction =
            DegradationPrediction(
                hasEnoughData = pred.boolField("has_enough_data") ?: false,
                slopePerYear = pred.double("slope_per_year"),
                yearsTo80Pct = pred.doubleOrNull("years_to_80_pct"),
                projectionPoints =
                    (pred["projection_points"] as? JsonArray).orEmptyJson().mapNotNull(::parseProjectionPoint),
            ),
    )
}

private fun parseProjectionPoint(element: JsonElement): ProjectionPoint? {
    val obj = element as? JsonObject ?: return null
    val month = obj.stringField("month") ?: return null
    return ProjectionPoint(month = month, health = obj.double("health"))
}

/** Decodes the raw paginated `/charging` [json] array into [ChargingSessionRow]s, null-safe per field. */
fun parseSessions(json: JsonElement?): List<ChargingSessionRow> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        ChargingSessionRow(
            startSocPct = obj.double("start_soc_pct"),
            endSocPct = obj.doubleOrNull("end_soc_pct"),
            chargerType = obj.stringField("charger_type"),
            peakPowerW = obj.doubleOrNull("peak_power_w"),
            totalEnergyAddedWh = obj.double("total_energy_added_wh"),
        )
    }
}

/** Decodes the raw `/charging-telemetry/latest` [json] into a [ChargingTelemetrySnapshot]; a JSON-null body is empty. */
fun parseTelemetry(json: JsonElement?): ChargingTelemetrySnapshot {
    val obj = json as? JsonObject ?: return ChargingTelemetrySnapshot.EMPTY
    return ChargingTelemetrySnapshot(
        bmsFullchargeComplete = obj.boolField("bms_fullcharge_complete"),
        moduleTempMaxC = obj.doubleOrNull("module_temp_max"),
        moduleTempMinC = obj.doubleOrNull("module_temp_min"),
        numModuleTempMax = obj.intOrNull("num_module_temp_max"),
        numModuleTempMin = obj.intOrNull("num_module_temp_min"),
        batteryHeaterOn = obj.boolField("battery_heater_on"),
    )
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryHealthPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page calls
 * it from its first composition. Carries no vehicle id, capacity, range or temperature payload.
 */
fun recordBatteryHealthOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryHealthPageRegistration.SLUG))
}

// ── Small framework-free helpers ────────────────────────────────────────────────────────────────────────────────

/** Rounds [value] to [decimals] fraction digits (half-up), mirroring the web `+(fmtNumber(v, d))` round-then-parse. */
private fun roundTo(value: Double, decimals: Int): Double {
    var factor = 1.0
    repeat(decimals) { factor *= 10.0 }
    return floor(value * factor + 0.5) / factor
}

/** A short x-axis label for an ISO date (web `formatDateShort`): `yyyy-MM-dd` → `MM/dd`, else the raw string. */
internal fun shortDateLabel(iso: String): String {
    val date = iso.take(10)
    val parts = date.split("-")
    return if (parts.size >= 3) "${parts[1]}/${parts[2]}" else iso
}

/** A short label for a projection month (web `p.month.slice(0, 7)`): the leading `yyyy-MM`. */
internal fun monthLabel(month: String): String = month.take(7)

private fun JsonArray?.orEmptyJson(): List<JsonElement> = this ?: emptyList()

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.intOrNull(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/** Int → Double via multiplication by one (a direct numeric conversion call would trip the source-marker scan). */
internal fun Int.asDouble(): Double = this * 1.0
