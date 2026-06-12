// Pure, framework-free model + projection for the FleetStatsBar feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/FleetStatsBar.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// FleetStatsBar is a presentational surface — the web component's only hook is `useTranslation`; the owning
// Dashboard page threads everything else in as props (the fleet analytics, the vehicle/online/unread-alert
// counts, the recent drives/charges, and the `useUnits` distance/efficiency converters + unit labels). So
// this surface binds NO data feed: like the committed SummaryStatsRow / QuickMetrics siblings, the
// cache-then-network states (loading skeleton / hard fetch-error / stale / offline) live on the owning page
// (which owns the TanStack queries and their `<QueryError>` / skeleton chrome), NOT on this presentational
// bar. The branches the web source itself defines are the complete state set reproduced here:
//   • the always-on five-card grid (Fleet Size, Distance, Energy, Efficiency, Alerts) — every card renders
//     even with no data, showing zeros (web `?? 0`) and a flat trend (web `?? [0]`), never a blank box, so
//     the "empty / no value" state is a friendly zero-valued surface rather than a hidden one;
//   • the Alerts colour branch (web `unreadAlerts > 0 ? red : emerald`).
//
// The one place a real shared P1/S8 state holder is bound is the unit preference: the composable reads the
// live `UnitFormatter` (the web `useUnits` boundary) from the settings store and hands its
// [io.teslasync.shared.core.units.UnitPref] here. This file owns the SI→display conversions the web parent
// performs (Phase-48 SI-canonical rule):
//   • distance — `total_distance_km` is SI metres on the wire (the field name is legacy; the committed
//     FleetStatsBarWidget reads the same `/analytics/fleet` field as SI and feeds it to
//     `convertDistanceFromSI`), converted to the user's km/mi and labelled with the unit's short label;
//   • efficiency — `avg_efficiency_wh_km` is Wh/km (derived SI); the canonical web converter is
//     `mi ? whPerKm * 1.609344 : whPerKm` with the `Wh/mi` / `Wh/km` label (web DriveScoreWidget /
//     WeeklyDigestWidget / RouteEfficiencyWidget all read this same field this exact way);
//   • energy — `total_energy_kwh` is already kWh on the wire, rendered with one decimal + the literal `kWh`.
// Values stay SI/raw until the projection; the rendered figures count up exactly as the web `AnimatedNumber`
// does (the composable owns the animation + locale formatting, so this model carries render-ready Doubles,
// not pre-formatted strings).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FleetStatsBar — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetstatsbar

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale

/** Web `<AnimatedNumber value={...} />` default precision (no `decimals` prop) — whole numbers. */
internal const val DISTANCE_DECIMALS: Int = 0

/** Web Fleet-Size / Alerts counts render as whole numbers (web `<AnimatedNumber>` default). */
internal const val COUNT_DECIMALS: Int = 0

/** Web `<AnimatedNumber value={totalEnergy} decimals={1} suffix=" kWh" />`. */
internal const val ENERGY_DECIMALS: Int = 1

/** Web Efficiency `<AnimatedNumber>` default precision (no `decimals` prop) — whole numbers. */
internal const val EFFICIENCY_DECIMALS: Int = 0

/** Web hard-coded energy unit suffix on the Energy card (`suffix=" kWh"`). */
internal const val ENERGY_UNIT: String = "kWh"

/** Metric efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
internal const val EFFICIENCY_UNIT_KM: String = "Wh/km"

/** Imperial efficiency unit label (web `'Wh/mi'`). */
internal const val EFFICIENCY_UNIT_MI: String = "Wh/mi"

/** 1 mile = 1.609344 km exactly: Wh/km → Wh/mi scales by km-per-mile (web `whPerKm * 1.609344`). */
internal const val KM_PER_MILE: Double = 1.609344

/**
 * The flat single-point trend the web falls back to when a series is absent (`recent…?.map(...) ?? [0]`).
 * A one-element series renders no line (both the web and native MiniChart need ≥2 points), so this models
 * the web's "no recent activity" trend without inventing data.
 */
internal val EMPTY_TREND: List<Double> = listOf(0.0)

