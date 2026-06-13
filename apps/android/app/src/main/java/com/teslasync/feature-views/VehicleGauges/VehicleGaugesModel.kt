// Pure, framework-free model + projection for the Vehicle Gauges feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/VehicleGauges.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (the vehicle detail page) loads the vehicle + its
// live state and passes them down; VehicleGauges then renders a stylized car visualization beside four radial
// gauges (battery / range / speed / power), two-to-three metric bars (battery level, estimated range, and
// charge rate while charging), and four status chips (lock, sentry, climate, firmware). This file owns the
// parts the web derives from those props: the gauge specs, the metric-bar specs, the status-chip specs, the
// car-viz projection, and the accessible summary. Values stay SI on the wire; the SI -> display conversion
// happens here through the injected [UnitFormatter] (the web `useUnits` boundary), never by mutating the
// source — the Phase-48 SI-canonical contract.
//
// Gauge maxima are expressed in SI and converted with the same factor as the value, so the radial fill
// reflects the same physical quantity regardless of the user's km/h-vs-mph or km-vs-mi preference (a verbatim
// port of the web `MAX_RANGE_METERS` / `MAX_SPEED_MPS` / `MAX_CHARGE_RATE_METERS_PER_HOUR` rationale).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleGauges — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclegauges

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.util.Locale
import kotlin.math.roundToInt

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Metres per mile (web `1609.344`), the bridge for the range + charge-rate SI maxima. */
internal const val METERS_PER_MILE: Double = 1609.344

/** Metres-per-second per mile-per-hour (web `0.44704`), the bridge for the speed SI maximum. */
internal const val MPS_PER_MPH: Double = 0.44704

/** 600 mi practical rated-range ceiling, in SI metres (web `MAX_RANGE_METERS`). */
internal const val MAX_RANGE_METERS: Double = 600.0 * METERS_PER_MILE

/** 250 mph practical vehicle-speed ceiling, in SI metres-per-second (web `MAX_SPEED_MPS`). */
internal const val MAX_SPEED_MPS: Double = 250.0 * MPS_PER_MPH

/** 100 mph supercharger-class charge-rate ceiling, in SI metres-per-hour (web `MAX_CHARGE_RATE_*`). */
internal const val MAX_CHARGE_RATE_METERS_PER_HOUR: Double = 100.0 * METERS_PER_MILE

/** Battery / charge-power gauge maxima (web `RadialGauge max=…`). */
internal const val BATTERY_MAX: Double = 100.0
internal const val POWER_MAX: Double = 250.0

/** Battery-color thresholds — web `batteryColor`: `>60` good, `>25` warning, else bad. */
internal const val BATTERY_GOOD_THRESHOLD: Int = 60
internal const val BATTERY_WARN_THRESHOLD: Int = 25

/** Universal unit symbols rendered verbatim regardless of locale (web `unit="%"`, `unit="kW"`, `/h`). */
internal const val GAUGE_PERCENT: String = "%"
internal const val GAUGE_KW: String = "kW"
internal const val GAUGE_PER_HOUR: String = "/h"

/** Per-call render precision — the gauges + battery bar show whole units (web `fmtNumber(…, 0)`). */
internal const val WHOLE_DECIMALS: Int = 0

/** The accessible-summary separator (web reads each cue in sequence). */
internal const val SUMMARY_SEPARATOR: String = ", "

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The two props the web component composes, folded into one render payload: the resolved [vehicle] (web
 * `vehicle` — the source of the model key the car visualization parses) and its live [state] (web `state` —
 * battery / range / speed / power / lock / sentry / climate / charge / firmware). Either being `null` is the
 * surface's empty state (the web parent renders VehicleGauges only once both are loaded).
 */
data class VehicleGaugesData(
    val vehicle: Vehicle?,
    val state: VehicleState?,
)

/**
 * The design-token accent a gauge / bar / chip resolves to at the render boundary. Kept Compose-free (mapped
 * to a `Color` by the view) so the whole projection is asserted off-device. The roles mirror the web hex
 * palette: [Info] = `#00f0ff` (CYAN), [Power] = `#a855f7` (PURPLE), [Success] = `#10b981`, [Danger] =
 * `#ef4444`, [Warning] = `#f59e0b`, [Neutral] = the muted `#6b7280` / `#374151` "off" tone.
 */
enum class GaugeAccent { Info, Power, Success, Danger, Warning, Neutral }

/** Which status-chip glyph a chip carries (mapped to an `ImageVector` by the view; web lucide icons). */
enum class GaugeChipGlyph { Lock, Unlock, Shield, Wind, Cpu }

