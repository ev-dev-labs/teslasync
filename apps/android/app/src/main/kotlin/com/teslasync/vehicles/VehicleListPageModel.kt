// Pure, framework-free model + projections for the VehicleListPage fleet surface (P3/A7) — the native analogue of
// everything web/src/features/vehicles/pages/VehicleListPage.tsx derives before composing its panels. No Compose,
// no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI [Vehicle]
// + [VehicleState] DTOs, the shared-core [PinnedItem], the shared SI distance converter/formatter, the
// framework-free ChartFormat number helper, the android UnitPreferences settings reader, and java.util), so the
// composable stays a thin render layer and all of this stays unit-testable off-device by the
// :app:testDebugUnitTest gate.
//
// The web page reads the enrolled-vehicle list (`request<Vehicle[]>('/vehicles')`), batch-fetches each vehicle's
// last-known state (`fetchVehicleState`), and reads the unified pin list (`usePinned('vehicle')`) to float pinned
// rows to the top. It then renders four fleet-summary MetricCards (total vehicles, avg battery, total range,
// charging/online), a fleet-battery-status panel of per-vehicle battery bars, and a pinned-sorted list of vehicle
// cards. This file ports the page's value derivations: the pinned-first ordering, the fleet metric reduces
// (avg battery, total range, charging + online counts), the per-vehicle battery bars, and every vehicle-card
// value (status, battery level + severity colour, rated range, odometer, charger power, lock + sentry flags).
// The labels stay at the Compose boundary (they resolve from the i18n catalog), so this model produces only the
// formatted values + the severity buckets the Compose layer maps to theme colours.
//
// SI boundary (unit-conversion.instructions): the model stays SI end to end (meters); the only display conversion
// lives in the explicit [VehicleListDisplayPrefs] helpers used at the render boundary (convertDistanceFromSI +
// the shared formatDistance), exactly as the web page converts only inside its render expressions (Phase-48
// SI-canonical rule; ADR-013 keeps the cache itself SI). Battery level is a dimensionless percent and the charger
// power "kW" / battery "%" symbols are unit symbols (not translated UI chrome), exactly as the web interpolates
// them verbatim.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehicles.vehiclelist

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatDistance
import kotlinx.serialization.json.JsonElement
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `VehicleListPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("vehicles", "/vehicles", NavGroup.Vehicles)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/vehicles` deep link) without the nav module depending on it.
 */
object VehicleListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("vehicles", "/vehicles", …)`). */
    const val ROUTE_ID: String = "vehicles"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/vehicles"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "VehicleListPage"

    /** The web `vehicleList.length >= 2` gate for the compare-vehicles action. */
    const val COMPARE_MIN_VEHICLES: Int = 2

    /** The web compare target (`navigate('/vehicle-comparison?…')`). */
    const val COMPARE_PATH: String = "/vehicle-comparison"

    /** The web per-vehicle detail target prefix (`<Link to={'/vehicles/' + id}>`). */
    const val DETAIL_PATH_PREFIX: String = "/vehicles/"
}

/** Em dash shown for a missing / unparseable value (web `?? '—'`). */
const val VEHICLE_LIST_EM_DASH: String = "\u2014"

/** The charger-power unit symbol the web interpolates verbatim (`{charger_power} kW`); not translated UI chrome. */
const val CHARGER_POWER_UNIT: String = "kW"

/** The battery-percent unit symbol the web interpolates verbatim (`{level}%`); not translated UI chrome. */
const val BATTERY_PERCENT_UNIT: String = "%"

/* ------------------------------------------------------------------ */
/*  Battery severity (web batteryColor, @/lib/colors)                  */
/* ------------------------------------------------------------------ */

/** Battery-level severity bucket — the framework-free port of the web `batteryColor` thresholds. */
enum class BatterySeverity {
    /** > 60 % — web `COLOR.GOOD` (#10b981). */
    Good,

    /** > 25 % and <= 60 % — web `COLOR.WARN` (#f59e0b). */
    Warning,

    /** <= 25 % — web `COLOR.BAD` (#ef4444). */
    Critical,
}

private const val BATTERY_GOOD_MIN = 60
private const val BATTERY_WARNING_MIN = 25

/** Maps a battery level (0-100) to its severity bucket (web `batteryColor(level)`: >60 good, >25 warn, else bad). */
fun batterySeverity(level: Int): BatterySeverity =
    when {
        level > BATTERY_GOOD_MIN -> BatterySeverity.Good
        level > BATTERY_WARNING_MIN -> BatterySeverity.Warning
        else -> BatterySeverity.Critical
    }

/* ------------------------------------------------------------------ */
/*  Vehicle status (web deriveVehicleStatus / statusVariant)           */
/* ------------------------------------------------------------------ */

/** Badge variant for a vehicle status — the port of the web `statusVariant` -> `BadgeVariant` map. */
enum class VehicleStatusBadge { Success, Warning, Info, Neutral, Danger }

/** The closed set of FSM vehicle states (web `VEHICLE_STATES`, @/types/fsm/vehicle.ts). */
private val KNOWN_VEHICLE_STATES: Set<String> =
    setOf("online", "driving", "charging", "parked", "updating", "asleep", "offline")

/** Status tokens, also used as the stable map keys for [statusBadge]. */
private const val STATUS_OFFLINE = "offline"
private const val STATUS_CHARGING = "charging"
private const val STATUS_DRIVING = "driving"
private const val STATUS_ONLINE = "online"
private const val STATUS_PARKED = "parked"
private const val STATUS_UPDATING = "updating"
private const val STATUS_ASLEEP = "asleep"

/**
 * Derives a display-friendly status token from live vehicle state — the verbatim port of the web
 * `deriveVehicleStatus` (priority: no state -> offline, charging, driving, a known API state string, else online).
 * The token is data-derived (like the VIN / model) and rendered as-is, exactly as the web badge shows `{status}`;
 * it is not part of this surface's required i18n string set.
 */
fun deriveVehicleStatus(state: VehicleState?): String {
    if (state == null) return STATUS_OFFLINE
    if (state.isCharging) return STATUS_CHARGING
    if (state.speed > 0.0) return STATUS_DRIVING
    val s = state.state.lowercase(Locale.ROOT)
    return if (s in KNOWN_VEHICLE_STATES) s else STATUS_ONLINE
}

/** Maps a status token to its badge variant (web `VEHICLE_STATE_ENTRIES[status].variant ?? 'danger'`). */
fun statusBadge(status: String): VehicleStatusBadge =
    when (status) {
        STATUS_ONLINE, STATUS_DRIVING -> VehicleStatusBadge.Success
        STATUS_CHARGING -> VehicleStatusBadge.Warning
        STATUS_PARKED, STATUS_UPDATING -> VehicleStatusBadge.Info
        STATUS_ASLEEP -> VehicleStatusBadge.Neutral
        else -> VehicleStatusBadge.Danger
    }

/* ------------------------------------------------------------------ */
/*  Display preferences (web useUnits)                                 */
/* ------------------------------------------------------------------ */

/**
 * The display-boundary helpers the page applies to the SI [Vehicle]/[VehicleState]s — the Kotlin port of the web
 * page's `useUnits` (distance unit + `convertDistanceFromSI`/`formatDistance`) + the global `fmtNumber`
 * locale/precision. Distance is converted through the shared SI converter; numbers reproduce the web `fmtNumber`
 * (locale-grouped, fixed digits) through the framework-free [ChartFormat] helper.
 *
 * @property unit the resolved SI display unit set (web `unitPrefs`).
 * @property locale the BCP-47 locale used for number grouping (web global locale).
 * @property precision the configured number precision (web `decimal_precision`, floored & >= 0, else 2).
 */
data class VehicleListDisplayPrefs(
    val unit: UnitPref,
    val locale: Locale,
    val precision: Int,
) {
    /** The user's distance display unit (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unit.distance

    /** Distance unit short label (web `unitPrefs.distance`: "mi" / "km"). */
    val distanceUnitLabel: String get() = unit.distance.label

    /** A finite number with [precision] fraction digits + locale grouping (web `fmtNumber`; non-finite -> 0). */
    fun fmtNumber(value: Double): String =
        ChartFormat.number(if (value.isFinite()) value else 0.0, precision, locale)

    /** SI metres -> the user's distance unit, numeric only (web `convertDistanceFromSI`). */
    fun toDistanceDisplay(meters: Double): Double = convertDistanceFromSI(meters, unit.distance)

    /** SI metres formatted in the user's distance unit, e.g. "312.0 km" (web `formatDistance`). */
    fun formatDistanceLabel(meters: Double?): String = formatDistance(meters, unit)

    companion object {
        private const val DEFAULT_PRECISION = 2
        private const val DEFAULT_LOCALE_TAG = "en-US"

        /** Metric + en-US + 2dp defaults used before settings load (matches the web defaults). */
        val DEFAULT: VehicleListDisplayPrefs =
            VehicleListDisplayPrefs(
                unit = UnitPreferences.fromSettings(null),
                locale = Locale.US,
                precision = DEFAULT_PRECISION,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): VehicleListDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return VehicleListDisplayPrefs(
                unit = unit,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: DEFAULT_LOCALE_TAG) }.getOrDefault(Locale.US),
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Folded view (the web MetricCard / battery-bar / vehicle-card data) */
/* ------------------------------------------------------------------ */

/**
 * The fleet-summary card values — the native fold of the web page's `fleet` memo + the four summary MetricCards.
 * The labels are NOT here: they resolve from the i18n catalog at the Compose boundary.
 *
 * @property totalVehicles the total-vehicles card value (web `vehicleList.length`).
 * @property avgBatteryValue the avg-battery card value, percent-formatted (web `${fmtNumber(avgBattery)}%`).
 * @property avgBatteryRounded the rounded avg used by the battery-status header (web `Math.round(avgBattery)`).
 * @property totalRangeValue the total-range card value in the user's distance unit (web `fmtNumber(convert(...))`).
 * @property totalRangeUnitLabel the distance unit appended to the total-range label (web `(${unitPrefs.distance})`).
 * @property chargingCount the number of charging vehicles (web `fleet.chargingCount`).
 * @property onlineCount the number of vehicles with a known state (web `fleet.onlineCount`).
 */
data class FleetMetrics(
    val totalVehicles: Int,
    val avgBatteryValue: String,
    val avgBatteryRounded: Int,
    val totalRangeValue: String,
    val totalRangeUnitLabel: String,
    val chargingCount: Int,
    val onlineCount: Int,
)

/**
 * One row of the fleet-battery-status panel — a per-vehicle battery bar (web `fleet.entries.map`).
 *
 * @property id the vehicle id (stable list key).
 * @property name the vehicle display name, VIN fallback (web `vehicle.display_name || vehicle.vin`).
 * @property level the battery level 0-100 (web `state.battery_level ?? 0`).
 * @property severity the battery severity bucket -> the bar gradient colour (web `batteryColor(level)`).
 * @property rangeLabel the rated range in the user's distance unit (web `formatDistance(state.rated_range ?? 0)`).
 */
data class VehicleBatteryBar(
    val id: Long,
    val name: String,
    val level: Int,
    val severity: BatterySeverity,
    val rangeLabel: String,
)

/**
 * One vehicle card (web `sortedVehicleList.map` -> the GlassPanel card). All values are pre-folded; the labels +
 * action wiring stay at the Compose boundary.
 *
 * @property vehicle the source SI vehicle (carries the id the actions navigate to / pin).
 * @property hasState whether a last-known state was resolved (web `state` truthy guard for the stats row).
 * @property status the derived status token shown in the badge (web `deriveVehicleStatus`).
 * @property statusBadge the badge variant for [status] (web `statusVariant`).
 * @property displayName the card title (web `vehicle.display_name || vehicle.vin`).
 * @property subtitle the `model trim · vin` line (web `{model} {trim_badging} · {vin}`).
 * @property batteryLevel the battery level 0-100 (web `state?.battery_level ?? 0`).
 * @property batterySeverity the battery severity bucket -> the bar gradient colour (web `batteryColor(level)`).
 * @property rangeLabel the rated range, present only with a state (web `formatDistance(state.rated_range ?? 0)`).
 * @property odometerLabel the odometer, present only with a state (web `formatDistance(state.odometer ?? 0)`).
 * @property chargerPowerLabel the charger power "{n} kW", present only while charging (web `state.charger_power kW`).
 * @property isLocked whether the lock glyph shows (web `state?.is_locked`).
 * @property sentryMode whether the sentry glyph shows (web `state?.sentry_mode`).
 */
data class VehicleRow(
    val vehicle: Vehicle,
    val hasState: Boolean,
    val status: String,
    val statusBadge: VehicleStatusBadge,
    val displayName: String,
    val subtitle: String,
    val batteryLevel: Int,
    val batterySeverity: BatterySeverity,
    val rangeLabel: String?,
    val odometerLabel: String?,
    val chargerPowerLabel: String?,
    val isLocked: Boolean,
    val sentryMode: Boolean,
)

/**
 * The fully-folded view the vehicle-list panels render — the native fold of everything the web page computes for
 * its summary cards, battery-status panel, and vehicle cards.
 *
 * @property metrics the four fleet-summary card values.
 * @property batteryBars the per-vehicle battery bars, in the enrolled-list order (web `fleet.entries`).
 * @property rows the vehicle cards, pinned-first (web `sortedVehicleList`).
 */
data class VehicleListData(
    val metrics: FleetMetrics,
    val batteryBars: List<VehicleBatteryBar>,
    val rows: List<VehicleRow>,
)

/**
 * Folds the enrolled vehicles, their resolved states, and the pin list into the [VehicleListData] the panels read
 * — the native analogue of the web page's `fleet` memo + `sortedVehicleList` memo + the per-card derivations.
 *
 * @param vehicles the enrolled-vehicle list (web `vehicleList`).
 * @param statesById the resolved last-known state per vehicle id; a missing/null entry means "no state yet" (web
 *   `fleetStates` after the `Promise.all` of `fetchVehicleState`).
 * @param pins the unified vehicle pins (web `usePinned('vehicle')`), floated to the top by `position`.
 * @param prefs the live display preferences (web `useUnits`).
 */
fun deriveVehicleListData(
    vehicles: List<Vehicle>,
    statesById: Map<Long, VehicleState?>,
    pins: List<PinnedItem>,
    prefs: VehicleListDisplayPrefs,
): VehicleListData {
    // Entries with a resolved state, in the enrolled-list order (web `fleet.entries` = `withState`).
    val withState: List<Pair<Vehicle, VehicleState>> =
        vehicles.mapNotNull { v -> statesById[v.id]?.let { v to it } }

    val avgBattery =
        if (withState.isNotEmpty()) {
            withState.map { it.second.batteryLevel }.average()
        } else {
            0.0
        }
    val totalRange = withState.sumOf { it.second.ratedRange }

    val metrics =
        FleetMetrics(
            totalVehicles = vehicles.size,
            avgBatteryValue = prefs.fmtNumber(avgBattery),
            avgBatteryRounded = avgBattery.roundToInt(),
            totalRangeValue = prefs.fmtNumber(prefs.toDistanceDisplay(totalRange)),
            totalRangeUnitLabel = prefs.distanceUnitLabel,
            chargingCount = withState.count { it.second.isCharging },
            onlineCount = withState.size,
        )

    val batteryBars =
        withState.map { (vehicle, state) ->
            val level = state.batteryLevel.toInt()
            VehicleBatteryBar(
                id = vehicle.id,
                name = vehicle.displayName.ifBlank { vehicle.vin },
                level = level,
                severity = batterySeverity(level),
                rangeLabel = prefs.formatDistanceLabel(state.ratedRange),
            )
        }

    val rows =
        sortByPins(vehicles, pins).map { vehicle ->
            val state = statesById[vehicle.id]
            val status = deriveVehicleStatus(state)
            val level = state?.batteryLevel?.toInt() ?: 0
            VehicleRow(
                vehicle = vehicle,
                hasState = state != null,
                status = status,
                statusBadge = statusBadge(status),
                displayName = vehicle.displayName.ifBlank { vehicle.vin },
                subtitle = subtitleOf(vehicle),
                batteryLevel = level,
                batterySeverity = batterySeverity(level),
                rangeLabel = state?.let { prefs.formatDistanceLabel(it.ratedRange) },
                odometerLabel = state?.let { prefs.formatDistanceLabel(it.odometer) },
                chargerPowerLabel = state?.takeIf { it.isCharging }?.let { chargerPowerLabelOf(it.chargerPower, prefs) },
                isLocked = state?.isLocked ?: false,
                sentryMode = state?.sentryMode ?: false,
            )
        }

    return VehicleListData(metrics = metrics, batteryBars = batteryBars, rows = rows)
}

/**
 * Sorts the vehicles pinned-first by pin position, leaving unpinned rows in their original (backend) order — the
 * verbatim port of the web `sortedVehicleList` comparator over the `usePinned` positions. A stable sort keeps the
 * "return 0" tie-break for two unpinned rows, and `nullsLast` parks unpinned rows after every pinned one.
 */
private fun sortByPins(
    vehicles: List<Vehicle>,
    pins: List<PinnedItem>,
): List<Vehicle> {
    if (pins.isEmpty()) return vehicles
    val positionByItemId: Map<String, Int> = pins.associate { it.itemId to it.position }
    return vehicles.sortedWith(compareBy(nullsLast()) { positionByItemId[it.id.toString()] })
}

/** The `model trim · vin` subtitle line (web `{vehicle.model} {vehicle.trim_badging} · {vin}`). */
private fun subtitleOf(vehicle: Vehicle): String {
    val prefix = listOfNotNull(vehicle.model?.ifBlank { null }, vehicle.trimLevel?.ifBlank { null }).joinToString(" ")
    return if (prefix.isBlank()) vehicle.vin else "$prefix \u00B7 ${vehicle.vin}"
}

/** The "{n} kW" charger-power chip shown while charging (web `{state.charger_power} kW`). */
private fun chargerPowerLabelOf(
    chargerPower: Double,
    prefs: VehicleListDisplayPrefs,
): String {
    val isWhole = chargerPower % 1.0 == 0.0
    val text =
        if (isWhole) {
            ChartFormat.number(chargerPower, 0, prefs.locale)
        } else {
            ChartFormat.number(chargerPower, 1, prefs.locale)
        }
    return "$text $CHARGER_POWER_UNIT"
}
