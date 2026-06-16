// Pure, framework-free model + projections for the ProjectedRangePage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/battery/pages/ProjectedRangePage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin, so the composable stays a thin render layer and all of
// this logic is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the single SI JSON envelope the page reads — the
// `/analytics/range-projection` document — into typed, null-safe models (web optional-chaining -> null-safe reads);
// (2) the deterministic "what-if" Wh/km interpolation over the personal efficiency matrix (web `interpolateRange`);
// (3) the small derivations every panel calls — the efficiency heat tier (web `effColor`), the scenario glyph kind
// (web `scenarioIcon`), the factor glyph key (web `FACTOR_ICONS` lookup), and the fixed temp/speed bucket axes.
//
// SI-canonical (Phase-48 / unit-conversion.instructions): distances arrive as kilometres and are bridged to metres
// before the display-boundary converters in the composable; speeds arrive as km/h and are bridged to m/s; temperatures
// arrive as Celsius. Wh/km efficiency + watt-hour capacity are read verbatim, exactly as the web page does. No
// miles/°F/psi is ever stored or computed — only produced at the display boundary in the page.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.projectedrange

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.math.floor
import kotlin.math.max

/** Default battery percentage the what-if calc assumes when the payload reports none (web `: 80`). */
private const val DEFAULT_BATTERY_PCT = 80.0

/** Default usable pack capacity (Wh) the what-if calc assumes when the payload reports none (web `: 75000`). */
private const val DEFAULT_CAPACITY_WH = 75_000.0

/** Heuristic Wh/km tiers for the efficiency heatmap (web `effColor`: 155 / 180 / 210 kWh-per-km thresholds). */
private const val EFF_EXCELLENT_MAX = 155.0
private const val EFF_GOOD_MAX = 180.0
private const val EFF_FAIR_MAX = 210.0

/** Heuristic fallback Wh/km when a (temp × speed) bucket has no sample (web interpolation fallback constants). */
private const val EFF_FALLBACK_BASE = 155.0
private const val EFF_SPEED_PIVOT = 35.0
private const val EFF_SPEED_FACTOR = 0.5
private const val EFF_TEMP_PIVOT = 20.0
private const val EFF_TEMP_FACTOR = 1.5
private const val EFF_FLOOR = 170.0

/** Bucket boundaries (web `interpolateRange`): temp `<0 freezing, <10 cold, <25 mild else hot`. */
private const val TEMP_FREEZING_MAX = 0.0
private const val TEMP_COLD_MAX = 10.0
private const val TEMP_MILD_MAX = 25.0

/** Bucket boundaries (web `interpolateRange`): speed `<50 city, <90 suburban else highway`. */
private const val SPEED_CITY_MAX = 50.0
private const val SPEED_SUBURBAN_MAX = 90.0

/** Scenario glyph gates (web `scenarioIcon`): a sub-zero scenario is "cold", an over-90 km/h one is "fast". */
private const val SCENARIO_COLD_MAX_C = 0.0
private const val SCENARIO_FAST_MIN_KMH = 90.0