/**
 * One radial-gauge spec — the native mirror of a web `<RadialGauge value max label unit color>`. [value] and
 * [max] are already in the user's display unit (the range + speed pair are pre-rounded to whole units exactly
 * as the web `Math.round` does, so the fill fraction matches); [unit] + [label] reproduce the web props;
 * [accent] selects the arc color.
 */
data class GaugeSpec(
    val key: String,
    val label: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val accent: GaugeAccent,
)

/**
 * One metric-bar spec — the native mirror of a web `<MetricBar value max color label sublabel>`. [value] /
 * [max] are in the user's display unit (the bar fill); [valueText] is the web `sublabel` (already formatted
 * via the live units boundary); [accent] tints the fill + value text.
 */
data class MetricBarSpec(
    val key: String,
    val label: String,
    val value: Double,
    val max: Double,
    val valueText: String,
    val accent: GaugeAccent,
)

/**
 * One status-chip spec — the native mirror of a web quick-info chip (`{ icon, label, color }`). [label] is the
 * already-localized on/off text (or the firmware version); [glyph] + [accent] select the icon + its tint.
 */
data class StatusChipSpec(
    val key: String,
    val label: String,
    val glyph: GaugeChipGlyph,
    val accent: GaugeAccent,
)

/**
 * The car-visualization projection — the native mirror of the web `<TeslaCarViz …>` props. [speedText] is
 * pre-formatted (the native car-viz takes a string), present only while driving (web `speed > 0`); [model] is
 * the raw model string the car-viz parses into a body silhouette.
 */
data class CarVizSpec(
    val batteryLevelPct: Double,
    val isCharging: Boolean,
    val isLocked: Boolean,
    val isClimateOn: Boolean,
    val sentryMode: Boolean,
    val speedText: String?,
    val model: String?,
)

/**
 * The already-localized microcopy the surface folds into its output — every `t('common.*')` key the web
 * component resolves, plus the [unknown] firmware fallback. The web renders a blank firmware as the literal
 * `'N/A'`; to keep native free of hard-coded English (the i18n contract) the fallback is resolved from the
 * existing `common.unknown` catalog entry — a documented, non-silent divergence from the web literal.
 */
data class VehicleGaugesStrings(
    val battery: String,
    val range: String,
    val speed: String,
    val power: String,
    val batteryLevel: String,
    val estimatedRange: String,
    val chargeRate: String,
    val locked: String,
    val unlocked: String,
    val sentryOn: String,
    val sentryOff: String,
    val climateOn: String,
    val climateOff: String,
    val unknown: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host. [bars] holds
 * two entries when idle and three while charging (the web `is_charging && <MetricBar charge rate/>` branch);
 * [chips] is always the four quick-info chips; [carViz] is always present.
 */
data class VehicleGaugesDisplay(
    val carViz: CarVizSpec,
    val gauges: List<GaugeSpec>,
    val bars: List<MetricBarSpec>,
    val chips: List<StatusChipSpec>,
    val accessibleSummary: String,
)

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object VehicleGaugesRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleGauges"
}

/** The web `batteryColor(level)` thresholds, mapped to a design-token accent role. */
internal fun batteryAccent(batteryLevel: Long): GaugeAccent =
    when {
        batteryLevel > BATTERY_GOOD_THRESHOLD -> GaugeAccent.Success
        batteryLevel > BATTERY_WARN_THRESHOLD -> GaugeAccent.Warning
        else -> GaugeAccent.Danger
    }

/** Rounds a display value to a whole unit the way the web `Math.round` does (ties toward positive infinity). */
internal fun roundWhole(value: Double): Double = value.roundToInt() * 1.0

/**
 * Pure projection from the surface's two props + the live units boundary to its render-ready
 * [VehicleGaugesDisplay] — a 1:1 port of the derivations the web component performs. The composable resolves
 * [VehicleGaugesStrings] from the i18n catalog and the live [UnitFormatter] from settings, then hands them
 * here.
 */
object VehicleGaugesProjection {
    /**
     * Projects [vehicle] + [state] for the live [formatter] into the render-ready [VehicleGaugesDisplay].
     * Reproduces the web derivations verbatim: the SI gauge maxima converted with the same factor as their
     * value, the `Math.round`-ed range + speed pairs, the battery-color thresholds, the charging-only charge-
     * rate bar, and the four quick-info chips. [locale] formats the numeric values (web `Intl.NumberFormat`).
     */
    fun project(
        vehicle: Vehicle,
        state: VehicleState,
        formatter: UnitFormatter,
        strings: VehicleGaugesStrings,
        locale: Locale,
    ): VehicleGaugesDisplay {
        val chips = buildChips(state, strings)
        return VehicleGaugesDisplay(
            carViz = buildCarViz(vehicle, state, formatter),
            gauges = buildGauges(state, formatter, strings),
            bars = buildBars(state, formatter, strings, locale),
            chips = chips,
            accessibleSummary = buildAccessibleSummary(state, formatter, strings, chips, locale),
        )
    }

