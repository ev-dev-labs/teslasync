// The pure, framework-free model + projection for the DrivingPerformanceCards feature view — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx). No Compose, no Android,
// no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the fleet analytics page) fetches the
// `FleetAnalytics` document and passes it down as the `data` prop. From `data.drive_analytics` it reads
// four optional stat groups (speed, power, regen, distance) and renders six MetricCards: Top Speed and Avg
// Speed (from speed_stats, backend km/h), Peak Power and Peak Regen (from power_stats / regen_stats, kW),
// and Avg Drive Distance and Longest Drive (from distance_stats, backend km). Each card shows an em dash
// when its stat group is absent, otherwise the `safe()`-guarded value converted to the user's display unit.
//
// This file owns the parts the web component expresses from those props: the native slice of the
// drive-analytics payload it consumes, the lifecycle projection of (snapshot, isLoading) onto the shared
// cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the ordered
// six-tile value list with the web `fromKmh` / `fromKm` conversions and `fmtNumber` formatting (delegated
// to the golden-pinned shared SI formatters, P1/S9), and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/DrivingPerformanceCards — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingperformancecards

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatPower
import io.teslasync.shared.core.units.formatSpeed

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this analytics panel.
 */
const val DRIVING_PERFORMANCE_CARDS_SLUG: String = "DrivingPerformanceCards"

/** 1 km = 1000 m (the backend `distance_stats` is km; the SI floor the shared formatter expects is metres). */
private const val METERS_PER_KM = 1000.0

/** Seconds per hour (the backend `speed_stats` is km/h; the SI floor is m/s). */
private const val SECONDS_PER_HOUR = 3600.0

/** 1 kW = 1000 W (the backend power/regen stats are kW; the SI floor the shared formatter expects is watts). */
private const val WATTS_PER_KW = 1000.0

/** Web `fmtNumber(value, 0)` precision for the two speed tiles. */
private const val SPEED_DECIMALS = 0

/** Web `fmtNumber(value, 0)` precision for the power and regen tiles. */
private const val POWER_DECIMALS = 0

/** Web `fmtNumber(value, 1)` precision for the two distance tiles. */
private const val DISTANCE_DECIMALS = 1

/** Em dash shown for an absent stat group — mirrors the web `'—'` fallback. */
private const val EM_DASH = "\u2014"

/**
 * The two summary fields this surface reads from a web `StatsSummary` (web/src/api/types.ts): the per-group
 * average and maximum. Both are nullable so the native `safe()` guard reproduces the web defensive `safe()`
 * (a null/NaN value becomes 0); the web component reads only `.avg` and `.max`.
 */
data class DriveStatSummary(
    val avg: Double?,
    val max: Double?,
)

/**
 * The native slice of `FleetAnalytics.drive_analytics` the surface consumes: the four optional stat groups
 * the web component reads. A null group renders its card(s) with an em dash (web `ss ? … : '—'`); a present
 * group with null fields renders `safe()`-guarded zeros, exactly like the web.
 */
data class DrivingPerformanceSnapshot(
    val speedStats: DriveStatSummary?,
    val powerStats: DriveStatSummary?,
    val regenStats: DriveStatSummary?,
    val distanceStats: DriveStatSummary?,
)

/**
 * The six metric tiles the web component renders, in source order. Identity only — the localized label, the
 * line glyph, and the accent color are resolved at the Compose boundary, keeping this enum free of any
 * Android or i18n dependency so it stays unit-testable off-device.
 */
enum class DrivingMetric {
    TopSpeed,
    AvgSpeed,
    PeakPower,
    PeakRegen,
    AvgDriveDistance,
    LongestDrive,
}

