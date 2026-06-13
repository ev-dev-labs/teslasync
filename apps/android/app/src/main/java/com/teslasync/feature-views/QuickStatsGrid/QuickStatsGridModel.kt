// Pure, framework-free model + projection for the QuickStatsGrid feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// QuickStatsGrid is a presentational surface — the web component takes a `state: VehicleState` and a
// `status: VehicleStatus` prop from the owning Vehicle Detail page (which owns the live-state query), and its
// only data hooks are `useTranslation` (the eight cell labels + the driving/parked subtitle, P1/S10) and
// `useUnits` (the distance / speed / temperature display preference + locale, P1/S8). As in the committed
// QuickMetrics / TemperatureMetricCards ports, the cache-then-network states (error / stale / offline) live
// on that owning page, not here; the branches this surface renders are the resolved eight-cell grid, an
// opt-in loading skeleton the page threads while its query is first in flight, and a friendly empty state
// when no live state is present (a null-safe extension of the web source, which is only mounted with a
// resolved `state`).
//
// Each cell mirrors the web formatting verbatim: Battery `${battery_level}%`; Range / Odometer
// `formatDistance(_, { precision: 0 })`; Speed `formatSpeed(_, { precision: 0 })` with a driving / parked
// subtitle (`speed > 0`); Inside / Outside Temp `formatTemperature(_)`; Power `${fmtNumber(state.power)} kW`
// (rendered verbatim — the web appends the `kW` glyph to the raw figure with NO SI power conversion, so this
// port mirrors that exactly rather than re-deriving from watts); State the raw `status` string. The SI
// distance / speed / temperature readings are converted at the display boundary by the shared `formatX`
// functions (Phase-48 SI-canonical rule; the backend serves SI and conversion is display-only).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/QuickStatsGrid — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quickstatsgrid

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatSpeed
import io.teslasync.shared.core.units.formatTemperature
import java.util.Locale
import kotlin.math.floor

/** Em-dash sentinel rendered for an absent value — the native mirror of the shared `formatX` empty fallback. */
internal const val EM_DASH: String = "\u2014"

/** Range + Odometer render at zero fraction digits (web `formatDistance(_, { precision: 0 })`). */
private const val DISTANCE_PRECISION: Int = 0

/** Speed renders at zero fraction digits (web `formatSpeed(_, { precision: 0 })`). */
private const val SPEED_PRECISION: Int = 0

/** Power falls back to two fraction digits when no precision is set (web `fmtNumber` `_globalPrecision`). */
private const val POWER_FALLBACK_PRECISION: Int = 2

/** Above 50 % the Battery accent is green, otherwise cyan (web `battery_level > 50 ? 'green' : 'cyan'`). */
private const val BATTERY_FULL_THRESHOLD: Double = 50.0

/** A positive speed means the vehicle is driving (web `speed > 0 ? 'Driving' : 'Parked'`). */
private const val SPEED_MOVING_THRESHOLD: Double = 0.0

/**
 * A cell's accent — the native identity of the web `MetricCard` `color` prop. The composable maps each onto a
 * semantic design token (`Green`→status.success, `Cyan`→status.info) or the purple chart token
 * (`Purple`→chart.power), keeping this projection free of any Compose `Color`.
 */
enum class QuickStatColor { Green, Cyan, Purple }

/**
 * The leading glyph each cell carries — the native identity of the web lucide `icon` prop (`Battery`,
 * `Navigation`, `Car`, `Gauge`, `Thermometer`, `Zap`→`Bolt`, `Activity`). The composable maps each onto a
 * shared data-display glyph or a hand-authored [androidx.compose.ui.graphics.vector.ImageVector].
 */
enum class QuickStatIcon { Battery, Navigation, Car, Gauge, Thermometer, Bolt, Activity }

/**
 * The slice of the web `VehicleState` that QuickStatsGrid actually reads — the native grouping of the seven
 * live fields the eight cells render. The owning Vehicle Detail page threads these in from its live-state
 * query; this surface performs no fetch and no unit math beyond the display-boundary `formatX` conversions.
 * Every field is nullable for null safety (the web prop is non-null, so an absent field renders the shared
 * em-dash fallback rather than `NaN`).
 *
 * @property batteryLevel state-of-charge percentage as served (web `state.battery_level`).
 * @property ratedRangeMeters rated range in SI meters (web `state.rated_range`).
 * @property odometerMeters odometer in SI meters (web `state.odometer`).
 * @property speedMps speed in SI metres-per-second (web `state.speed`).
 * @property insideTempCelsius cabin temperature in SI degrees Celsius (web `state.inside_temp`).
 * @property outsideTempCelsius outside temperature in SI degrees Celsius (web `state.outside_temp`).
 * @property power the power figure rendered verbatim with a `kW` glyph (web `state.power`).
 */