    /** Projects the [TeslaCarViz] props (web `<TeslaCarViz …>`); the speed readout shows only while driving. */
    private fun buildCarViz(
        vehicle: Vehicle,
        state: VehicleState,
        formatter: UnitFormatter,
    ): CarVizSpec =
        CarVizSpec(
            batteryLevelPct = state.batteryLevel * 1.0,
            isCharging = state.isCharging,
            isLocked = state.isLocked,
            isClimateOn = state.isClimateOn,
            sentryMode = state.sentryMode,
            speedText = if (state.speed > 0.0) formatter.speed(state.speed) else null,
            model = vehicle.model,
        )

    /** The four radial gauges (web battery / range / speed / power), range + speed pre-rounded like the web. */
    private fun buildGauges(
        state: VehicleState,
        formatter: UnitFormatter,
        strings: VehicleGaugesStrings,
    ): List<GaugeSpec> {
        val prefs = formatter.prefs
        return listOf(
            GaugeSpec(
                key = "battery",
                label = strings.battery,
                value = state.batteryLevel * 1.0,
                max = BATTERY_MAX,
                unit = GAUGE_PERCENT,
                accent = batteryAccent(state.batteryLevel),
            ),
            GaugeSpec(
                key = "range",
                label = strings.range,
                value = roundWhole(convertDistanceFromSI(state.ratedRange, prefs.distance)),
                max = roundWhole(convertDistanceFromSI(MAX_RANGE_METERS, prefs.distance)),
                unit = prefs.distance.label,
                accent = GaugeAccent.Info,
            ),
            GaugeSpec(
                key = "speed",
                label = strings.speed,
                value = roundWhole(convertSpeedFromSI(state.speed, prefs.speed)),
                max = roundWhole(convertSpeedFromSI(MAX_SPEED_MPS, prefs.speed)),
                unit = prefs.speed.label,
                accent = if (state.speed > 0.0) GaugeAccent.Power else GaugeAccent.Neutral,
            ),
            GaugeSpec(
                key = "power",
                label = strings.power,
                value = state.chargerPower,
                max = POWER_MAX,
                unit = GAUGE_KW,
                accent = if (state.isCharging) GaugeAccent.Success else GaugeAccent.Neutral,
            ),
        )
    }

    /** The battery + range bars, plus the charge-rate bar while charging (web `is_charging && <MetricBar/>`). */
    private fun buildBars(
        state: VehicleState,
        formatter: UnitFormatter,
        strings: VehicleGaugesStrings,
        locale: Locale,
    ): List<MetricBarSpec> {
        val prefs = formatter.prefs
        val batteryLevel = state.batteryLevel * 1.0
        return buildList {
            add(
                MetricBarSpec(
                    key = "batteryLevel",
                    label = strings.batteryLevel,
                    value = batteryLevel,
                    max = BATTERY_MAX,
                    valueText = "${ChartFormat.number(batteryLevel, WHOLE_DECIMALS, locale)}$GAUGE_PERCENT",
                    accent = batteryAccent(state.batteryLevel),
                ),
            )
            add(
                MetricBarSpec(
                    key = "estimatedRange",
                    label = strings.estimatedRange,
                    value = convertDistanceFromSI(state.ratedRange, prefs.distance),
                    max = convertDistanceFromSI(MAX_RANGE_METERS, prefs.distance),
                    valueText = formatter.distance(state.ratedRange),
                    accent = GaugeAccent.Info,
                ),
            )
            if (state.isCharging) {
                add(
                    MetricBarSpec(
                        key = "chargeRate",
                        label = strings.chargeRate,
                        value = convertDistanceFromSI(state.chargeRate, prefs.distance),
                        max = convertDistanceFromSI(MAX_CHARGE_RATE_METERS_PER_HOUR, prefs.distance),
                        valueText = "${formatter.distance(state.chargeRate)}$GAUGE_PER_HOUR",
                        accent = GaugeAccent.Success,
                    ),
                )
            }
        }
    }

