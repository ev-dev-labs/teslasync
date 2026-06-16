// Pure, framework-free model + projections for the WeeklyDigestPage analytics surface — the native analogue of
// everything the web page derives before composing its body (web/src/features/analytics/pages/WeeklyDigestPage.tsx +
// its useWeeklyDigest hook). No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only
// references the framework-free UiState projection, the shared-core Resource/units, and the reused StatTrend chip
// type), so the composable stays a thin render layer.
//
// The web page owns these concerns this file ports: (1) the decode of the `/vehicles/{id}/weekly-digest` SI JSON
// envelope (internal/api/weeklydigest/handler.go) into a typed [WeeklyDigest] (web optional-chaining → null-safe
// reads); (2) the display-boundary unit + currency derivation from the `/settings` document
// ([WeeklyDigestDisplayPrefs], web `useUnits`/`useFormatting`); and (3) the week-over-week trend helper the body
// renders (web `pctChange`/`trendFor` in weekly-digest/helpers.ts).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the distance figure is read SI off the wire (the handler
// reports `distance_km` in kilometres, exactly like the lifetime endpoint) and converted ONLY at the display boundary
// via the shared [convertDistanceFromSI]; energy (kWh) + efficiency (Wh/km) keep the canonical display units the web
// renders. Nothing is stored or computed in non-SI units.
//
// Empty-state gate (Honesty Covenant #9 — documented, not silent): the web guards its body on
// `hasData = weekDrives.length || weekCharging.length`. The native surface mirrors that with [WeeklyDigest.hasData]
// (any drives / distance / energy this week) so an all-zero week — or a fleet with no selectable vehicle — routes to
// the friendly empty surface (web `noData` / `noDataMessage`) rather than a grid of zeros, making the three declared
// data states genuinely reachable.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling LifetimeStatsPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.weeklydigest

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.abs

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance figure floors on before conversion (web `fromKm`). */
private const val METERS_PER_KM = 1000.0

/** Below this absolute delta a week-over-week change is "flat" (web `Math.abs(diff) < 0.01`). */
private const val FLAT_EPSILON = 0.01

/** Full-percent constant for the previous-week-zero branch of `pctChange` (web `100`). */
private const val FULL_PERCENT = 100.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `WeeklyDigestPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("weeklyDigest", "/weekly-digest", …)`, so the host binds this surface to that destination (and its
 * `/weekly-digest` deep link) without the nav module depending on it.
 */
object WeeklyDigestPageRegistration {
    /** The navigation destination id (Destinations.kt `page("weeklyDigest", "/weekly-digest", …)`). */
    const val ROUTE_ID: String = "weeklyDigest"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/weekly-digest"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "WeeklyDigestPage"
}

/**
 * The decoded `/vehicles/{id}/weekly-digest` payload — the native analogue of the figures the web digest body reads.
 * Distance is SI kilometres on the wire (converted at the display boundary); energy is kWh, efficiency is Wh/km, cost
 * is fiat. Each `prev*` field is the same figure for the previous week, used by the week-over-week trend chips. A
 * missing / JSON-null field collapses to zero, exactly like the web optional-chaining (`data?.x ?? 0`).
 */
data class WeeklyDigest(
    val drives: Double,
    val distanceKm: Double,
    val energyKwh: Double,
    val cost: Double,
    val efficiencyWhKm: Double,
    val prevDrives: Double,
    val prevDistanceKm: Double,
    val prevEnergyKwh: Double,
    val prevCost: Double,
    val prevEfficiencyWhKm: Double,
) {
    /**
     * Whether the week carries any meaningful activity. An all-zero week (no drives / distance / energy) routes to the
     * friendly empty surface (web `noData`) rather than a grid of zeros — the native mirror of the web
     * `hasData = weekDrives.length > 0 || weekCharging.length > 0` gate.
     */
    val hasData: Boolean
        get() = drives > 0.0 || distanceKm > 0.0 || energyKwh > 0.0

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload or a vehicle-less fleet. */
        val EMPTY: WeeklyDigest =
            WeeklyDigest(
                drives = 0.0,
                distanceKm = 0.0,
                energyKwh = 0.0,
                cost = 0.0,
                efficiencyWhKm = 0.0,
                prevDrives = 0.0,
                prevDistanceKm = 0.0,
                prevEnergyKwh = 0.0,
                prevCost = 0.0,
                prevEfficiencyWhKm = 0.0,
            )
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] (distance figure), the [currencySymbol] (blank → "$"), the
 * currency [precision] (web `decimal_precision`, floored & non-negative, else 2), and the [locale] used for
 * grouped-number formatting (web global locale, `settings.locale || 'en-US'`).
 */
