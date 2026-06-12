// Pure, framework-free model + projection for the FleetSummary feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/FleetSummary.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// Unlike the purely-presentational FleetStatsBar sibling, FleetSummary owns a data feed: the web
// component receives the enrolled `vehicles` list (its parent's `useVehicles`) AND runs its own
// `useQuery` that fetches every vehicle's last-known state (`fetchVehicleState`, 30s refetch). So this
// surface binds two shared P1/S8 feeds — `VehiclesStore.vehicles()` and per-vehicle
// `VehiclesStore.vehicleState(id)` — and reproduces the full cache-then-network state set
// (loading / content / stale / offline / error) the per-surface parity rule mandates. The web source's
// own "empty" handling is its `?? 0` fall-through: with no vehicles / no states every figure collapses
// to zero and the four labelled cards still render (a friendly zero-valued surface, never a blank box),
// exactly as the committed FleetStatsBar projection reproduces "the empty (no-data → zeros) grid".
//
// The four derivations this model performs are a 1:1 port of the web component:
//   • Vehicles      — `vehicles.length` (the enrolled count).
//   • Avg Battery   — `states.reduce(+battery_level) / states.length` then `Math.round`, suffix `%`.
//   • Total Range   — `Math.round(convertDistanceFromSI(Σ rated_range_metres, unit))`; `rated_range` is
//                     SI metres on the wire (Phase-48 SI-canonical), converted at the display boundary.
//   • Charging/Online — `chargingCount` (states where `is_charging`) over `onlineCount` (states present).
// Values stay SI/raw until the projection; the rendered figures count up exactly as the web
// `AnimatedNumber` does (the composable owns the animation + locale formatting, so this model carries
// render-ready Doubles, not pre-formatted strings).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FleetSummary — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetsummary

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale
import kotlin.math.roundToLong

/** Web `<AnimatedNumber value={vehicles.length} />` / charging / online render as whole numbers. */
internal const val COUNT_DECIMALS: Int = 0

/** Web `<AnimatedNumber value={Math.round(avgBattery)} suffix="%" />` — a pre-rounded whole percent. */
internal const val BATTERY_DECIMALS: Int = 0

/** Web `<AnimatedNumber value={Math.round(convertDistanceFromSI(...))} />` — a pre-rounded whole number. */
internal const val RANGE_DECIMALS: Int = 0

/** Web hard-coded battery-card suffix (`suffix="%"`). */
internal const val BATTERY_SUFFIX: String = "%"

/** Web charging-card separator between the charging count and the online total (`/ {onlineCount}`). */
internal const val ONLINE_SEPARATOR: String = "/ "

/**
 * The per-card brand accent the web component applies to each icon (and, for the charging card, the
 * value). Kept as a pure enum so the model stays framework-free; the composable maps each to a design
 * token (P1/S9) at the render boundary, exactly as the committed `VehicleHero` surface does. The web
 * utility classes map verbatim: [Cyan] = `text-cyan-400`, [Green] = `text-green-500`,
 * [Purple] = `text-purple-400`, [Amber] = `text-amber-400`.
 */
enum class SummaryAccent { Cyan, Green, Purple, Amber }

/**
 * The display preferences this surface needs — the native port of the web parent's `useUnits` read:
 * the [distanceUnit] (selects the SI metres→km/mi/ft conversion + the unit label appended to the Total
 * Range card) and the [locale] (drives the count-up grouping/separators). Battery is a unitless percent
 * and the counts are integers, so no other preference is required.
 */
data class FleetSummaryDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val locale: Locale,
) {
    companion object {
        /** Metric default used before settings load / in previews (matches the web metric default). */
        val METRIC_DEFAULT = FleetSummaryDisplayPrefs(DistanceUnitPref.KM, Locale.US)

        /**
         * Projects the live [UnitPref] (resolved from the shared settings store, the web `useUnits`
         * boundary) onto this surface's needs: the distance unit drives the range conversion + label,
         * and the locale tag becomes a [Locale] (blank → en-US, mirroring the web default).
         */
        fun fromUnitPref(pref: UnitPref): FleetSummaryDisplayPrefs {
            val tag = pref.locale
            val locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
            return FleetSummaryDisplayPrefs(distanceUnit = pref.distance, locale = locale)
        }
    }
}

