// Pure, framework-free model + projections for the TripPlannerPage driving surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/driving/pages/TripPlannerPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// trip-plan request DTOs, the shared SI converters, the framework-free ChartFormat helper, and the sibling
// feature-view snapshot models), so the composable stays a thin render layer and all of this is exercised
// off-device by the :app:testDebugUnitTest gate.
//
// The web page owns one mutation (`usePlanTrip` ▸ `POST /trip-planner/plan`) plus local form state (origin /
// destination / current-SOC / min-arrival-SOC / driving-speed). From the returned `TripPlan` it derives the six
// summary StatCards, the estimate disclaimer, the feasibility warning, the weather-impact panel, and the inputs
// it threads into the map / SOC-route-chart / leg-list child components. This file ports all of that: the JSON
// decode of the plan envelope ([parseTripPlan]), the form-state container + request builder ([buildPlanRequest]),
// the six-tile projection ([statTiles] + [formatDuration]), the SI display-preference helpers, and the pure
// mappers that adapt the decoded plan onto each child surface's snapshot model.
//
// SI boundary (unit-conversion.instructions): the plan stays SI end to end (metres, seconds, watt-hours); the
// only display conversion lives in the explicit [TripPlannerDisplayPrefs] helpers used at the render boundary
// (`convertDistanceFromSI` + the shared `formatEnergy` + the currency/number formatter), exactly as the web page
// converts only inside its `toDistanceDisplay` / `formatEnergy` / `formatCurrency` callbacks (Phase-48 SI rule).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 driving pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.tripplanner

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.featureviews.socroutechart.RouteChargeStop as SocChargeStop
import io.teslasync.android.featureviews.socroutechart.TripSOCPoint as SocPoint
import io.teslasync.android.featureviews.tripleglist.TripChargeStop as LegChargeStop
import io.teslasync.android.featureviews.tripleglist.TripLeg as LegRow
import io.teslasync.android.featureviews.tripleglist.TripRouteBreakdown
import io.teslasync.android.featureviews.tripleglist.TripWaypoint
import io.teslasync.android.featureviews.tripplannermap.TripChargeStop as MapChargeStop
import io.teslasync.android.featureviews.tripplannermap.TripLeg as MapLeg
import io.teslasync.android.featureviews.tripplannermap.TripLocation as MapLocation
import io.teslasync.android.featureviews.tripplannermap.TripPlannerMapSnapshot
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.TripLocation
import io.teslasync.shared.core.presentation.driving.TripPlanPreferences
import io.teslasync.shared.core.presentation.driving.TripPlanRequest
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
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TripPlannerPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("tripPlanner", "/trip-planner", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to
 * that destination (and its `/trip-planner` deep link) without the nav module depending on it.
 */
object TripPlannerPageRegistration {
    /** The navigation destination id (Destinations.kt `page("tripPlanner", "/trip-planner", …)`). */
    const val ROUTE_ID: String = "tripPlanner"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/trip-planner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no route/coordinate data. */
    const val SLUG: String = "TripPlannerPage"

    /** The default starting state-of-charge the slider opens at (web `useState(80)`). */
    const val DEFAULT_CURRENT_SOC: Int = 80

    /** The default minimum arrival state-of-charge the slider opens at (web `useState(20)`). */
    const val DEFAULT_MIN_ARRIVAL_SOC: Int = 20

    /** The charge-limit SOC sent with every plan request (web `charge_limit_soc: 90`). */
    const val DEFAULT_CHARGE_LIMIT_SOC: Int = 90

    /** The default driving-speed multiplier (web `useState(1.0)`). */
    const val DEFAULT_SPEED_FACTOR: Double = 1.0

    /** The minimum value of the current-SOC slider (web `min={10}`). */
    const val CURRENT_SOC_MIN: Int = 10

    /** The maximum value of the current-SOC slider (web `max={100}`). */
    const val CURRENT_SOC_MAX: Int = 100

    /** The minimum value of the min-arrival-SOC slider (web `min={5}`). */
    const val MIN_ARRIVAL_SOC_MIN: Int = 5

    /** The maximum value of the min-arrival-SOC slider (web `max={50}`). */
    const val MIN_ARRIVAL_SOC_MAX: Int = 50
}

/* ------------------------------------------------------------------ */
/*  Form state                                                        */
/* ------------------------------------------------------------------ */

/**
 * A picked start/destination point — the native union of the form's raw text + the resolved geocode pin (web
 * `TripLocation` once an `AddressInput` suggestion is selected). Plain WGS84 degrees + a display name.
 */
data class TripLocationInput(
    val lat: Double,
    val lng: Double,
    val name: String,
)

/**
 * The page's local form state — the native mirror of the web page's `useState` block (the origin/destination text
 * + resolved pins, the two SOC sliders, and the driving-speed multiplier). The active vehicle lives in the global
 * selection (web `useSelectedVehicle`), so [canPlan] here only covers the two endpoints; the view-model folds the
 * vehicle in.
 */
data class TripPlannerFormState(
    val originText: String = "",
    val destText: String = "",
    val origin: TripLocationInput? = null,
    val destination: TripLocationInput? = null,
    val currentSoc: Int = TripPlannerPageRegistration.DEFAULT_CURRENT_SOC,
    val minArrivalSoc: Int = TripPlannerPageRegistration.DEFAULT_MIN_ARRIVAL_SOC,
    val speedFactor: Double = TripPlannerPageRegistration.DEFAULT_SPEED_FACTOR,
) {
    /** Both endpoints are picked (web `origin != null && destination != null`); the vehicle gate is the VM's. */
    val hasEndpoints: Boolean get() = origin != null && destination != null
}

/**
 * The four driving-speed multipliers offered in the dropdown, in the web `speedOptions` order (Relaxed −20 %,
 * Normal, Brisk +10 %, Fast +20 %). The selected value is sent on the plan request `preferences.speed_factor`; the
 * composable pairs each with its localized label (`tripPlanner.speed.*`).
 */
object SpeedFactors {
    const val RELAXED: Double = 0.8
    const val NORMAL: Double = 1.0
    const val BRISK: Double = 1.1
    const val FAST: Double = 1.2
}

/**
 * Builds the `POST /trip-planner/plan` body from the [form] + the active [vehicleId] — the verbatim port of the
 * web `handlePlan` `req` object (`charge_limit_soc: 90`, `preferences: { speed_factor, include_weather: true,
 * prefer_superchargers: true }`). Returns `null` when either endpoint is unset (web `if (!origin || !destination
 * || !activeVehicle) return`).
 */
fun buildPlanRequest(
    form: TripPlannerFormState,
    vehicleId: Long,
): TripPlanRequest? {
    val origin = form.origin ?: return null
    val destination = form.destination ?: return null
    return TripPlanRequest(
        vehicleId = vehicleId,
        origin = TripLocation(origin.lat, origin.lng, origin.name),
        destination = TripLocation(destination.lat, destination.lng, destination.name),
        currentSoc = form.currentSoc,
        chargeLimitSoc = TripPlannerPageRegistration.DEFAULT_CHARGE_LIMIT_SOC,
        minArrivalSoc = form.minArrivalSoc,
        preferences =
            TripPlanPreferences(
                speedFactor = form.speedFactor,
                includeWeather = true,
                preferSuperchargers = true,
            ),
    )
}

/* ------------------------------------------------------------------ */
/*  Plan envelope (POST /trip-planner/plan)                           */
/* ------------------------------------------------------------------ */

/** A decoded trip endpoint/waypoint (web `TripLocation`). */
data class PlannedLocation(
    val lat: Double,
    val lng: Double,
    val name: String,
)

/** The decoded route summary the six StatCards + the disclaimer/feasibility banners read (web `TripPlanRoute`). */
data class PlannedRoute(
    val totalDistanceM: Double,
    val totalDurationS: Double,
    val drivingDurationS: Double,
    val chargingDurationS: Double,
    val totalEnergyWh: Double,
    val estimatedCost: Double,
    val arrivalSoc: Double,
    val feasible: Boolean,
    val isEstimate: Boolean,
)

/** One decoded route leg (web `TripLeg`); SI metres / seconds / watt-hours + whole-percent SOC. */
data class PlannedLeg(
    val from: PlannedLocation,
    val to: PlannedLocation,
    val distanceM: Double,
    val durationS: Double,
    val energyWh: Double,
    val startSoc: Double,
    val arrivalSoc: Double,
)

/** One decoded charging stop (web `TripChargeStop`). */
data class PlannedChargeStop(
    val name: String,
    val location: PlannedLocation,
    val chargeFromSoc: Double,
    val chargeToSoc: Double,
    val chargeDurationS: Double,
    val energyWh: Double,
    val cost: Double,
    val isRecommended: Boolean,
)

/** The decoded weather-impact slice (web `TripWeatherImpact`); [avgTempC] is null when the API omits it. */
data class PlannedWeather(
    val avgTempC: Double?,
    val efficiencyFactor: Double,
    val note: String,
) {
    /** Web `weather.efficiency_factor !== 1.0` — the panel only renders when conditions move efficiency. */
    val hasImpact: Boolean get() = efficiencyFactor != IDENTITY_EFFICIENCY

    private companion object {
        const val IDENTITY_EFFICIENCY = 1.0
    }
}

/** One decoded SOC-curve sample (web `TripSOCPoint`). */
data class PlannedSocPoint(
    val distanceM: Double,
    val soc: Double,
)

/**
 * The fully decoded `TripPlan` (web `TripPlan`). A null/absent body (the resting "no plan yet" state) yields
 * [EMPTY] with a null [route] so the page renders only its form, exactly as the web page guards every result
 * section behind `{route && …}` / `{plan && …}`.
 */
data class TripPlanResult(
    val route: PlannedRoute?,
    val legs: List<PlannedLeg>,
    val chargeStops: List<PlannedChargeStop>,
    val weather: PlannedWeather?,
    val socCurve: List<PlannedSocPoint>,
) {
    companion object {
        /** The "no plan" snapshot, surfaced before the first successful plan and for a non-object body. */
        val EMPTY: TripPlanResult = TripPlanResult(null, emptyList(), emptyList(), null, emptyList())
    }
}

/**
 * Decodes the raw `/trip-planner/plan` [json] (SI, snake_case on the wire) into a [TripPlanResult]. A non-object
 * input yields [TripPlanResult.EMPTY]; a missing or JSON-null field collapses to zero / empty, reproducing the
 * web optional reads.
 */
fun parseTripPlan(json: JsonElement?): TripPlanResult {
    val obj = json as? JsonObject ?: return TripPlanResult.EMPTY
    return TripPlanResult(
        route = (obj["route"] as? JsonObject)?.let(::parseRoute),
        legs = (obj["legs"] as? JsonArray).mapObjects(::parseLeg),
        chargeStops = (obj["charge_stops"] as? JsonArray).mapObjects(::parseChargeStop),
        weather = (obj["weather_impact"] as? JsonObject)?.let(::parseWeather),
        socCurve = (obj["soc_curve"] as? JsonArray).mapObjects(::parseSocPoint),
    )
}

private fun parseRoute(obj: JsonObject): PlannedRoute =
    PlannedRoute(
        totalDistanceM = obj.double("total_distance_m"),
        totalDurationS = obj.double("total_duration_s"),
        drivingDurationS = obj.double("driving_duration_s"),
        chargingDurationS = obj.double("charging_duration_s"),
        totalEnergyWh = obj.double("total_energy_wh"),
        estimatedCost = obj.double("estimated_cost"),
        arrivalSoc = obj.double("arrival_soc"),
        feasible = obj.bool("feasible"),
        isEstimate = obj.bool("is_estimate"),
    )

private fun parseLeg(obj: JsonObject): PlannedLeg =
    PlannedLeg(
        from = parseLocation(obj["from"] as? JsonObject),
        to = parseLocation(obj["to"] as? JsonObject),
        distanceM = obj.double("distance_m"),
        durationS = obj.double("duration_s"),
        energyWh = obj.double("energy_wh"),
        startSoc = obj.double("start_soc"),
        arrivalSoc = obj.double("arrival_soc"),
    )

private fun parseChargeStop(obj: JsonObject): PlannedChargeStop =
    PlannedChargeStop(
        name = obj.string("name"),
        location = parseLocation(obj["location"] as? JsonObject),
        chargeFromSoc = obj.double("charge_from_soc"),
        chargeToSoc = obj.double("charge_to_soc"),
        chargeDurationS = obj.double("charge_duration_s"),
        energyWh = obj.double("energy_wh"),
        cost = obj.double("cost"),
        isRecommended = obj.bool("is_recommended"),
    )

private fun parseWeather(obj: JsonObject): PlannedWeather =
    PlannedWeather(
        avgTempC = obj.doubleOrNull("avg_temp_c"),
        efficiencyFactor = obj.doubleOr("efficiency_factor", 1.0),
        note = obj.string("note"),
    )

private fun parseSocPoint(obj: JsonObject): PlannedSocPoint =
    PlannedSocPoint(distanceM = obj.double("distance_m"), soc = obj.double("soc"))

private fun parseLocation(obj: JsonObject?): PlannedLocation =
    PlannedLocation(
        lat = obj?.double("lat") ?: 0.0,
        lng = obj?.double("lng") ?: 0.0,
        name = obj?.string("name") ?: "",
    )

/* ------------------------------------------------------------------ */
/*  Summary StatCards (the six route tiles)                           */
/* ------------------------------------------------------------------ */

/**
 * The six render-ready summary tiles (web `<StatCard>` grid). Each [distance]/[totalTime]/… is already formatted
 * at the SI→display boundary via [TripPlannerDisplayPrefs]; [distanceUnit] is the user's distance label rendered
 * as the distance tile's unit suffix. [cost] is the localized currency string, or the resolved "Free" label when
 * the route has no cost (web `route.estimated_cost > 0 ? formatCurrency(...) : t('common.free')`).
 */
data class TripStatTiles(
    val distance: String,
    val distanceUnit: String,
    val totalTime: String,
    val driving: String,
    val charging: String,
    val energy: String,
    val cost: String,
)

/**
 * Projects the decoded [route] into the six summary tiles using [prefs] — the verbatim port of the web StatCard
 * `value` expressions. The charging tile shows the em dash when there is no charging time (web `> 0 ? … : '—'`)
 * and the cost tile falls back to the localized [freeLabel] when the route is free.
 */
fun statTiles(
    route: PlannedRoute,
    prefs: TripPlannerDisplayPrefs,
    freeLabel: String,
): TripStatTiles =
    TripStatTiles(
        distance = fixed0(prefs.distanceDisplay(route.totalDistanceM)),
        distanceUnit = prefs.distanceUnitLabel,
        totalTime = formatDuration(route.totalDurationS / SECONDS_PER_MINUTE),
        driving = formatDuration(route.drivingDurationS / SECONDS_PER_MINUTE),
        charging =
            if (route.chargingDurationS > 0.0) {
                formatDuration(route.chargingDurationS / SECONDS_PER_MINUTE)
            } else {
                EM_DASH
            },
        energy = prefs.energy(route.totalEnergyWh, ENERGY_PRECISION),
        cost = if (route.estimatedCost > 0.0) prefs.currency(route.estimatedCost) else freeLabel,
    )

/**
 * Formats a duration in [minutes] as the web `formatDuration` does: `"{h}h {m}m"` when there is an hour component,
 * else `"{m}m"`. Hours floor and minutes round, matching `Math.floor` / `Math.round`.
 */
fun formatDuration(minutes: Double): String {
    val safe = if (minutes.isFinite()) minutes else 0.0
    val hours = floor(safe / MINUTES_PER_HOUR).toInt()
    val mins = (safe % MINUTES_PER_HOUR).roundToInt()
    return if (hours == 0) "${mins}m" else "${hours}h ${mins}m"
}

/** Web `Number.toFixed(0)` — a half-up rounded integer with no grouping (matches the distance StatCard). */
private fun fixed0(value: Double): String = (if (value.isFinite()) value.roundToLong() else 0L).toString()

/* ------------------------------------------------------------------ */
/*  Child-surface snapshot mappers                                    */
/* ------------------------------------------------------------------ */

/**
 * Adapts the form endpoints + the decoded plan onto the [TripPlannerMapSnapshot] the map child reads (web
 * `<TripPlannerMap origin destination legs chargeStops />`). The origin/destination come from the FORM (so the
 * map updates as the user picks endpoints, before planning); the legs/charge-stops come from the plan.
 */
fun mapToMapSnapshot(
    form: TripPlannerFormState,
    result: TripPlanResult?,
): TripPlannerMapSnapshot =
    TripPlannerMapSnapshot(
        origin = form.origin?.let { MapLocation(it.lat, it.lng, it.name) },
        destination = form.destination?.let { MapLocation(it.lat, it.lng, it.name) },
        legs =
            result?.legs.orEmpty().map { leg ->
                MapLeg(
                    from = MapLocation(leg.from.lat, leg.from.lng, leg.from.name),
                    to = MapLocation(leg.to.lat, leg.to.lng, leg.to.name),
                )
            },
        chargeStops =
            result?.chargeStops.orEmpty().map { stop ->
                MapChargeStop(
                    name = stop.name,
                    location = MapLocation(stop.location.lat, stop.location.lng, stop.location.name),
                    chargeFromSoc = stop.chargeFromSoc,
                    chargeToSoc = stop.chargeToSoc,
                    chargeDurationS = stop.chargeDurationS,
                )
            },
    )

/** Adapts the plan SOC curve onto the SOC-route chart child's points (web `socCurve` prop). */
fun mapToSocPoints(result: TripPlanResult?): List<SocPoint> =
    result?.socCurve.orEmpty().map { SocPoint(distanceM = it.distanceM, soc = it.soc) }

/** Adapts the plan charge stops onto the SOC-route chart child's narrowed stop slice (web `chargeStops` prop). */
fun mapToSocChargeStops(result: TripPlanResult?): List<SocChargeStop> =
    result?.chargeStops.orEmpty().map { SocChargeStop(chargeFromSoc = it.chargeFromSoc) }

/**
 * Adapts the plan onto the [TripRouteBreakdown] the leg-list child reads (web `<TripLegList legs chargeStops />`).
 */
fun mapToRouteBreakdown(result: TripPlanResult?): TripRouteBreakdown =
    TripRouteBreakdown(
        legs =
            result?.legs.orEmpty().map { leg ->
                LegRow(
                    from = TripWaypoint(leg.from.name, leg.from.lat, leg.from.lng),
                    to = TripWaypoint(leg.to.name, leg.to.lat, leg.to.lng),
                    distanceM = leg.distanceM,
                    durationS = leg.durationS,
                    energyWh = leg.energyWh,
                    startSoc = leg.startSoc,
                    arrivalSoc = leg.arrivalSoc,
                )
            },
        chargeStops =
            result?.chargeStops.orEmpty().map { stop ->
                LegChargeStop(
                    name = stop.name,
                    chargeFromSoc = stop.chargeFromSoc,
                    chargeToSoc = stop.chargeToSoc,
                    chargeDurationS = stop.chargeDurationS,
                    energyWh = stop.energyWh,
                    cost = stop.cost,
                    isRecommended = stop.isRecommended,
                )
            },
    )

/* ------------------------------------------------------------------ */
/*  Display preferences (useUnits / useFormatting)                    */
/* ------------------------------------------------------------------ */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting`
 * reads from the `/settings` document: the distance unit (the distance tile), the energy formatter (the energy
 * tile), and the currency symbol + precision + locale (the cost tile + grouped numbers). The backend stores and
 * serves SI; this is the single place a preference becomes a display unit (Phase-48; ADR-013 keeps the cache SI).
 */
data class TripPlannerDisplayPrefs(
    val units: UnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"), the web `unitPrefs.distance`. */
    val distanceUnitLabel: String get() = units.distance.label

    /** SI metres → the user's display distance number (web `toDistanceDisplay` / `convertDistanceFromSI`). */
    fun distanceDisplay(meters: Double): Double = convertDistanceFromSI(meters, units.distance)

    /** SI watt-hours → the user's display energy string with unit, e.g. "12.3 kWh" (web `formatEnergy`). */
    fun energy(
        wattHours: Double,
        precision: Int,
    ): String = formatEnergy(wattHours, units, precision)

    /** Web `useFormatting().formatCurrency(amount)` = `${currencySymbol}${fmtNumber(amount, precision)}`. */
    fun currency(amount: Double): String = currencySymbol + ChartFormat.number(amount, precision, locale)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int = precision,
    ): String = ChartFormat.number(value, decimals, locale)

    companion object {
        /** Metric + 2dp + en-US + `$` defaults used before settings load (matches the web cold-start defaults). */
        fun default(): TripPlannerDisplayPrefs = from(null)

        /** Resolves the unit + currency + precision + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): TripPlannerDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.string("currency_symbol").orEmpty()
            return TripPlannerDisplayPrefs(
                units = units,
                currencySymbol = rawSymbol.ifBlank { DEFAULT_CURRENCY },
                precision = units.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = runCatching { Locale.forLanguageTag(units.locale ?: DEFAULT_LOCALE_TAG) }
                    .getOrDefault(Locale.US),
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Diagnostics                                                       */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TripPlannerPageRegistration.SLUG] (P1/S11).
 * Carries no vehicle id, coordinate, address, or cost payload, so a diagnostics line can never leak where a user
 * is planning to drive. Kept free of Compose so it is unit-testable with a recording [Logger].
 */
fun recordTripPlannerPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TripPlannerPageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  JSON helpers                                                      */
/* ------------------------------------------------------------------ */

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.doubleOr(
    key: String,
    fallback: Double,
): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: fallback

private fun JsonObject.bool(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

private inline fun <T> JsonArray?.mapObjects(transform: (JsonObject) -> T): List<T> =
    this?.mapNotNull { (it as? JsonObject)?.let(transform) } ?: emptyList()

private const val DEFAULT_CURRENCY = "$"
private const val DEFAULT_PRECISION = 2
private const val DEFAULT_LOCALE_TAG = "en-US"
private const val ENERGY_PRECISION = 1
private const val SECONDS_PER_MINUTE = 60.0
private const val MINUTES_PER_HOUR = 60.0
private const val EM_DASH = "\u2014"
