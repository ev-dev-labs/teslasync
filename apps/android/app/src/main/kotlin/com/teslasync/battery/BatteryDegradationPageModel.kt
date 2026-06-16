// Pure, framework-free model + projections for the BatteryDegradationPage surface — the native analogue of
// everything the web page derives before composing its panels
// (web/src/features/battery/pages/BatteryDegradationPage.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it only references the framework-light ChartFormat helper, the data-layer
// UnitPreferences, and the shared-core Resource/units), so the composable stays a thin render layer and all of
// this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the null-safe decode of the two raw SI JSON envelopes the
// page reads — `/analytics/battery-health` (web `useBatteryHealthAnalytics`) and `/analytics/battery-degradation`
// (web `useBatteryDegradation`) — into typed models (web optional-chaining → null-safe reads); (2) the
// display-boundary unit derivation from the `/settings` document ([BatteryDisplayPrefs], web `useUnits`); and
// (3) the per-field derivations the panels call (range loss + health-trend projection series, risk/score/stress
// band classification, cycle-depth + fast-charge math, age label parts — web `rangeData`, `projectionChartData`,
// `sohColor`, `scoreVariant`, `riskScoreColor`, `cycleDepthScore`, `fastChargePct`, `ageLabel`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the analytics endpoints report odometer + range in SI
// kilometres and capacity history in SI watt-hours; all distance figures are bridged to the SI base (metres)
// before conversion via the shared [convertDistanceFromSI], and capacity is rendered via the shared
// [formatEnergy] (Wh → the user's energy unit) — exactly as the web `fromKm`/`formatEnergy` do. The estimated
// capacity + SoH + rates are scalar on the wire and rendered verbatim, mirroring the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.degradation

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/** Default number fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance figures floor on before conversion (web `METERS_PER_KM`). */
private const val METERS_PER_KM = 1000.0

/** Decimals for the capacity / degradation-rate figures (web `fmtNumber(value, 1)`). */
const val CAPACITY_DECIMALS = 1

/** SoH thresholds for the gauge color + Excellent/Good/Degraded badge (web `sohColor` / badge ternary). */
private const val SOH_EXCELLENT = 90.0
private const val SOH_GOOD = 80.0

/** Health-factor score thresholds (web `scoreVariant`: ≥80 success, ≥50 warning, else danger). */
private const val SCORE_GOOD = 80.0
private const val SCORE_WARN = 50.0

/** Risk-factor score thresholds (web `riskScoreColor`/`riskBadgeVariant`: ≤25 good, ≤50 warn, else bad). */
private const val RISK_GOOD = 25
private const val RISK_WARN = 50

/** Whole percent + the cycle-depth ceiling (web `Math.max(0, Math.round(100 - avg_depth_of_discharge))`). */
private const val FULL_PERCENT = 100.0

/** The half-up rounding offset (`floor(x + 0.5)` reproduces JS `Math.round` for non-negative input). */
private const val HALF = 0.5

/** The leading `yyyy-MM-dd` slice a non-ISO timestamp is parsed from (web `formatDate` tolerance). */
private const val DATE_PREFIX_LENGTH = 10

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `BatteryDegradationPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("batteryDegradation", "/battery-degradation", …)`, so the host binds this surface to that destination
 * (and its `/battery-degradation` deep link) without the nav module depending on it.
 */
object BatteryDegradationPageRegistration {
    /** The navigation destination id (Destinations.kt `page("batteryDegradation", "/battery-degradation", …)`). */
    const val ROUTE_ID: String = "batteryDegradation"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/battery-degradation"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "BatteryDegradationPage"
}

/* ── Decoded payloads ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One `/analytics/battery-health` history snapshot (web `BatteryHealthSnapshot`). [odometerKm] + [rangeKm] are
 * SI kilometres; [capacityWh] is SI watt-hours; [sohPct] is a 0–100 percentage; [date] is the raw wire timestamp.
 */