/**
 * The decoded, still-SI fleet aggregate — the native grouping of the four figures the web component
 * derives from the enrolled list + the per-vehicle states, before any unit conversion or rounding.
 *
 * @property vehicleCount the enrolled-vehicle total (web `vehicles.length`).
 * @property avgBatteryPercent the mean `battery_level` over the present states (0–100, unitless), or
 *   `0.0` when no state has resolved (web `states.length > 0 ? Σ/len : 0`).
 * @property totalRangeMeters the summed `rated_range` in SI metres (web `Σ (rated_range ?? 0)`;
 *   converted to the user's unit only at the projection — Phase-48 SI-canonical rule).
 * @property chargingCount the number of present states with `is_charging` true (web `chargingCount`).
 * @property onlineCount the number of present (non-null) states (web `onlineCount = states.length`).
 */
data class FleetSummaryData(
    val vehicleCount: Int,
    val avgBatteryPercent: Double,
    val totalRangeMeters: Double,
    val chargingCount: Int,
    val onlineCount: Int,
) {
    companion object {
        /** The zero-valued aggregate the web `?? 0` fall-throughs collapse to (the friendly empty grid). */
        val EMPTY = FleetSummaryData(0, 0.0, 0.0, 0, 0)
    }
}

/**
 * The fully projected, render-ready view — the native analogue of the figures the web component hands to
 * its four `AnimatedNumber`s. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host. The numeric figures are the count-up targets (the composable formats + animates them, mirroring
 * the web `AnimatedNumber`).
 *
 * @property vehicleCount the enrolled count (Vehicles card value).
 * @property avgBattery the fleet-average battery percent, pre-rounded (web `Math.round`).
 * @property totalRange the summed range converted to [rangeUnit] and pre-rounded (web `Math.round`).
 * @property rangeUnit the distance unit short label appended to the Total Range label (web `unitPrefs.distance`).
 * @property chargingCount the number of charging vehicles (Charging/Online card primary value).
 * @property onlineCount the number of online vehicles (Charging/Online card `/ {onlineCount}` subscript).
 */
data class FleetSummaryDisplay(
    val vehicleCount: Double,
    val avgBattery: Double,
    val totalRange: Double,
    val rangeUnit: String,
    val chargingCount: Double,
    val onlineCount: Int,
)

/**
 * Pure aggregation from the enrolled count + the decoded per-vehicle states to the still-SI
 * [FleetSummaryData] — a 1:1 port of the web component's inline reductions over the `useQuery` result
 * (the `?? 0` guards, the mean, the metre sum, and the `is_charging` / present-state counts).
 */
object FleetSummaryAggregator {
    /** Aggregate the [decodedStates] for an enrolled fleet of [vehicleCount] vehicles. */
    fun aggregate(
        vehicleCount: Int,
        decodedStates: List<VehicleState>,
    ): FleetSummaryData {
        val onlineCount = decodedStates.size
        val avgBattery =
            if (decodedStates.isEmpty()) {
                0.0
            } else {
                decodedStates.map { it.batteryLevel }.average()
            }
        val totalRangeMeters = decodedStates.sumOf { it.ratedRange }
        val chargingCount = decodedStates.count { it.isCharging }
        return FleetSummaryData(
            vehicleCount = vehicleCount,
            avgBatteryPercent = avgBattery,
            totalRangeMeters = totalRangeMeters,
            chargingCount = chargingCount,
            onlineCount = onlineCount,
        )
    }
}

/**
 * Pure projection from a decoded [FleetSummaryData] to its render-ready [FleetSummaryDisplay] — the
 * native port of the web JSX derivations: the counts pass through as whole numbers, the average battery
 * and the SI-metres range are converted (range only) and `Math.round`-ed so the count-up target is the
 * exact integer the web renders.
 */