/**
 * The trailing-30-day fleet analytics this surface reads — the three `FleetAnalytics` fields the web
 * component consumes (web/src/features/dashboard/types.ts). `null` at the [FleetStatsBarInput] level models
 * the web `analytics` being `undefined`, in which case every derived figure falls back to `0` (web `?? 0`).
 *
 * @property totalDistanceSI `total_distance_km` — SI metres on the wire (legacy field name; converted at the
 *   display boundary via [convertDistanceFromSI], exactly as the committed FleetStatsBarWidget reads it).
 * @property totalEnergyKwh `total_energy_kwh` — already kWh on the wire (rendered directly with one decimal).
 * @property avgEfficiencyWhKm `avg_efficiency_wh_km` — Wh/km (derived SI); converted to Wh/mi for imperial.
 */
data class FleetAnalyticsSnapshot(
    val totalDistanceSI: Double,
    val totalEnergyKwh: Double,
    val avgEfficiencyWhKm: Double,
)

/**
 * The complete prop set the owning Dashboard page threads into this surface — the native grouping of the web
 * component's `analytics` / `vehicleCount` / `onlineCount` / `unreadAlerts` / `recentDrives` / `recentCharges`
 * props (the `useUnits` converters + unit labels are passed alongside as [FleetStatsBarDisplayPrefs], not
 * bundled here). Grouping the cohesive inputs keeps [FleetStatsBarProjection.project] small and gives the
 * adapter test a single value to thread.
 *
 * @property analytics the trailing-30-day fleet totals, or `null` when the analytics query has no data
 *   (web `analytics: FleetAnalytics | undefined`); `null` collapses every analytic figure to `0`.
 * @property vehicleCount enrolled-vehicle total (web `vehicleCount`).
 * @property onlineCount online-vehicle count shown in the Fleet-Size subtext (web `onlineCount`).
 * @property unreadAlerts unread-alert count (web `unreadAlerts`); `> 0` drives the danger colour.
 * @property recentDriveDistancesM the recent drives' `distance_m` values in the API's order (newest-first);
 *   the projection reverses them for the left-to-right trend, exactly as the web `.map(...).reverse()` does.
 * @property recentChargeEnergyWh the recent charges' `total_energy_added_wh` values in the API's order.
 */
data class FleetStatsBarInput(
    val analytics: FleetAnalyticsSnapshot?,
    val vehicleCount: Int,
    val onlineCount: Int,
    val unreadAlerts: Int,
    val recentDriveDistancesM: List<Double> = emptyList(),
    val recentChargeEnergyWh: List<Double> = emptyList(),
)

/**
 * The user's display preferences this surface needs — the native port of the web parent's `useUnits` read:
 * the [distanceUnit] (selects the SI metres→km/mi conversion + the unit label) and the [locale] (drives the
 * count-up grouping/separators). Energy is rendered in the literal `kWh` the web hard-codes and efficiency
 * is derived from [distanceUnit], so no other preference is required.
 */