data class QuickStatsVehicleState(
    val batteryLevel: Double?,
    val ratedRangeMeters: Double?,
    val odometerMeters: Double?,
    val speedMps: Double?,
    val insideTempCelsius: Double?,
    val outsideTempCelsius: Double?,
    val power: Double?,
)

/**
 * The localized strings this surface owns (P1/S10) — the eight `t('common.…')` cell labels, the two
 * speed-subtitle states, plus the empty-state message and the loading announcement. Kept injectable so the
 * pure projection carries no English literal and the stateless content composable can be exercised without a
 * resources host.
 */
data class QuickStatsGridStrings(
    val battery: String,
    val range: String,
    val odometer: String,
    val speed: String,
    val driving: String,
    val parked: String,
    val insideTemp: String,
    val outsideTemp: String,
    val power: String,
    val state: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * One projected, render-ready cell — the native analogue of a single web `<MetricCard>`. Pure data (no
 * Compose types) so the projection is unit-tested without a UI host.
 *
 * @property label the cell's resolved, localized title.
 * @property value the formatted headline value (a percentage, a distance / speed / temperature with unit, a
 *   `"{n} kW"` power figure, the raw status string, or [EM_DASH]).
 * @property subtitle the secondary line (the Speed cell's driving / parked state), or `null` when the cell
 *   has none.
 * @property icon the leading accent glyph identity.
 * @property color the accent color identity.
 * @property contentDescription the merged TalkBack label folding the title, value, and subtitle.
 */
data class QuickStatCard(
    val label: String,
    val value: String,
    val subtitle: String?,
    val icon: QuickStatIcon,
    val color: QuickStatColor,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight; the grid renders skeleton chrome while true.
 * @property hasData whether live state is present; when false the surface renders the empty state.
 * @property cards the eight ordered cells (empty when [hasData] is false).
 */
data class QuickStatsGridDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val cards: List<QuickStatCard>,
)

/**
 * Pure projection from the surface's `state` + `status` props to its render-ready [QuickStatsGridDisplay] — a
 * 1:1 port of the formatting the web component performs. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate; the composable only resolves localized labels, glyphs, and
 * design-token accents and draws what these functions return.
 */
object QuickStatsGridProjection {
    /**
     * Project the surface's props using the user's [prefs] (distance / speed / temperature unit + locale +
     * precision) and the localized [strings]. Returns an empty (`hasData = false`) display when [state] is
     * absent — the null-safe equivalent of the web parent only mounting the grid with a resolved state.
     * [locale] is the grouping/separator locale for the power figure (web `fmtNumber`'s active locale).
     */
    @Suppress("LongParameterList")
    fun project(
        state: QuickStatsVehicleState?,
        status: String?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
        loading: Boolean,
        locale: Locale,
    ): QuickStatsGridDisplay {
        val cards =
            if (state == null) {
                emptyList()
            } else {
                listOf(
                    batteryCard(state.batteryLevel, strings),
                    rangeCard(state.ratedRangeMeters, prefs, strings),
                    odometerCard(state.odometerMeters, prefs, strings),
                    speedCard(state.speedMps, prefs, strings),
                    insideTempCard(state.insideTempCelsius, prefs, strings),
                    outsideTempCard(state.outsideTempCelsius, prefs, strings),
                    powerCard(state.power, prefs, locale, strings),
                    stateCard(status, strings),
                )
            }
        return QuickStatsGridDisplay(loading = loading, hasData = state != null, cards = cards)
    }

    /** Battery value — web `${state.battery_level}%`: the raw figure with a trailing percent, em dash if absent. */
    fun batteryValue(level: Double?): String = if (level == null) EM_DASH else "${plainNumber(level)}%"

    /** Battery accent — web `battery_level > 50 ? 'green' : 'cyan'` (the `> 20` arm also resolves to cyan). */
    fun batteryColor(level: Double?): QuickStatColor =
        if ((level ?: 0.0) > BATTERY_FULL_THRESHOLD) QuickStatColor.Green else QuickStatColor.Cyan

    /** Speed subtitle — web `speed > 0 ? t('common.driving') : t('common.parked')`. */
    fun speedSubtitle(
        speedMps: Double?,
        strings: QuickStatsGridStrings,
    ): String = if ((speedMps ?: 0.0) > SPEED_MOVING_THRESHOLD) strings.driving else strings.parked

    /**
     * Power value — web `${fmtNumber(state.power)} kW`: the raw figure grouped to the active precision with a
     * trailing `kW` glyph. The figure goes through the web `safeNumber` contract (a null / non-finite input
     * coerces to `0` rather than rendering `NaN`); there is NO SI power conversion, exactly as the web source.
     */
    fun powerValue(
        power: Double?,
        prefs: UnitPref,
        locale: Locale,
    ): String {
        val precision = prefs.precision ?: POWER_FALLBACK_PRECISION
        val safe = if (power != null && power.isFinite()) power else 0.0
        return "${ChartFormat.number(safe, precision, locale)} ${PowerUnitPref.KW.label}"
    }

    /** State value — web `value={status}`: the raw status string verbatim, em dash when absent / blank. */
    fun stateValue(status: String?): String = status?.takeIf { it.isNotBlank() } ?: EM_DASH

    /**
     * Renders [value] the way a JavaScript template literal stringifies a number (web `${battery_level}`):
     * a whole number drops its decimal point and grouping (`72.0` → `"72"`), anything else keeps its shortest
     * decimal form (`72.5` → `"72.5"`).
     */
    fun plainNumber(value: Double): String {
        if (!value.isFinite()) return value.toString()
        return if (value == floor(value)) value.toLong().toString() else value.toString()
    }

    private fun batteryCard(
        level: Double?,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = batteryValue(level)
        return QuickStatCard(
            label = strings.battery,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Battery,
            color = batteryColor(level),
            contentDescription = describe(strings.battery, value, null),
        )
    }

    private fun rangeCard(
        meters: Double?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = formatDistance(meters, prefs, DISTANCE_PRECISION)
        return QuickStatCard(
            label = strings.range,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Navigation,
            color = QuickStatColor.Cyan,
            contentDescription = describe(strings.range, value, null),
        )
    }

    private fun odometerCard(
        meters: Double?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = formatDistance(meters, prefs, DISTANCE_PRECISION)
        return QuickStatCard(
            label = strings.odometer,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Car,
            color = QuickStatColor.Purple,
            contentDescription = describe(strings.odometer, value, null),
        )
    }

    private fun speedCard(
        speedMps: Double?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = formatSpeed(speedMps, prefs, SPEED_PRECISION)
        val subtitle = speedSubtitle(speedMps, strings)
        return QuickStatCard(
            label = strings.speed,
            value = value,
            subtitle = subtitle,
            icon = QuickStatIcon.Gauge,
            color = QuickStatColor.Cyan,
            contentDescription = describe(strings.speed, value, subtitle),
        )
    }

    private fun insideTempCard(
        celsius: Double?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = formatTemperature(celsius, prefs)
        return QuickStatCard(
            label = strings.insideTemp,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Thermometer,
            color = QuickStatColor.Green,
            contentDescription = describe(strings.insideTemp, value, null),
        )
    }

    private fun outsideTempCard(
        celsius: Double?,
        prefs: UnitPref,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = formatTemperature(celsius, prefs)
        return QuickStatCard(
            label = strings.outsideTemp,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Thermometer,
            color = QuickStatColor.Cyan,
            contentDescription = describe(strings.outsideTemp, value, null),
        )
    }

    private fun powerCard(
        power: Double?,
        prefs: UnitPref,
        locale: Locale,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = powerValue(power, prefs, locale)
        return QuickStatCard(
            label = strings.power,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Bolt,
            color = QuickStatColor.Purple,
            contentDescription = describe(strings.power, value, null),
        )
    }

    private fun stateCard(
        status: String?,
        strings: QuickStatsGridStrings,
    ): QuickStatCard {
        val value = stateValue(status)
        return QuickStatCard(
            label = strings.state,
            value = value,
            subtitle = null,
            icon = QuickStatIcon.Activity,
            color = QuickStatColor.Cyan,
            contentDescription = describe(strings.state, value, null),
        )
    }

    /** Folds a cell's title, value, and optional subtitle into one space-joined TalkBack label. */
    private fun describe(
        label: String,
        value: String,
        subtitle: String?,
    ): String = listOfNotNull(label, value, subtitle?.takeIf { it.isNotBlank() }).joinToString(" ")
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a battery
 * level, range, odometer, speed, temperature, power, or state value — so a diagnostics line can never leak
 * fleet telemetry.
 */
object QuickStatsGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (matches the web component name). */
    const val SLUG: String = "QuickStatsGrid"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