object FleetSummaryProjection {
    /** Project [data] for the given display [prefs]. */
    fun project(
        data: FleetSummaryData,
        prefs: FleetSummaryDisplayPrefs,
    ): FleetSummaryDisplay =
        FleetSummaryDisplay(
            vehicleCount = data.vehicleCount.toDouble(), // parity:allow toDouble substring false positive
            avgBattery = roundHalfUp(data.avgBatteryPercent),
            totalRange = roundHalfUp(convertDistanceFromSI(data.totalRangeMeters, prefs.distanceUnit)),
            rangeUnit = prefs.distanceUnit.label,
            chargingCount = data.chargingCount.toDouble(), // parity:allow toDouble substring false positive
            onlineCount = data.onlineCount,
        )

    /**
     * Rounds to the nearest whole number with ties going to positive infinity — the exact semantics of
     * the web `Math.round` the component applies before handing the figure to `AnimatedNumber`. The
     * inputs (a 0–100 percent, a non-negative range) are always finite and non-negative here.
     */
    fun roundHalfUp(value: Double): Double = value.roundToLong().toDouble() // parity:allow toDouble substring false positive
}

/**
 * Folds the two cache-then-network feeds this surface binds — the enrolled [vehicles] list and the
 * per-vehicle [states] — into one [UiState] surface, reproducing the web cache-then-network contract the
 * per-surface parity rule mandates:
 *  - the enrolled-list feed first-loading with nothing cached ⇒ [UiPhase.Loading] (skeleton grid);
 *  - a hard enrolled-list failure with nothing cached ⇒ [UiPhase.Error] (retry surface);
 *  - otherwise ⇒ [UiPhase.Content] showing the four-card grid. With no vehicles / no states every figure
 *    is zero (web `?? 0`) and the labelled cards still render — the friendly empty surface, not a blank
 *    box, so an empty fleet is a zero-valued grid rather than a hidden one.
 *
 * Freshness is honest: while showing cached content after a failed refresh (the enrolled list OR any
 * per-vehicle state) the surface is flagged [UiState.stale] + carries the [ErrorKind] so the UI shows an
 * "offline / last known" chip + retry instead of presenting stale data as live. The [UiState.fetchedAt]
 * stamp is the OLDEST contributing stamp so the freshness label reflects the staleness of the whole
 * aggregate, never just the newest feed.
 */
fun combineFleetSummary(
    vehicles: Resource<List<Vehicle>>,
    states: List<Resource<VehicleStateEnvelope>>,
): UiState<FleetSummaryData> {
    val vehicleCount = vehicles.cached?.size ?: 0
    val decodedStates = states.mapNotNull { it.cached?.state }
    val data = FleetSummaryAggregator.aggregate(vehicleCount, decodedStates)

    val phase =
        when {
            vehicles.isFirstLoading() -> UiPhase.Loading
            vehicles.isHardError() -> UiPhase.Error
            else -> UiPhase.Content
        }

    // The enrolled-list failure owns the error surface; a per-vehicle state failure only degrades the
    // already-rendered cards to "offline / last known", so it feeds the stale/retry affordance, not the
    // hard-error screen.
    val combinedError = (vehicles as? Resource.Error) ?: states.firstNotNullOfOrNull { it as? Resource.Error }
    val stale = phase == UiPhase.Content && (vehicles.isStaleSource() || states.any { it.isStaleSource() })
    val refreshing = vehicles.isBackgroundRefreshing() || states.any { it.isBackgroundRefreshing() }
    val stamps = (listOf(vehicles.fetchedAtOrNull()) + states.map { it.fetchedAtOrNull() }).filterNotNull()

    return UiState(
        phase = phase,
        data = if (phase == UiPhase.Content) data else null,
        fetchedAt = stamps.minOrNull(),
        stale = stale,
        refreshing = refreshing,
        errorKind = combinedError?.let { errorKindOf(it.error) },
        httpStatus = combinedError?.let { httpStatusOf(it.error) },
    )
}

/** A first load in flight with nothing cached to show (web parent `isLoading`). */
private fun Resource<*>.isFirstLoading(): Boolean = this is Resource.Loading && cached == null

/** A hard failure with no cached value to fall back on (web parent `error` short-circuit). */
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
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * fleet size, battery level, range, or charging count — so a diagnostics line can never leak the fleet's
 * behaviour or posture.
 */
object FleetSummaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "FleetSummary"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Called once from the view-model. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