data class WeeklyDigestDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** SI km → the user's display distance (web `fromKm`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [precision]-digit grouped number in the user's locale.
     */
    fun currency(amount: Double): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, precision.coerceAtLeast(0))

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: WeeklyDigestDisplayPrefs =
            WeeklyDigestDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): WeeklyDigestDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringOrNull(KEY_CURRENCY_SYMBOL)?.trim()
            return WeeklyDigestDisplayPrefs(
                distanceUnit = unit.distance,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * Decodes the raw `/vehicles/{id}/weekly-digest` [json] (SI, snake_case on the wire) into a [WeeklyDigest]. A
 * non-object input, a missing field, or a JSON-null field all collapse to zero — reproducing the web optional-chaining
 * (`data?.x ?? 0`).
 */
fun parseWeeklyDigest(json: JsonElement?): WeeklyDigest {
    val obj = json as? JsonObject ?: return WeeklyDigest.EMPTY
    return WeeklyDigest(
        drives = obj.double("drives"),
        distanceKm = obj.double("distance_km"),
        energyKwh = obj.double("energy_kwh"),
        cost = obj.double("cost"),
        efficiencyWhKm = obj.double("efficiency"),
        prevDrives = obj.double("prev_drives"),
        prevDistanceKm = obj.double("prev_distance_km"),
        prevEnergyKwh = obj.double("prev_energy_kwh"),
        prevCost = obj.double("prev_cost"),
        prevEfficiencyWhKm = obj.double("prev_efficiency"),
    )
}

/**
 * The week-over-week change of [current] vs [previous] as a render-ready [StatTrend] chip — the native port of the web
 * `trendFor` (weekly-digest/helpers.ts). A near-zero delta is "flat"; otherwise the arrow follows the sign and the
 * label is the signed percentage. [invertPositive] flips the good/bad tone for "lower is better" metrics (efficiency).
 */
fun weekTrend(
    current: Double,
    previous: Double,
    prefs: WeeklyDigestDisplayPrefs,
    invertPositive: Boolean = false,
): StatTrend {
    val diff = current - previous
    if (abs(diff) < FLAT_EPSILON) {
        return StatTrend(direction = DeltaArrow.Flat, text = prefs.number(0.0, 1) + "%", positive = true)
    }
    val isUp = diff > 0.0
    val pct = pctChange(current, previous)
    val sign = if (isUp) "+" else ""
    return StatTrend(
        direction = if (isUp) DeltaArrow.Up else DeltaArrow.Down,
        text = sign + prefs.number(pct, 1) + "%",
        positive = if (invertPositive) !isUp else isUp,
    )
}

/** Percentage change of [current] vs [previous] (web `pctChange`); a zero baseline yields ±100 / 0. */
private fun pctChange(
    current: Double,
    previous: Double,
): Double {
    if (previous == 0.0) return if (current > 0.0) FULL_PERCENT else 0.0
    return (current - previous) / abs(previous) * FULL_PERCENT
}

/**
 * Projects the enrolled-vehicle feed onto a [WeeklyDigest] [Resource] for the no-vehicle-selected case (a cold start
 * or an empty fleet), so the surface still resolves all three data states without a vehicle id: a first vehicles load
 * stays [Resource.Loading] (spinner), a hard vehicles failure stays [Resource.Error] (retry), and a resolved-but-empty
 * fleet becomes [WeeklyDigest.EMPTY] (the empty surface). Pure, so the view-model's flatMap stays declarative.
 */
fun Resource<List<Vehicle>>.toNoVehicleDigest(): Resource<WeeklyDigest> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(WeeklyDigest.EMPTY, fetchedAt = fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → WeeklyDigest` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [WeeklyDigestPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, distance, cost or efficiency payload.
 */
fun recordWeeklyDigestOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to WeeklyDigestPageRegistration.SLUG))
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