/** One render-ready tile: its [metric] identity, the already-formatted [value], and the [subtitle] unit. */
data class DrivingMetricValue(
    val metric: DrivingMetric,
    val value: String,
    val subtitle: String,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's per-card
 * branch (`ss ? fmtNumber(fromKmh(safe(ss.max)), 0) : '—'`) and its `fromKmh` / `fromKm` conversions.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, glyphs, and accents and draws what these return.
 */
object DrivingPerformanceCardsProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: DrivingPerformanceSnapshot?,
        isLoading: Boolean,
    ): UiState<DrivingPerformanceSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six tile values in web source order, each already formatted for [prefs] (the user's display units,
     * web `useUnits`). Speed converts km/h → m/s → display speed (web `fromKmh`); distance converts km →
     * metres → display distance (web `fromKm`); power/regen are shown as raw kW with no conversion (web
     * subtitle `"kW"`). Number formatting is delegated to the golden-pinned shared SI formatters; the unit
     * label is carried separately in [DrivingMetricValue.subtitle] so the tile mirrors the web composition
     * (value = number, subtitle = unit). A null stat group yields an em dash, matching the web `'—'`.
     */
    fun metricValues(
        snapshot: DrivingPerformanceSnapshot,
        prefs: UnitPref,
    ): List<DrivingMetricValue> {
        val speedLabel = prefs.speed.label
        val distanceLabel = prefs.distance.label
        val powerLabel = prefs.power.label
        val ss = snapshot.speedStats
        val ps = snapshot.powerStats
        val rs = snapshot.regenStats
        val ds = snapshot.distanceStats
        return listOf(
            DrivingMetricValue(
                metric = DrivingMetric.TopSpeed,
                value = if (ss != null) speedValue(safe(ss.max), prefs) else EM_DASH,
                subtitle = speedLabel,
            ),
            DrivingMetricValue(
                metric = DrivingMetric.AvgSpeed,
                value = if (ss != null) speedValue(safe(ss.avg), prefs) else EM_DASH,
                subtitle = speedLabel,
            ),
            DrivingMetricValue(
                metric = DrivingMetric.PeakPower,
                value = if (ps != null) powerValue(safe(ps.max), prefs) else EM_DASH,
                subtitle = powerLabel,
            ),
            DrivingMetricValue(
                metric = DrivingMetric.PeakRegen,
                value = if (rs != null) powerValue(safe(rs.max), prefs) else EM_DASH,
                subtitle = powerLabel,
            ),
            DrivingMetricValue(
                metric = DrivingMetric.AvgDriveDistance,
                value = if (ds != null) distanceValue(safe(ds.avg), prefs) else EM_DASH,
                subtitle = distanceLabel,
            ),
            DrivingMetricValue(
                metric = DrivingMetric.LongestDrive,
                value = if (ds != null) distanceValue(safe(ds.max), prefs) else EM_DASH,
                subtitle = distanceLabel,
            ),
        )
    }

    /** Web `fromKmh`: backend km/h → SI m/s → display speed, formatted at 0 decimals (web `fmtNumber(_, 0)`). */
    private fun speedValue(
        kmh: Double,
        prefs: UnitPref,
    ): String {
        val mps = kmh * METERS_PER_KM / SECONDS_PER_HOUR
        return stripUnit(formatSpeed(mps, prefs, SPEED_DECIMALS), prefs.speed.label)
    }

    /** Web `fromKm`: backend km → SI metres → display distance, formatted at 1 decimal (web `fmtNumber(_, 1)`). */
    private fun distanceValue(
        km: Double,
        prefs: UnitPref,
    ): String {
        val meters = km * METERS_PER_KM
        return stripUnit(formatDistance(meters, prefs, DISTANCE_DECIMALS), prefs.distance.label)
    }

    /**
     * Web shows raw kW with a fixed `"kW"` unit and no conversion. Routing the kW value through the shared
     * power formatter (kW → watts → the always-kW power preference round-trips exactly) reuses the
     * golden-pinned number formatting at 0 decimals (web `fmtNumber(_, 0)`).
     */
    private fun powerValue(
        kw: Double,
        prefs: UnitPref,
    ): String {
        val watts = kw * WATTS_PER_KW
        return stripUnit(formatPower(watts, prefs, POWER_DECIMALS), prefs.power.label)
    }

    /**
     * The shared SI formatters return `"<number> <label>"`; the surface renders the unit in the MetricCard
     * subtitle (web composition), so keep the number only by removing the known trailing unit label. Inputs
     * are always finite (guarded by [safe]), so the formatter never returns its em-dash fallback here.
     */
    private fun stripUnit(
        formatted: String,
        unitLabel: String,
    ): String = formatted.removeSuffix(" $unitLabel")

    /** Web `safe()` (components/charts): the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DRIVING_PERFORMANCE_CARDS_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordDrivingPerformanceCardsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DRIVING_PERFORMANCE_CARDS_SLUG))
}
