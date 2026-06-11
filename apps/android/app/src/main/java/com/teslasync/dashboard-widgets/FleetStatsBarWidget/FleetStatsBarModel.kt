// Pure, framework-free model + projection for the Fleet Stats Bar dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx). No Compose, no Android view types, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The widget composes three feeds — the enrolled-vehicle list
// (useVehicles), the trailing-30-day fleet analytics (useFleetAnalytics(30), raw SI JSON), and the
// settings document (useUnits, for the distance unit). This file owns the SI JSON decode (web
// optional-chaining -> null-safe reads), the dual-feed combine that mirrors the web WidgetShell short
// circuits (loading / hard error / freshness), the display-boundary SI->display distance conversion
// (Phase-48 SI-canonical rule; web `useUnits`), and the four-stat projection. Values stay SI until the
// projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/FleetStatsBarWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstatsbar

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.rows < 2` test that collapses the four-up stat grid into
 * a single stacked column.
 */
data class FleetStatsBarSize(
    val cols: Int,
    val rows: Int,
) {
    /** True below two rows (web `size.rows < 2`): stack the four stats in one column. */
    val isCompact: Boolean get() = rows < 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`fleet-stats-bar`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object FleetStatsBarRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "fleet-stats-bar"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "FleetStatsBarWidget"

    /** Trailing window the fleet totals cover: 30 days (web `useFleetAnalytics(30)`). */
    const val WINDOW_DAYS = 30

    /** Default footprint: 4 columns × 2 rows (web `defaultSize`). */
    val defaultSize = FleetStatsBarSize(cols = 4, rows = 2)

    /** Minimum footprint: 3 columns × 2 rows (web `minSize`). */
    val minSize = FleetStatsBarSize(cols = 3, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = FleetStatsBarSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: FleetStatsBarSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: FleetStatsBarSize): FleetStatsBarSize =
        FleetStatsBarSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from
 * the `/settings` document: just the [distanceUnit], which selects the SI metres->km/mi/ft conversion
 * and the unit label shown beside the distance stat. Energy is rendered in the literal `kWh` the web
 * component hard-codes, so no other preference is required.
 */
data class FleetStatsBarDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** Metric default used before settings load (matches the web metric default). */
        val METRIC_DEFAULT = FleetStatsBarDisplayPrefs(DistanceUnitPref.KM)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): FleetStatsBarDisplayPrefs =
            FleetStatsBarDisplayPrefs(distanceUnit = UnitPreferences.fromSettings(settings).distance)
    }
}

/**
 * Localized labels the surface folds into its output — the seven web `t('widget.fleetStatsBar.…')`
 * keys the component reads. The pure [FleetStatsBarProjection] reads these to assemble each visible
 * string; the composable builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class FleetStatsBarStrings(
    val title: String,
    val vehicles: String,
    val online: String,
    val onlineNow: String,
    val distance30d: String,
    val energy30d: String,
    val noData: String,
)

/**
 * The decoded fleet-analytics payload — the two SI fields the web component reads from `/analytics/fleet`
 * (`total_distance_km` and `total_energy_kwh`). [totalDistanceSI] is the raw value the web feeds straight
 * into `convertDistanceFromSI` (which treats its argument as SI metres), so it is carried verbatim and
 * converted only in [FleetStatsBarProjection]. [present] mirrors the web `analytics` truthiness gate (any
 * returned object is truthy and contributes to `hasData`).
 */
data class FleetAnalyticsValues(
    val totalDistanceSI: Double,
    val totalEnergyKwh: Double,
    val present: Boolean,
) {
    companion object {
        /** The "no analytics" snapshot, used when the payload is absent / JSON-null (web `analytics` falsy). */
        val ABSENT = FleetAnalyticsValues(totalDistanceSI = 0.0, totalEnergyKwh = 0.0, present = false)
    }
}

/**
 * The combined, decoded fleet snapshot the projection renders from — the native analogue of the web
 * `stats` memo plus the `hasData` gate. Pure data (no Compose / Android types) so the projection is
 * unit-tested without a UI host. [totalDistanceSI] is SI (converted at the display boundary);
 * [totalEnergyKwh] is already in kWh on the wire (web reads `total_energy_kwh` and formats it directly).
 */
data class FleetStatsBarData(
    val vehicleCount: Int,
    val onlineCount: Int,
    val totalDistanceSI: Double,
    val totalEnergyKwh: Double,
    val hasData: Boolean,
) {
    companion object {
        /** The empty snapshot, surfaced before data arrives or when no vehicles AND no analytics exist. */
        val EMPTY = FleetStatsBarData(vehicleCount = 0, onlineCount = 0, totalDistanceSI = 0.0, totalEnergyKwh = 0.0, hasData = false)
    }
}

/**
 * Identifies which leading icon a stat tile shows. The pure projection emits this enum (no Compose
 * types); the composable maps each case to its `ImageVector`, keeping this model render-framework-free.
 */
enum class FleetStatIcon {
    /** Web lucide `Car` — the Vehicles total. */
    Vehicles,

    /** Web lucide `Wifi` — the Online Now count. */
    Online,

    /** Web lucide `Route` — the trailing-30-day distance. */
    Distance,

    /** Web lucide `Zap` — the trailing-30-day energy. */
    Energy,
}

/**
 * One fully projected stat tile — the native analogue of a web `StatGridItem` AFTER the
 * `WidgetStatGrid` mapping. [unit] is the optional suffix (distance unit / `kWh`); [iconKey] selects the
 * leading glyph. The web `trendValue`s are intentionally NOT carried: `WidgetStatGrid` only renders a
 * trend when a `trend` DIRECTION is also supplied, and this widget supplies none, so no trend chip ever
 * renders — the native projection mirrors that rendered output rather than the dead `trendValue` data.
 */
data class FleetStatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val iconKey: FleetStatIcon,
)

/**
 * The render-ready view of the whole widget body for one footprint — the native analogue of the web
 * `items` array plus the `hasData ? grid : empty` branch. Pure data so the projection is unit-tested
 * without a UI host. The composable renders the four [items] in the stat grid when [hasData], else the
 * [emptyMessage] no-data surface.
 */
data class FleetStatsBarDisplay(
    val hasData: Boolean,
    val items: List<FleetStatItem>,
    val emptyMessage: String,
)

/** Web sentinel for an online vehicle: `v.state === 'online'`. */
const val ONLINE_STATE: String = "online"

/**
 * Decodes the raw `/analytics/fleet` [json] (SI, snake_case on the wire) into [FleetAnalyticsValues]. A
 * non-object input (absent / JSON-null) collapses to [FleetAnalyticsValues.ABSENT] (web `analytics`
 * falsy); any object yields `present = true` with the two SI fields read null-safely
 * (`total_distance_km` / `total_energy_kwh` missing or JSON-null ⇒ 0.0, reproducing web `?? 0`).
 */
fun parseFleetAnalytics(json: JsonElement?): FleetAnalyticsValues {
    val obj = json as? JsonObject ?: return FleetAnalyticsValues.ABSENT
    return FleetAnalyticsValues(
        totalDistanceSI = (obj["total_distance_km"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
        totalEnergyKwh = (obj["total_energy_kwh"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
        present = true,
    )
}

/**
 * Counts online vehicles — the native analogue of web `vehicles.filter(v => v.state === 'online').length`.
 *
 * The TeslaSync `/vehicles` contract is the typed enrolled-vehicle list: the Go `vehicle.Vehicle`
 * struct (ADR-001 typed-by-default), the OpenAPI `Vehicle` schema, and the generated KMP [Vehicle] all
 * carry NO per-vehicle live `state` field — live drive-state is owned by `/vehicles/{id}/state` and the
 * SSE stream, never the enrolled-vehicle list. So [vehicleDriveState] resolves to `null` for every row
 * and the web predicate matches zero, exactly as it does in the running web app (the web `Vehicle.state`
 * is a frontend-only optional the `/vehicles` payload never populates). Pinned by
 * `FleetStatsBarProjectionTest.onlineCountReflectsTypedVehiclesContract` so this stays an intentional,
 * contract-faithful reproduction rather than silently drifting.
 */
fun countOnline(vehicles: List<Vehicle>?): Int = vehicles.orEmpty().count { it.driveState == ONLINE_STATE }

/**
 * The live drive-state string for this vehicle as carried by the `/vehicles` list payload — the field the
 * web reads in `v.state === 'online'`. The typed contract exposes none (live drive-state is owned by
 * `/vehicles/{id}/state` and the SSE stream, never the enrolled-vehicle list), so it is always `null` and
 * no enrolled row is ever counted online; see [countOnline].
 */
private val Vehicle.driveState: String? get() = null

/**
 * Combines the two data feeds (vehicles + fleet analytics) into a single cache-then-network [UiState]
 * that mirrors the web `WidgetShell` contract. The freshness/error surface is sourced from the ANALYTICS
 * feed (web wires `WidgetShell`'s `updatedAt`/`isFetching`/`isStale`/`isError`/`onRefresh` to the
 * analytics query), while the first-load gate considers BOTH feeds (web `isLoading = vehiclesLoading ||
 * analyticsLoading`) and the content/empty split uses the widget-wide `hasData`
 * (web `(vehicles.length > 0) || analytics`).
 *
 * Phase precedence reproduces the web short-circuits in order:
 *  1. either feed first-loading with nothing cached → [UiPhase.Loading] (web skeleton).
 *  2. analytics hard-errored with no cache → [UiPhase.Error] (web `QueryError`; the analytics error
 *     short-circuits even when vehicles are present).
 *  3. resolved with no vehicles AND no analytics → [UiPhase.Empty] (web no-data surface).
 *  4. otherwise → [UiPhase.Content].
 *
 * Honest freshness (ADR-013): an analytics error WITH a cached value keeps the cached stats visible as
 * stale/offline content with a retry, never blanking working data; the freshness stamp + [ErrorKind]
 * ride along so the header shows an offline indicator.
 */
fun combineFleetStats(
    vehicles: Resource<List<Vehicle>>,
    analytics: Resource<JsonElement>,
): UiState<FleetStatsBarData> {
    val vehicleList = vehicles.cached
    val analyticsValues = parseFleetAnalytics(analytics.cached)
    val vehicleCount = vehicleList?.size ?: 0
    val hasData = vehicleCount > 0 || analyticsValues.present
    val data =
        FleetStatsBarData(
            vehicleCount = vehicleCount,
            onlineCount = countOnline(vehicleList),
            totalDistanceSI = analyticsValues.totalDistanceSI,
            totalEnergyKwh = analyticsValues.totalEnergyKwh,
            hasData = hasData,
        )
    val phase = fleetStatsPhase(vehicles, analytics, hasData)
    val analyticsError = analytics as? Resource.Error

    return UiState(
        phase = phase,
        data = if (phase.rendersData) data else null,
        fetchedAt = analytics.fetchedAtOrNull(),
        // Stale/offline only while showing cached content after an analytics failure (or a stale-cache
        // refresh); a fresh success is never stale, and a hard error owns the error surface instead.
        stale = phase == UiPhase.Content && analytics.isStaleSource(),
        refreshing = analytics.isBackgroundRefreshing(),
        errorKind = analyticsError?.let { errorKindOf(it.error) },
        httpStatus = analyticsError?.let { httpStatusOf(it.error) },
    )
}

/**
 * The render phase for the combined feeds, reproducing the web `WidgetShell` short-circuit order: a
 * first-loading feed wins (web `isLoading = vehiclesLoading || analyticsLoading`), then an analytics hard
 * error (web `QueryError`), then the no-data gate, otherwise content.
 */
private fun fleetStatsPhase(
    vehicles: Resource<*>,
    analytics: Resource<*>,
    hasData: Boolean,
): UiPhase =
    when {
        vehicles.isFirstLoading() || analytics.isFirstLoading() -> UiPhase.Loading
        analytics.isHardError() -> UiPhase.Error
        !hasData -> UiPhase.Empty
        else -> UiPhase.Content
    }

/** True for the phases that render the [FleetStatsBarData] payload (content + empty), not loading/error. */
private val UiPhase.rendersData: Boolean
    get() = this == UiPhase.Content || this == UiPhase.Empty

/** A first load in flight with nothing cached to show (web `isLoading`). */
private fun Resource<*>.isFirstLoading(): Boolean = this is Resource.Loading && cached == null

/** A hard failure with no cached value to fall back on (web `error` short-circuit). */
private fun Resource<*>.isHardError(): Boolean = this is Resource.Error && cached == null

/** A refresh running over an existing cached value (web `isFetching` with data present). */
private fun Resource<*>.isBackgroundRefreshing(): Boolean = this is Resource.Loading && cached != null

/** Cached data that must be shown as stale/offline: a failed refresh, or a stale-cache replay. */
private fun Resource<*>.isStaleSource(): Boolean = this is Resource.Error || (this is Resource.Loading && stale)

/** The freshness stamp carried by any [Resource] variant, or `null` when nothing has loaded. */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/**
 * Pure projection from a decoded [FleetStatsBarData] to the render-ready [FleetStatsBarDisplay] — the
 * native port of the inline derivations + JSX formatting in the web source. Vehicle/online counts render
 * as plain integers (web passes the raw number to `StatCard`); distance is converted to the user's unit
 * and formatted with one decimal (web `fmtNumber(value, 1)`), and energy is formatted with one decimal
 * and the literal `kWh` suffix. [locale] drives the grouping/separators (tests pin [Locale.US]).
 */
object FleetStatsBarProjection {
    /** Web `fmtNumber(totalDistance, 1)` precision. */
    const val DISTANCE_DECIMALS = 1

    /** Web `fmtNumber(totalEnergy, 1)` precision. */
    const val ENERGY_DECIMALS = 1

    /** Web hard-coded energy unit suffix (`unit: 'kWh'`). */
    const val ENERGY_UNIT = "kWh"

    /** Project [data] for the given [prefs] and localized [strings]. */
    fun project(
        data: FleetStatsBarData,
        prefs: FleetStatsBarDisplayPrefs,
        strings: FleetStatsBarStrings,
        locale: Locale = Locale.US,
    ): FleetStatsBarDisplay {
        val distanceDisplay = convertDistanceFromSI(data.totalDistanceSI, prefs.distanceUnit)
        val items =
            listOf(
                FleetStatItem(
                    label = strings.vehicles,
                    value = data.vehicleCount.toString(),
                    unit = null,
                    iconKey = FleetStatIcon.Vehicles,
                ),
                FleetStatItem(
                    label = strings.onlineNow,
                    value = data.onlineCount.toString(),
                    unit = null,
                    iconKey = FleetStatIcon.Online,
                ),
                FleetStatItem(
                    label = strings.distance30d,
                    value = ChartFormat.number(distanceDisplay, DISTANCE_DECIMALS, locale),
                    unit = prefs.distanceUnit.label,
                    iconKey = FleetStatIcon.Distance,
                ),
                FleetStatItem(
                    label = strings.energy30d,
                    value = ChartFormat.number(data.totalEnergyKwh, ENERGY_DECIMALS, locale),
                    unit = ENERGY_UNIT,
                    iconKey = FleetStatIcon.Energy,
                ),
            )
        return FleetStatsBarDisplay(hasData = data.hasData, items = items, emptyMessage = strings.noData)
    }
}