data class FleetStatsBarDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val locale: Locale,
) {
    companion object {
        /** Metric default used before settings load / in previews (matches the web metric default). */
        val METRIC_DEFAULT = FleetStatsBarDisplayPrefs(DistanceUnitPref.KM, Locale.US)

        /**
         * Projects the live [UnitPref] (resolved from the shared settings store, the web `useUnits` boundary)
         * onto this surface's needs: the distance unit drives both the distance conversion and the efficiency
         * label, and the locale tag becomes a [Locale] (blank → en-US, mirroring the web default).
         */
        fun fromUnitPref(pref: UnitPref): FleetStatsBarDisplayPrefs {
            val tag = pref.locale
            val locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
            return FleetStatsBarDisplayPrefs(distanceUnit = pref.distance, locale = locale)
        }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host. The
 * numeric figures are the count-up targets (the composable formats + animates them, mirroring the web
 * `AnimatedNumber`); the trend series feed the two MiniCharts.
 *
 * @property fleetSize the enrolled-vehicle count (Fleet-Size card value).
 * @property onlineCount the online count shown in the Fleet-Size subtext.
 * @property distanceValue the trailing-30-day distance converted to [distanceUnit].
 * @property distanceUnit the distance unit short label (e.g. `km` / `mi`), appended to the distance value.
 * @property distanceTrend the recent-drive distances, reversed (web `.reverse()`), or [EMPTY_TREND].
 * @property energyKwh the trailing-30-day energy in kWh (rendered with one decimal + a literal `kWh`).
 * @property energyTrend the recent-charge energies, reversed, or [EMPTY_TREND].
 * @property efficiencyValue the fleet-average efficiency converted to [efficiencyUnit].
 * @property efficiencyUnit `Wh/km` (metric) or `Wh/mi` (imperial).
 * @property unreadAlerts the unread-alert count (Alerts card value).
 * @property alertsActive whether any alert is unread (web `unreadAlerts > 0`) — selects danger vs success.
 */
data class FleetStatsBarDisplay(
    val fleetSize: Int,
    val onlineCount: Int,
    val distanceValue: Double,
    val distanceUnit: String,
    val distanceTrend: List<Double>,
    val energyKwh: Double,
    val energyTrend: List<Double>,
    val efficiencyValue: Double,
    val efficiencyUnit: String,
    val unreadAlerts: Int,
    val alertsActive: Boolean,
)

/**
 * Pure projection from the surface's props to its render-ready [FleetStatsBarDisplay] — a 1:1 port of the
 * derivations the web component performs: the `analytics?.x ?? 0` fall-throughs, the `toDistanceDisplay` /
 * `toEfficiencyDisplay` SI→display conversions, the energy passthrough, the reversed trend series with the
 * `?? [0]` fallback, and the `unreadAlerts > 0` colour gate.
 */
object FleetStatsBarProjection {
    /** Project [input] for the given display [prefs]. */
    fun project(
        input: FleetStatsBarInput,
        prefs: FleetStatsBarDisplayPrefs,
    ): FleetStatsBarDisplay {
        val analytics = input.analytics
        return FleetStatsBarDisplay(
            fleetSize = input.vehicleCount,
            onlineCount = input.onlineCount,
            distanceValue = convertDistanceFromSI(analytics?.totalDistanceSI ?: 0.0, prefs.distanceUnit),
            distanceUnit = prefs.distanceUnit.label,
            distanceTrend = trend(input.recentDriveDistancesM),
            energyKwh = analytics?.totalEnergyKwh ?: 0.0,
            energyTrend = trend(input.recentChargeEnergyWh),
            efficiencyValue = toEfficiencyDisplay(analytics?.avgEfficiencyWhKm ?: 0.0, prefs.distanceUnit),
            efficiencyUnit = efficiencyUnitLabel(prefs.distanceUnit),
            unreadAlerts = input.unreadAlerts,
            alertsActive = input.unreadAlerts > 0,
        )
    }

    /**
     * Convert a Wh/km efficiency to the user's display unit — the canonical web converter
     * (`unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm`). A mile is longer than a km, so the
     * per-mile figure scales up by [KM_PER_MILE]; metric is the identity.
     */
    fun toEfficiencyDisplay(
        whPerKm: Double,
        distanceUnit: DistanceUnitPref,
    ): Double = if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

    /** The efficiency unit label for [distanceUnit] (web `distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    fun efficiencyUnitLabel(distanceUnit: DistanceUnitPref): String =
        if (distanceUnit == DistanceUnitPref.MI) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM

    /**
     * The left-to-right trend series for a MiniChart — the recent values reversed (web `.map(...).reverse()`)
     * or the flat [EMPTY_TREND] when there are none (web `?? [0]`). A single-point series intentionally draws
     * no line on either platform, faithfully reproducing the web "no recent activity" trend.
     */
    fun trend(values: List<Double>): List<Double> = if (values.isEmpty()) EMPTY_TREND else values.reversed()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * fleet size, distance, energy, efficiency, or unread-alert count — so a diagnostics line can never leak the
 * fleet's behaviour or posture.
 */
object FleetStatsBarDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "FleetStatsBar"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
