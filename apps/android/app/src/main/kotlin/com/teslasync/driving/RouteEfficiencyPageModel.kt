// Pure, framework-free model + projections for the RouteEfficiencyPage driving surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/driving/pages/RouteEfficiencyPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// Resource/units + java.time), so the composable stays a thin render layer and all of this is exercised off-device by
// the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the one raw SI JSON envelope the page reads —
// `/analytics/route-efficiency` returning `{ routes: [...] }` — into typed, null-safe [RouteSummary] rows (web
// optional-chaining -> null-safe reads, `data?.routes ?? []`); (2) the display-boundary unit derivation from the
// `/settings` document ([RouteEfficiencyDisplayPrefs], web `useUnits`): the distance unit + the derived efficiency
// unit (Wh/km vs Wh/mi); (3) the per-route derivations the panels read — the fleet totals (route count, total trips,
// best/avg/worst efficiency across routes), the top-10 comparison bars (web `chartData`), and the per-route badge
// grade (web `efficiencyVariant`); and (4) the default 30-day date window the page scopes the read by (web
// `defaultStartDate`/`defaultEndDate`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the backend reports each route's distance in SI kilometres
// (`avg_distance_km`, see internal/api/routeeff/handler.go) and efficiency in SI Wh/km; distance is bridged to the SI
// base (metres) before conversion via the shared [convertDistanceFromSI] (exactly as the web `toDistanceDisplay` does
// with `avgDistanceKm * 1000`), and efficiency is scaled Wh/km -> Wh/mi for an imperial preference (web
// `toEfficiencyDisplay`). Trip counts are raw on the wire and rendered verbatim.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling DrivesListPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.routeefficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.LocalDate
import java.util.Locale

/** 1 km = 1000 m — the SI bridge the distance figures floor on before conversion (web `* 1000`). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km — the Wh/km -> Wh/mi scale the web `toEfficiencyDisplay` applies for an imperial pref. */
private const val KM_PER_MILE = 1.609344

/** Default currency / number fraction digits (web `_globalPrecision`, `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** Efficiency grade thresholds in SI Wh/km (web `efficiencyVariant`): <140 success, <180 info, <220 warning, else danger. */
private const val GRADE_SUCCESS_MAX = 140.0
private const val GRADE_INFO_MAX = 180.0
private const val GRADE_WARNING_MAX = 220.0

/** Cap of routes plotted in the comparison chart (web `.slice(0, 10)`). */
private const val MAX_COMPARISON_ROUTES = 10

/** Endpoint-name truncation in the comparison bar label (web `.substring(0, 10)`). */
private const val LABEL_TRUNCATE = 10

/** The trailing window the page scopes the read by (web `d.setDate(d.getDate() - 30)`). */
private const val DEFAULT_WINDOW_DAYS = 30L

/** Right-arrow joiner between a route's two endpoints in the comparison label (web `→`). */
private const val ROUTE_ARROW = "\u2192"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `RouteEfficiencyPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("routeEfficiency", "/route-efficiency", …)`, so the host binds this surface to that destination (and its
 * `/route-efficiency` deep link) without the nav module depending on it.
 */
object RouteEfficiencyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("routeEfficiency", "/route-efficiency", …)`). */
    const val ROUTE_ID: String = "routeEfficiency"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/route-efficiency"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "RouteEfficiencyPage"
}

/**
 * The per-route badge grade the page derives from a route's SI average efficiency (web `efficiencyVariant`). The page
 * maps this onto a [io.teslasync.android.components.ui.BadgeVariant] at the render boundary so the chip stays
 * theme-aware.
 */
enum class RouteEfficiencyGrade { Success, Info, Warning, Danger }

/** Grades [whPerKm] (SI Wh/km) exactly as the web `efficiencyVariant` does. */
fun efficiencyGrade(whPerKm: Double): RouteEfficiencyGrade =
    when {
        whPerKm < GRADE_SUCCESS_MAX -> RouteEfficiencyGrade.Success
        whPerKm < GRADE_INFO_MAX -> RouteEfficiencyGrade.Info
        whPerKm < GRADE_WARNING_MAX -> RouteEfficiencyGrade.Warning
        else -> RouteEfficiencyGrade.Danger
    }

/**
 * One decoded `/analytics/route-efficiency` route row — the native analogue of the web `RouteSummary` interface.
 * [avgDistanceKm] is SI kilometres; [avgEfficiency]/[bestEfficiency]/[worstEfficiency] are SI Wh/km. Missing / JSON-null
 * fields collapse to their zero / em-dash defaults, exactly like the web optional reads.
 */
data class RouteSummary(
    val startLocation: String,
    val endLocation: String,
    val tripCount: Int,
    val avgDistanceKm: Double,
    val avgEfficiency: Double,
    val bestEfficiency: Double,
    val worstEfficiency: Double,
)

/**
 * The decoded route-efficiency payload the page renders — the native analogue of the web `RouteEfficiencyData.routes`
 * the summary cards, comparison chart, route cards and metrics panel all read. The fleet totals are derived here exactly
 * as the web does (route count, total trips, the min best / max worst / mean average efficiency across routes), guarded
 * against an empty route set so a vehicle with no drives in range routes to the friendly empty surface rather than NaN.
 */
data class RouteEfficiencyModel(
    val routes: List<RouteSummary>,
) {
    /** Whether the scope yielded any route (else the page's empty surface — web `routes.length === 0`). */
    val isEmpty: Boolean get() = routes.isEmpty()

    /** Sum of every route's trip count (web `routes.reduce((sum, r) => sum + r.tripCount, 0)`). */
    val totalTrips: Int get() = routes.sumOf { it.tripCount }

    /** The fleet-wide best (lowest) SI efficiency, or 0 when empty (web `Math.min(...best)`). */
    val bestEfficiency: Double get() = routes.minOfOrNull { it.bestEfficiency } ?: 0.0

    /** The fleet-wide worst (highest) SI efficiency, or 0 when empty (web `Math.max(...worst)`). */
    val worstEfficiency: Double get() = routes.maxOfOrNull { it.worstEfficiency } ?: 0.0

    /** The mean of every route's SI average efficiency, or 0 when empty (web `sum(avg) / length`). */
    val avgEfficiency: Double get() = if (routes.isEmpty()) 0.0 else routes.sumOf { it.avgEfficiency } / routes.size

    /** The single most-driven route (web `routes[0]`, the SQL `ORDER BY trip_count DESC` head), or null when empty. */
    val mostDriven: RouteSummary? get() = routes.firstOrNull()

    companion object {
        /** The empty snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: RouteEfficiencyModel = RouteEfficiencyModel(emptyList())
    }
}

/**
 * One row of the route-comparison bar chart, ready to draw (web `chartData[]`): the truncated endpoint [name] and the
 * route's display-rounded best / avg / worst efficiency plus its [trips]. The values are already converted to the user's
 * efficiency unit and rounded to whole numbers, mirroring the web `Math.round(toEfficiencyDisplay(...))`.
 */
data class RouteComparisonBar(
    val name: String,
    val best: Double,
    val avg: Double,
    val worst: Double,
    val trips: Int,
)

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from the `/settings`
 * document: the [distanceUnit] (distance figures + the derived efficiency unit), the number [precision] (web
 * `decimal_precision`, floored & non-negative, else 2), and the [locale] used for grouped-number formatting.
 */
data class RouteEfficiencyDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The efficiency unit, mirroring the web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    val efficiencyUnit: String get() = if (distanceUnit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI km -> the user's display distance (web `toDistanceDisplay`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun distanceFromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** SI Wh/km -> the user's display efficiency (web `toEfficiencyDisplay`: `* 1.609344` for miles, else identity). */
    fun efficiencyDisplay(whPerKm: Double): Double =
        if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = ChartFormat.number(value, precision, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: RouteEfficiencyDisplayPrefs =
            RouteEfficiencyDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): RouteEfficiencyDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return RouteEfficiencyDisplayPrefs(
                distanceUnit = unit.distance,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * Decodes the raw `/analytics/route-efficiency` [json] (SI, snake_case on the wire — see internal/api/routeeff/
 * handler.go) into a [RouteEfficiencyModel]. A non-object input, a missing `routes` array, or a non-object row all
 * collapse to an empty model — reproducing the web `data?.routes ?? []`.
 */
fun parseRouteEfficiency(json: JsonElement?): RouteEfficiencyModel {
    val obj = json as? JsonObject ?: return RouteEfficiencyModel.EMPTY
    val array = obj["routes"] as? JsonArray ?: return RouteEfficiencyModel.EMPTY
    val routes =
        array.mapNotNull { element ->
            val row = element as? JsonObject ?: return@mapNotNull null
            RouteSummary(
                startLocation = row.string("start_location").orEmpty(),
                endLocation = row.string("end_location").orEmpty(),
                tripCount = row.int("trip_count"),
                avgDistanceKm = row.double("avg_distance_km"),
                avgEfficiency = row.double("avg_efficiency"),
                bestEfficiency = row.double("best_efficiency"),
                worstEfficiency = row.double("worst_efficiency"),
            )
        }
    return RouteEfficiencyModel(routes)
}

/**
 * Projects the decoded [routes] into the top-N [RouteComparisonBar]s the comparison chart draws — the web `chartData`
 * derivation: sort ascending by SI average efficiency, take the first [MAX_COMPARISON_ROUTES], and map each to a
 * truncated `start→end` label plus its display-rounded best / avg / worst efficiency in [prefs]' efficiency unit.
 */
fun comparisonBars(
    routes: List<RouteSummary>,
    prefs: RouteEfficiencyDisplayPrefs,
): List<RouteComparisonBar> =
    routes
        .sortedBy { it.avgEfficiency }
        .take(MAX_COMPARISON_ROUTES)
        .map { route ->
            RouteComparisonBar(
                name = "${route.startLocation.take(LABEL_TRUNCATE)}$ROUTE_ARROW${route.endLocation.take(LABEL_TRUNCATE)}",
                best = roundToWhole(prefs.efficiencyDisplay(route.bestEfficiency)),
                avg = roundToWhole(prefs.efficiencyDisplay(route.avgEfficiency)),
                worst = roundToWhole(prefs.efficiencyDisplay(route.worstEfficiency)),
                trips = route.tripCount,
            )
        }

/**
 * The page's inclusive date scope, carried as epoch-days so the date-range filter binds to it directly, with the
 * `YYYY-MM-DD` ISO strings the `/analytics/route-efficiency` read needs (web `start`/`end` query params).
 */
data class RouteEfficiencyDateRange(
    val startEpochDay: Long,
    val endEpochDay: Long,
) {
    /** The inclusive start as a `YYYY-MM-DD` string (web `startDate`). */
    val startIso: String get() = LocalDate.ofEpochDay(startEpochDay).toString()

    /** The inclusive end as a `YYYY-MM-DD` string (web `endDate`). */
    val endIso: String get() = LocalDate.ofEpochDay(endEpochDay).toString()

    companion object {
        /** The trailing 30-day window ending [today] the page defaults to (web `defaultStartDate`/`defaultEndDate`). */
        fun trailingMonth(today: LocalDate = LocalDate.now()): RouteEfficiencyDateRange =
            RouteEfficiencyDateRange(
                startEpochDay = today.minusDays(DEFAULT_WINDOW_DAYS).toEpochDay(),
                endEpochDay = today.toEpochDay(),
            )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RouteEfficiencyPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page
 * calls it from its first composition. Carries no vehicle id, location or efficiency payload.
 */
fun recordRouteEfficiencyOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to RouteEfficiencyPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed; the
 * `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement -> model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun roundToWhole(value: Double): Double =
    Math.round(value).toDouble() // parity:allow toDouble() widens the rounded Long, matches web Math.round, not a TODO stub

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