data class BatteryHistoryEntry(
    val date: String,
    val odometerKm: Double,
    val sohPct: Double,
    val capacityWh: Double,
    val rangeKm: Double,
)

/**
 * The decoded `/analytics/battery-health` payload the summary, gauge, health-factors + history panels read (web
 * `BatteryHealthAnalytics`). [estimatedCapacityKwh] is kWh, [degradationRateYr] is %/yr, [batteryAgeMonths] is
 * whole months; [currentSoh] is a 0–100 percentage feeding the radial gauge. Missing / JSON-null fields collapse
 * to zero, exactly like the web optional reads.
 */
data class BatteryHealth(
    val currentSoh: Double,
    val estimatedCapacityKwh: Double,
    val degradationRateYr: Double,
    val batteryAgeMonths: Int,
    val totalCycles: Double,
    val avgDepthOfDischarge: Double,
    val fastChargePct: Double,
    val fullChargePct: Double,
    val chargeHabitsScore: Double,
    val tempExposureScore: Double,
    val history: List<BatteryHistoryEntry>,
) {
    /** Whether the analytics feed carries a usable snapshot (web renders content only for a truthy payload). */
    val hasData: Boolean
        get() = currentSoh > 0.0 || estimatedCapacityKwh > 0.0 || totalCycles > 0.0 ||
            batteryAgeMonths > 0 || history.isNotEmpty()

    companion object {
        val EMPTY: BatteryHealth =
            BatteryHealth(0.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/** The degradation prediction block (web `DegradationPrediction`). */
data class DegradationPrediction(
    val hasEnoughData: Boolean,
    val slopePerYear: Double,
    val yearsTo80Pct: Double,
    val predictedDate: String?,
)

/** The charging-habit counts the impact banner reads (web `ChargingHabits`). */
data class ChargingHabits(
    val fastChargeCount: Double,
    val slowChargeCount: Double,
    val deepDischargeCount: Double,
)

/** One predicted-health projection point with its confidence band (web `PredictiveProjection`). */
data class DegradationProjection(
    val date: String,
    val healthPct: Double,
    val confidenceLow: Double,
    val confidenceHigh: Double,
)

/** One scored risk factor (web `RiskFactorData`). [score] is a 0–100 risk score; [name] keys the icon. */
data class RiskFactor(
    val name: String,
    val score: Double,
    val label: String,
    val detail: String,
)

/**
 * The decoded `/analytics/battery-degradation` payload the prediction, trend, risk, recommendations + charging
 * impact panels read (web `DegradationData`). Null-safe per field; absent collections collapse to empty lists.
 */
data class DegradationData(
    val stressLevel: String?,
    val currentCycles: Double,
    val prediction: DegradationPrediction?,
    val chargingHabits: ChargingHabits?,
    val projections: List<DegradationProjection>,
    val riskFactors: List<RiskFactor>,
    val recommendations: List<String>,
) {
    /** Whether the feed carries anything renderable (else each derived section shows its own empty surface). */
    val hasData: Boolean
        get() = prediction != null || projections.isNotEmpty() || riskFactors.isNotEmpty() ||
            recommendations.isNotEmpty() || chargingHabits != null || !stressLevel.isNullOrBlank()

    companion object {
        val EMPTY: DegradationData = DegradationData(null, 0.0, null, null, emptyList(), emptyList(), emptyList())
    }
}

/* ── Classification (pure, JVM-tested) ────────────────────────────────────────────────────────────────────── */

/** The state-of-health band the gauge color + Excellent/Good/Degraded badge resolve from (web `sohColor`). */
enum class SohBand { Excellent, Good, Degraded }

/** Classifies a 0–100 [soh] into its band (web `> 90` / `>= 80` / else). */
fun sohBand(soh: Double): SohBand =
    when {
        soh > SOH_EXCELLENT -> SohBand.Excellent
        soh >= SOH_GOOD -> SohBand.Good
        else -> SohBand.Degraded
    }

/** A three-way good/warning/bad score band (web `scoreVariant` / `riskBadgeVariant` success/warning/danger). */
enum class ScoreBand { Good, Warning, Bad }

/** Classifies a health-factor [score] (web `scoreVariant`: ≥80 good, ≥50 warning, else bad). */
fun scoreBand(score: Double): ScoreBand =
    when {
        score >= SCORE_GOOD -> ScoreBand.Good
        score >= SCORE_WARN -> ScoreBand.Warning
        else -> ScoreBand.Bad
    }

/** Classifies a risk-factor [score] (web `riskBadgeVariant`: ≤25 good, ≤50 warning, else bad). */
fun riskBand(score: Double): ScoreBand =
    when {
        score <= RISK_GOOD -> ScoreBand.Good
        score <= RISK_WARN -> ScoreBand.Warning
        else -> ScoreBand.Bad
    }

/** The charging-stress band driving the impact banner tone + copy (web `stress_level` switch). */
enum class StressBand { Low, Medium, High, Unknown }

/** Classifies the raw backend [level] string (web `=== 'Low'` / `'Medium'` / else). */
fun stressBand(level: String?): StressBand =
    when (level) {
        "Low" -> StressBand.Low
        "Medium" -> StressBand.Medium
        "High" -> StressBand.High
        else -> StressBand.Unknown
    }

/** The five risk-factor icon keys the page maps to a glyph (web `riskFactorIcon` switch). */
enum class RiskIcon { FastCharge, HighSoc, Temperature, CycleCount, DeepDischarge, Generic }

/** Maps a risk factor [name] to its icon key (web `riskFactorIcon`). */
fun riskIcon(name: String): RiskIcon =
    when (name) {
        "fast_charge_ratio" -> RiskIcon.FastCharge
        "high_soc_charging" -> RiskIcon.HighSoc
        "temperature_exposure" -> RiskIcon.Temperature
        "cycle_count_rate" -> RiskIcon.CycleCount
        "deep_discharge_frequency" -> RiskIcon.DeepDischarge
        else -> RiskIcon.Generic
    }

/**
 * Cycle-depth score (web `Math.max(0, Math.round(100 - avg_depth_of_discharge))`). Returns a whole-valued Double
 * via half-up rounding (`floor(x + 0.5)`, matching JS `Math.round` for non-negative input) so the display badge
 * needs no further conversion.
 */
fun cycleDepthScore(avgDepthOfDischarge: Double): Double =
    floor((FULL_PERCENT - avgDepthOfDischarge) + HALF).coerceAtLeast(0.0)

/** Fast-charge share of all charges, rounded to a whole percent (web `fastChargePct`). */
fun fastChargePercent(habits: ChargingHabits?): Int {
    val fast = habits?.fastChargeCount ?: 0.0
    val total = fast + (habits?.slowChargeCount ?: 0.0)
    return if (total > 0.0) ((fast / total) * FULL_PERCENT).roundToInt() else 0
}

/* ── Derived chart series ─────────────────────────────────────────────────────────────────────────────────── */

/** One row of the range-loss area chart: a formatted [label] plus the [original] and [current] display ranges. */
data class RangeLossPoint(
    val label: String,
    val original: Double,
    val current: Double,
)

/**
 * The combined health-trend chart series (web `projectionChartData`): a shared x-axis [labels] list, the [actual]
 * health line over the history range (with the first projection index back-filled so the actual line meets the
 * projection), the [projected] line over the forecast range, and the [confidence] envelope (the upper confidence
 * bound) over the forecast range. A `null` sample is a gap the chart draws across.
 */
data class ProjectionChart(
    val labels: List<String>,
    val actual: List<Double?>,
    val projected: List<Double?>,
    val confidence: List<Double?>,
) {
    val isEmpty: Boolean get() = labels.isEmpty()

    companion object {
        val EMPTY: ProjectionChart = ProjectionChart(emptyList(), emptyList(), emptyList(), emptyList())
    }
}

/* ── Display preferences ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the
 * `/settings` document: the [units] (distance unit + locale + precision feed every figure). The backend serves
 * SI; this is the single place a preference becomes a display unit (Phase-48 SI-canonical; the cache stays SI).
 */
data class BatteryDisplayPrefs(
    val units: UnitPref,
) {
    private val distanceUnit: DistanceUnitPref get() = units.distance

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    private val locale: Locale
        get() = units.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US

    private val precision: Int get() = units.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION

    /** SI km → the user's display distance (web `fromKm`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = ChartFormat.number(value, precision, locale)

    /** Grouped number with an explicit [decimals] override (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** SI watt-hours → the user's energy unit (web `formatEnergy(wh, { precision })`). */
    fun energy(wattHours: Double, decimals: Int): String = formatEnergy(wattHours, units, decimals)

    /** A localized medium date, tolerant of ISO offsets / date-only / non-ISO prefixes (web `formatDate`). */
    fun formatDate(raw: String): String {
        if (raw.isBlank()) return raw
        val parsed =
            runCatching { OffsetDateTime.parse(raw).toLocalDate() }
                .recoverCatching { LocalDate.parse(raw) }
                .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
                .getOrNull() ?: return raw
        return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }

    companion object {
        /** Metric + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: BatteryDisplayPrefs = BatteryDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): BatteryDisplayPrefs =
            BatteryDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/* ── Parse ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Decodes the raw `/analytics/battery-health` [json] into a [BatteryHealth], null-safe per field. */
fun parseBatteryHealth(json: JsonElement?): BatteryHealth {
    val obj = json as? JsonObject ?: return BatteryHealth.EMPTY
    val history =
        (obj["history"] as? JsonArray)?.mapNotNull(::parseHistoryEntry) ?: emptyList()
    return BatteryHealth(
        currentSoh = obj.double("current_soh"),
        estimatedCapacityKwh = obj.double("estimated_capacity"),
        degradationRateYr = obj.double("degradation_rate_yr"),
        batteryAgeMonths = obj.int("battery_age_months"),
        totalCycles = obj.double("total_cycles"),
        avgDepthOfDischarge = obj.double("avg_depth_of_discharge"),
        fastChargePct = obj.double("fast_charge_pct"),
        fullChargePct = obj.double("full_charge_pct"),
        chargeHabitsScore = obj.double("charge_habits_score"),
        tempExposureScore = obj.double("temp_exposure_score"),
        history = history,
    )
}

private fun parseHistoryEntry(element: JsonElement): BatteryHistoryEntry? {
    val obj = element as? JsonObject ?: return null
    val date = obj.stringField("date") ?: return null
    return BatteryHistoryEntry(
        date = date,
        odometerKm = obj.double("odometer"),
        sohPct = obj.double("soh_pct"),
        capacityWh = obj.double("capacity_wh"),
        rangeKm = obj.double("range_km"),
    )
}

/** Decodes the raw `/analytics/battery-degradation` [json] into a [DegradationData], null-safe per field. */
fun parseDegradation(json: JsonElement?): DegradationData {
    val obj = json as? JsonObject ?: return DegradationData.EMPTY
    val prediction =
        (obj["prediction"] as? JsonObject)?.let {
            DegradationPrediction(
                hasEnoughData = it.bool("has_enough_data"),
                slopePerYear = it.double("slope_per_year"),
                yearsTo80Pct = it.double("years_to_80_pct"),
                predictedDate = it.stringField("predicted_date"),
            )
        }
    val habits =
        (obj["charging_habits"] as? JsonObject)?.let {
            ChargingHabits(
                fastChargeCount = it.double("fast_charge_count"),
                slowChargeCount = it.double("slow_charge_count"),
                deepDischargeCount = it.double("deep_discharge_count"),
            )
        }
    val projections =
        (obj["projections"] as? JsonArray)?.mapNotNull(::parseProjection) ?: emptyList()
    val riskFactors =
        (obj["risk_factors"] as? JsonArray)?.mapNotNull(::parseRiskFactor) ?: emptyList()
    val recommendations =
        (obj["recommendations"] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank) }
            ?: emptyList()
    return DegradationData(
        stressLevel = obj.stringField("stress_level"),
        currentCycles = obj.double("current_cycles"),
        prediction = prediction,
        chargingHabits = habits,
        projections = projections,
        riskFactors = riskFactors,
        recommendations = recommendations,
    )
}

private fun parseProjection(element: JsonElement): DegradationProjection? {
    val obj = element as? JsonObject ?: return null
    val date = obj.stringField("date") ?: return null
    return DegradationProjection(
        date = date,
        healthPct = obj.double("health_pct"),
        confidenceLow = obj.double("confidence_low"),
        confidenceHigh = obj.double("confidence_high"),
    )
}

private fun parseRiskFactor(element: JsonElement): RiskFactor? {
    val obj = element as? JsonObject ?: return null
    val name = obj.stringField("name") ?: return null
    return RiskFactor(
        name = name,
        score = obj.double("score"),
        label = obj.stringField("label") ?: name.replace('_', ' '),
        detail = obj.stringField("detail") ?: "",
    )
}

/* ── Projections ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The range-loss area-chart rows (web `rangeData`): the first snapshot's range is the constant `original`
 * baseline, each row's `current` is that snapshot's range. Both are converted to the user's distance unit at the
 * display boundary (SI km → display) so the chart agrees with the table; an empty history yields no rows.
 */
fun rangeLossData(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
): List<RangeLossPoint> {
    val history = health.history
    if (history.isEmpty()) return emptyList()
    val originalRange = prefs.fromKm(history.first().rangeKm)
    return history.map { entry ->
        RangeLossPoint(
            label = prefs.formatDate(entry.date),
            original = originalRange,
            current = prefs.fromKm(entry.rangeKm),
        )
    }
}

/**
 * The combined health-trend + projection series (web `projectionChartData`): the actual SoH over history followed
 * by the forecast projection with its confidence envelope, on one shared x-axis. The first projection index
 * back-fills the actual value so the actual line visually meets the projection (web `proj[0].health = …`).
 */
fun projectionChart(
    health: BatteryHealth,
    degradation: DegradationData,
    prefs: BatteryDisplayPrefs,
): ProjectionChart {
    val history = health.history
    val projections = degradation.projections
    if (history.isEmpty() && projections.isEmpty()) return ProjectionChart.EMPTY

    val capacity = history.size + projections.size
    val labels = ArrayList<String>(capacity)
    val actual = ArrayList<Double?>(capacity)
    val projected = ArrayList<Double?>(capacity)
    val confidence = ArrayList<Double?>(capacity)

    for (entry in history) {
        labels.add(prefs.formatDate(entry.date))
        actual.add(entry.sohPct)
        projected.add(null)
        confidence.add(null)
    }
    val lastActual = history.lastOrNull()?.sohPct
    projections.forEachIndexed { index, point ->
        labels.add(point.date)
        actual.add(if (index == 0) lastActual else null)
        projected.add(point.healthPct)
        confidence.add(point.confidenceHigh)
    }
    return ProjectionChart(labels = labels, actual = actual, projected = projected, confidence = confidence)
}

/** The absolute annualised degradation rate the prediction card shows (web `Math.abs(slope_per_year)`). */
fun absoluteSlope(prediction: DegradationPrediction?): Double = abs(prediction?.slopePerYear ?: 0.0)

/* ── JSON helpers ─────────────────────────────────────────────────────────────────────────────────────────── */

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.bool(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/* ── Diagnostics + Resource mapping ───────────────────────────────────────────────────────────────────────── */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryDegradationPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording
 * [io.teslasync.shared.core.diagnostics.Logger]; the page calls it from its first composition. Carries no vehicle
 * id, SoH, capacity or charging payload.
 */
fun recordBatteryDegradationOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryDegradationPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. Pure, so
 * the view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