/** A non-negative health factor default (web `health_factor ?? 1`). */
const val DEFAULT_HEALTH_FACTOR: Double = 1.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ProjectedRangePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("projectedRange", "/projected-range", …)`, so the host binds this surface to that destination (and its
 * `/projected-range` deep link) without the nav module depending on it.
 */
object ProjectedRangePageRegistration {
    /** The navigation destination id (Destinations.kt `page("projectedRange", "/projected-range", …)`). */
    const val ROUTE_ID: String = "projectedRange"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/projected-range"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "ProjectedRangePage"
}

/** The fixed temperature buckets the efficiency matrix rows are keyed by (web `TEMP_BUCKETS`). */
val TEMP_BUCKETS: List<String> = listOf("freezing", "cold", "mild", "hot")

/** The fixed speed buckets the efficiency matrix columns are keyed by (web `SPEED_BUCKETS`). */
val SPEED_BUCKETS: List<String> = listOf("city", "suburban", "highway")

// ── Decoded envelope ────────────────────────────────────────────────────────────────────────────────────────────

/** One decoded `factors[]` entry (web `RangeFactor`). [impactPct] is a signed percentage; the name keys the glyph. */
data class RangeFactor(
    val name: String,
    val impactPct: Double,
    val description: String,
)

/** One decoded `projection_curve[]` point (web `CurvePoint`). All ranges are SI kilometres. */
data class CurvePoint(
    val batteryPct: Double,
    val ratedRange: Double,
    val projectedRange: Double,
)

/** One decoded `efficiency_matrix[]` bucket (web `EfficiencyBucket`). [whKm] is Wh/km; [samples] the drive count. */
data class EfficiencyBucket(
    val tempBucket: String,
    val speedBucket: String,
    val whKm: Double,
    val samples: Int,
)

/**
 * One decoded `scenarios[]` entry (web `RangeScenario`). [speedKmh] is km/h, [tempC] Celsius, [efficiencyWhKm] Wh/km,
 * [rangeKm] SI km; [extras] carries badges such as `sentry`; [isCurrent] flags the live driving scenario.
 */
data class RangeScenario(
    val name: String,
    val speedKmh: Double,
    val tempC: Double,
    val efficiencyWhKm: Double,
    val rangeKm: Double,
    val rangeMi: Double,
    val sampleCount: Int,
    val extras: List<String>,
    val isCurrent: Boolean,
)

/**
 * The decoded `/analytics/range-projection` payload (web `RangeProjection`). Estimates + curve ranges are SI km,
 * [usableCapacityWh] is Wh, [efficiencyFactor]/[healthFactor] are 0–1 fractions, percentages are 0–100.
 */
data class RangeProjection(
    val currentRangeKm: Double,
    val projectedRangeKm: Double,
    val batteryLevel: Double,
    val efficiencyFactor: Double,
    val factors: List<RangeFactor>,
    val projectionCurve: List<CurvePoint>,
    val currentBatteryPct: Double,
    val usableCapacityWh: Double,
    val healthFactor: Double,
    val scenarios: List<RangeScenario>,
    val efficiencyMatrix: List<EfficiencyBucket>,
    val teslaEstimateKm: Double,
    val yourEstimateKm: Double,
    val accuracyNote: String,
) {
    /** Whether the feed carries a usable projection (web renders the page only for a truthy payload). */
    val hasData: Boolean
        get() = yourEstimateKm > 0.0 || teslaEstimateKm > 0.0 || currentRangeKm > 0.0 ||
            usableCapacityWh > 0.0 || efficiencyFactor > 0.0 || batteryLevel > 0.0 ||
            projectionCurve.isNotEmpty() || scenarios.isNotEmpty() || efficiencyMatrix.isNotEmpty()

    /** The battery percentage the what-if calc scopes to (web `current_battery_pct ?? battery_level ?? 80`). */
    val whatIfBatteryPct: Double
        get() = currentBatteryPct.takeIf { it > 0.0 } ?: batteryLevel.takeIf { it > 0.0 } ?: DEFAULT_BATTERY_PCT

    /** The pack capacity the what-if calc scopes to (web `usable_capacity_wh ?? 75000`). */
    val whatIfCapacityWh: Double
        get() = usableCapacityWh.takeIf { it > 0.0 } ?: DEFAULT_CAPACITY_WH

    /** O(1) bucket lookup keyed `temp|speed`, mirroring the web `matrixLookup` memo. */
    val matrixLookup: Map<String, EfficiencyBucket>
        get() = efficiencyMatrix.associateBy { "${it.tempBucket}|${it.speedBucket}" }

    companion object {
        val EMPTY: RangeProjection =
            RangeProjection(
                currentRangeKm = 0.0,
                projectedRangeKm = 0.0,
                batteryLevel = 0.0,
                efficiencyFactor = 0.0,
                factors = emptyList(),
                projectionCurve = emptyList(),
                currentBatteryPct = 0.0,
                usableCapacityWh = 0.0,
                healthFactor = DEFAULT_HEALTH_FACTOR,
                scenarios = emptyList(),
                efficiencyMatrix = emptyList(),
                teslaEstimateKm = 0.0,
                yourEstimateKm = 0.0,
                accuracyNote = "",
            )
    }
}

// ── Derived: small render-driving classifications ───────────────────────────────────────────────────────────────

/** The efficiency heat tier for a matrix cell (web `effColor`); the composable maps each tier to a theme color. */
enum class EfficiencyLevel { Excellent, Good, Fair, Poor }

/** Classifies a Wh/km figure into its heat tier (web `effColor` thresholds). */
fun effLevel(whKm: Double): EfficiencyLevel =
    when {
        whKm <= EFF_EXCELLENT_MAX -> EfficiencyLevel.Excellent
        whKm <= EFF_GOOD_MAX -> EfficiencyLevel.Good
        whKm <= EFF_FAIR_MAX -> EfficiencyLevel.Fair
        else -> EfficiencyLevel.Poor
    }

/** Which glyph a scenario card shows (web `scenarioIcon`); the composable maps the kind to a [RangeGlyphs] vector. */
enum class ScenarioKind { Sentry, Cold, Fast, Default }

/** Picks the scenario glyph kind (web `scenarioIcon`: sentry → shield, sub-zero → snowflake, fast → car, else bolt). */
fun scenarioKind(scenario: RangeScenario): ScenarioKind =
    when {
        scenario.extras.contains("sentry") -> ScenarioKind.Sentry
        scenario.tempC < SCENARIO_COLD_MAX_C -> ScenarioKind.Cold
        scenario.speedKmh > SCENARIO_FAST_MIN_KMH -> ScenarioKind.Fast
        else -> ScenarioKind.Default
    }

/** Which glyph a range-factor row shows (web `FACTOR_ICONS` lookup): the lowercased, underscore-joined factor name. */
fun factorIconKey(name: String): String = name.lowercase().trim().replace(Regex("\\s+"), "_")

// ── "What if" interpolation (web `interpolateRange`) ────────────────────────────────────────────────────────────

/** The output of [interpolateRange] (web `{ effWhKm, rangeKm }`). Both rounded to one fraction digit. */
data class WhatIfResult(
    val effWhKm: Double,
    val rangeKm: Double,
)

/**
 * Estimates Wh/km + projected range for a hypothetical (speed, temperature) pair against the personal efficiency
 * matrix — a verbatim port of the web `interpolateRange`. Falls back to a heuristic Wh/km curve when the matched
 * bucket is absent, floors a non-positive efficiency, then projects range from the scoped battery + capacity.
 */
fun interpolateRange(
    matrix: List<EfficiencyBucket>,
    speedKmh: Double,
    tempC: Double,
    batteryPct: Double,
    capacityWh: Double,
): WhatIfResult {
    val tempBucket =
        when {
            tempC < TEMP_FREEZING_MAX -> "freezing"
            tempC < TEMP_COLD_MAX -> "cold"
            tempC < TEMP_MILD_MAX -> "mild"
            else -> "hot"
        }
    val speedBucket =
        when {
            speedKmh < SPEED_CITY_MAX -> "city"
            speedKmh < SPEED_SUBURBAN_MAX -> "suburban"
            else -> "highway"
        }
    val match = matrix.firstOrNull { it.tempBucket == tempBucket && it.speedBucket == speedBucket }
    var eff =
        match?.whKm
            ?: (EFF_FALLBACK_BASE + (speedKmh - EFF_SPEED_PIVOT) * EFF_SPEED_FACTOR +
                max(0.0, EFF_TEMP_PIVOT - tempC) * EFF_TEMP_FACTOR)
    if (eff <= 0.0) eff = EFF_FLOOR
    val rangeKm = capacityWh * (batteryPct / 100.0) / eff
    return WhatIfResult(effWhKm = roundTo(eff, 1), rangeKm = roundTo(rangeKm, 1))
}

// ── Decoder ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decodes the raw `/analytics/range-projection` [json] into a [RangeProjection], null-safe per field. */
fun parseRangeProjection(json: JsonElement?): RangeProjection {
    val obj = json as? JsonObject ?: return RangeProjection.EMPTY
    return RangeProjection(
        currentRangeKm = obj.double("current_range_km"),
        projectedRangeKm = obj.double("projected_range_km"),
        batteryLevel = obj.double("battery_level"),
        efficiencyFactor = obj.double("efficiency_factor"),
        factors = (obj["factors"] as? JsonArray).orEmptyJson().mapNotNull(::parseFactor),
        projectionCurve = (obj["projection_curve"] as? JsonArray).orEmptyJson().mapNotNull(::parseCurvePoint),
        currentBatteryPct = obj.double("current_battery_pct"),
        usableCapacityWh = obj.double("usable_capacity_wh"),
        healthFactor = obj.doubleOrNull("health_factor") ?: DEFAULT_HEALTH_FACTOR,
        scenarios = (obj["scenarios"] as? JsonArray).orEmptyJson().mapNotNull(::parseScenario),
        efficiencyMatrix = (obj["efficiency_matrix"] as? JsonArray).orEmptyJson().mapNotNull(::parseBucket),
        teslaEstimateKm = obj.double("tesla_estimate_km"),
        yourEstimateKm = obj.double("your_estimate_km"),
        accuracyNote = obj.stringField("accuracy_note") ?: "",
    )
}

private fun parseFactor(element: JsonElement): RangeFactor? {
    val obj = element as? JsonObject ?: return null
    val name = obj.stringField("name") ?: return null
    return RangeFactor(
        name = name,
        impactPct = obj.double("impact_pct"),
        description = obj.stringField("description") ?: "",
    )
}

private fun parseCurvePoint(element: JsonElement): CurvePoint? {
    val obj = element as? JsonObject ?: return null
    return CurvePoint(
        batteryPct = obj.double("battery_pct"),
        ratedRange = obj.double("rated_range"),
        projectedRange = obj.double("projected_range"),
    )
}

private fun parseBucket(element: JsonElement): EfficiencyBucket? {
    val obj = element as? JsonObject ?: return null
    val tempBucket = obj.stringField("temp_bucket") ?: return null
    val speedBucket = obj.stringField("speed_bucket") ?: return null
    return EfficiencyBucket(
        tempBucket = tempBucket,
        speedBucket = speedBucket,
        whKm = obj.double("wh_km"),
        samples = obj.int("samples"),
    )
}

private fun parseScenario(element: JsonElement): RangeScenario? {
    val obj = element as? JsonObject ?: return null
    val name = obj.stringField("name") ?: return null
    return RangeScenario(
        name = name,
        speedKmh = obj.double("speed_kmh"),
        tempC = obj.double("temp_c"),
        efficiencyWhKm = obj.double("efficiency_wh_km"),
        rangeKm = obj.double("range_km"),
        rangeMi = obj.double("range_mi"),
        sampleCount = obj.int("sample_count"),
        extras = (obj["extras"] as? JsonArray).orEmptyJson().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
        isCurrent = obj.boolField("is_current") ?: false,
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ProjectedRangePageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page calls
 * it from its first composition. Carries no vehicle id, capacity, range or temperature payload.
 */
fun recordProjectedRangeOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to ProjectedRangePageRegistration.SLUG))
}

// ── Small framework-free helpers ────────────────────────────────────────────────────────────────────────────────

/** Rounds [value] to [decimals] fraction digits (half-up), mirroring the web `+(fmtNumber(v, d))` round-then-parse. */
internal fun roundTo(value: Double, decimals: Int): Double {
    var factor = 1.0
    repeat(decimals) { factor *= 10.0 }
    return floor(value * factor + 0.5) / factor
}

private fun JsonArray?.orEmptyJson(): List<JsonElement> = this ?: emptyList()

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