    /** The four quick-info chips (web lock / sentry / climate / firmware spans). */
    private fun buildChips(
        state: VehicleState,
        strings: VehicleGaugesStrings,
    ): List<StatusChipSpec> =
        listOf(
            StatusChipSpec(
                key = "lock",
                label = if (state.isLocked) strings.locked else strings.unlocked,
                glyph = if (state.isLocked) GaugeChipGlyph.Lock else GaugeChipGlyph.Unlock,
                accent = if (state.isLocked) GaugeAccent.Success else GaugeAccent.Danger,
            ),
            StatusChipSpec(
                key = "sentry",
                label = if (state.sentryMode) strings.sentryOn else strings.sentryOff,
                glyph = GaugeChipGlyph.Shield,
                accent = if (state.sentryMode) GaugeAccent.Danger else GaugeAccent.Neutral,
            ),
            StatusChipSpec(
                key = "climate",
                label = if (state.isClimateOn) strings.climateOn else strings.climateOff,
                glyph = GaugeChipGlyph.Wind,
                accent = if (state.isClimateOn) GaugeAccent.Info else GaugeAccent.Neutral,
            ),
            StatusChipSpec(
                key = "firmware",
                label = state.softwareVersion.ifBlank { strings.unknown },
                glyph = GaugeChipGlyph.Cpu,
                accent = GaugeAccent.Power,
            ),
        )

    /**
     * The surface's spoken summary — the visible battery / range / (driving?) speed / (charging?) power +
     * charge-rate figures followed by the lock / sentry / climate / firmware chip labels, so a screen-reader
     * user gets the whole panel without traversing every gauge and chip.
     */
    private fun buildAccessibleSummary(
        state: VehicleState,
        formatter: UnitFormatter,
        strings: VehicleGaugesStrings,
        chips: List<StatusChipSpec>,
        locale: Locale,
    ): String {
        val batteryText = "${ChartFormat.number(state.batteryLevel * 1.0, WHOLE_DECIMALS, locale)}$GAUGE_PERCENT"
        return buildList {
            add("${strings.battery} $batteryText")
            add("${strings.estimatedRange} ${formatter.distance(state.ratedRange)}")
            if (state.speed > 0.0) add("${strings.speed} ${formatter.speed(state.speed)}")
            if (state.isCharging) {
                add("${strings.power} ${ChartFormat.number(state.chargerPower, WHOLE_DECIMALS, locale)} $GAUGE_KW")
                add("${strings.chargeRate} ${formatter.distance(state.chargeRate)}$GAUGE_PER_HOUR")
            }
            chips.forEach { add(it.label) }
        }.joinToString(SUMMARY_SEPARATOR)
    }
}

/** The mutually-exclusive surface drawn for a given [UiState] phase (web content + the added lifecycle chrome). */
enum class VehicleGaugesSurface { Loading, Error, Empty, Content }

/**
 * Maps a [UiState] onto the surface to render. Stale/offline cached data stays [VehicleGaugesSurface.Content]
 * (plus a freshness chip + an auto-refresh), never a blanked surface — the honest "last known" contract the
 * sibling surfaces follow.
 */
fun vehicleGaugesSurface(state: UiState<*>): VehicleGaugesSurface =
    when (state.phase) {
        UiPhase.Loading -> VehicleGaugesSurface.Loading
        UiPhase.Error -> VehicleGaugesSurface.Error
        UiPhase.Empty -> VehicleGaugesSurface.Empty
        UiPhase.Content -> VehicleGaugesSurface.Content
    }

/**
 * Builds the cache-then-network [UiState] for the web-parity entry that takes the loaded [data] + the host's
 * freshness flags. The gauges need BOTH a vehicle and a state, so a missing either side is a first-load
 * [UiPhase.Loading], a hard failure [UiPhase.Error], or a resolved-but-absent [UiPhase.Empty]; with both
 * present the surface stays [UiPhase.Content], carrying the refreshing / stale / error freshness so cached
 * data is shown as honest "last known" rather than blanked.
 */
fun vehicleGaugesStateOf(
    data: VehicleGaugesData?,
    loading: Boolean,
    isStale: Boolean = false,
    isError: Boolean = false,
    fetchedAt: Long? = null,
): UiState<VehicleGaugesData> {
    val ready = data?.vehicle != null && data.state != null
    val resolvedError = if (isError) ErrorKind.Unknown else null
    return when {
        !ready && isError ->
            UiState(phase = UiPhase.Error, fetchedAt = fetchedAt, stale = isStale, errorKind = resolvedError)
        !ready && loading -> UiState(phase = UiPhase.Loading)
        !ready -> UiState(phase = UiPhase.Empty, data = data)
        else ->
            UiState(
                phase = UiPhase.Content,
                data = data,
                fetchedAt = fetchedAt,
                stale = isStale || isError,
                refreshing = loading,
                errorKind = resolvedError,
            )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehicleGaugesRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect. Carries no battery / range / location payload, so a diagnostics line can never
 * leak the vehicle's state.
 */
fun recordVehicleGaugesOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to VehicleGaugesRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val SURFACE_KEY = "surface"
