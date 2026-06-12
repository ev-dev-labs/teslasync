// Pure, framework-free model + projection for the TemperatureMetricCards feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx). No Compose, no
// Android, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// TemperatureMetricCards is a presentational surface — the web component takes its `sensors`,
// `overallHealth`, `healthScore`, and `peakPower` as props from the Drivetrain Health page (which owns the
// `useDrivetrainHealth` / `useDrives` queries and builds the sensor list with its label keys), so this
// surface binds no data fetch. Its two bound data sources are `useTranslation` (the i18n catalog, P1/S10 —
// the four `drivetrain.*` strings the component itself owns) and `useUnits` (the temperature display
// preference + locale, P1/S8). The cache-then-network lifecycle states (error / stale / offline) live on
// that owning page, not here — exactly as the web source delegates them to its parent. The branches the web
// source itself defines are the state set this surface renders: the resolved card grid (one card per sensor
// plus the Health Score and Peak Power tiles), the per-sensor null branch (an em-dash value with a "No data"
// subtitle rather than a blank box, the web `value !== null ? … : 'No data'` gate), and a friendly empty
// state when no sensor is present (mirroring the page's `health ? … : <EmptyState/>` gate). A skeleton
// loading branch is offered behind an opt-in `loading` flag the owning page threads while its query is first
// in flight — the same convention the sibling presentational surfaces use — defaulting to the web's
// no-loading contract.
//
// Sensor labels are NOT this surface's i18n responsibility: in the web source the parent page owns each
// sensor's `labelKey` + `defaultLabel` and passes the built `sensors` array in, so the labels arrive as
// resolved strings (the prompt's extracted-keys list contains only the four strings the component itself
// renders). The surface formats each sensor's SI-Celsius reading at the display boundary via the shared
// `formatTemperature` (Phase-48 SI-canonical rule; the backend serves SI and conversion is display-only,
// web `useUnits().formatTemperature`), and the percent-of-max + peak-power figures via the shared
// `ChartFormat.number` (web `fmtNumber(v, 0)` / `fmtInt`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TemperatureMetricCards — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturemetriccards

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatTemperature
import java.util.Locale

/** The em-dash sentinel rendered for an absent reading / non-positive peak power (web `… : '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Both the percent-of-max and the peak-power figures render as whole numbers (web `fmtNumber(v, 0)`). */
private const val WHOLE_NUMBER_DECIMALS: Int = 0

/** Scales a 0..1 temperature ratio to a percentage (web `(value / maxTemp) * 100`). */
private const val PERCENT_SCALE: Double = 100.0

/** At or above 85 % of a sensor's max the accent is critical-red (web `tempNeonColor` `ratio >= 0.85`). */
private const val CRITICAL_RATIO: Double = 0.85

/** At or above 65 % of a sensor's max the accent is warning-amber (web `tempNeonColor` `ratio >= 0.65`). */
private const val WARNING_RATIO: Double = 0.65

/** Overall drivetrain health — the native shape of the web `HealthStatus` union (`good`/`warning`/`critical`). */
enum class DrivetrainHealthStatus { Good, Warning, Critical }

/**
 * The lucide glyph each card carries — the native identity of the web `icon` prop. `Motor` is the web `Zap`
 * (front/rear motor), `Inverter` the `Cpu`, `Battery` the `BatteryCharging`, `Heart` the Health Score tile,
 * and `Power` the Peak Power tile's `Zap`. The composable maps each to a hand-authored [ImageVector].
 */
enum class TemperatureMetricIcon { Motor, Inverter, Battery, Heart, Power }

/**
 * A card's accent — the native identity of the web `MetricCard` `color` prop. The composable maps each onto
 * a semantic design token (`Green`→success, `Amber`→warning, `Red`→danger) or the purple chart token
 * (`Purple`→chart.power), keeping this projection free of any Compose `Color`.
 */
enum class TemperatureMetricColor { Green, Amber, Red, Purple }

/**
 * One temperature sensor the surface renders — the native analogue of a web `TempSensor`. The [label]
 * arrives already resolved (the parent page owns the `labelKey` + `defaultLabel`); [value] is the SI-Celsius
 * reading or `null` when absent; [maxTemp] is the sensor's rated ceiling in °C (the percent-of-max + accent
 * denominator); [icon] is the leading glyph.
 *
 * @property label the resolved, localized sensor name (host-provided, web `t(labelKey, defaultLabel)`).
 * @property value the reading in SI degrees Celsius, or `null` when the sensor has no value.
 * @property maxTemp the sensor's rated maximum in °C (front/rear motor 150, inverter 120, battery 60).
 * @property icon the leading accent glyph for this sensor.
 */
data class TempSensor(
    val label: String,
    val value: Double?,
    val maxTemp: Double,
    val icon: TemperatureMetricIcon,
)

/**
 * One projected, render-ready card — the native analogue of a single web `<MetricCard>`. Pure data (no
 * Compose types) so the projection is unit-tested without a UI host.
 *
 * @property label the card's resolved title.
 * @property value the formatted headline value (a temperature with unit, `"{n}%"`, `"{n} kW"`, or [EM_DASH]).
 * @property subtitle the secondary line (`"{pct}% of max"` / `"No data"` for sensors), or `null` when the
 *   card has none (the Health Score + Peak Power tiles, web has no subtitle there).
 * @property icon the leading accent glyph.
 * @property color the accent color identity.
 * @property contentDescription the merged TalkBack label folding the title, value, and subtitle.
 */
data class TemperatureMetricCard(
    val label: String,
    val value: String,
    val subtitle: String?,
    val icon: TemperatureMetricIcon,
    val color: TemperatureMetricColor,
    val contentDescription: String,
)

/**
 * The localized strings this surface owns (P1/S10) — the four `t('drivetrain.…')` keys the web component
 * renders itself. Kept injectable so the pure projection carries no English literal and the stateless
 * content composable can be exercised in a UI test without a resources host.
 *
 * @property ofMax the `drivetrain.ofMax` suffix joined after the percent ("of max").
 * @property noData the `drivetrain.noData` sensor-subtitle + empty-state message ("No data").
 * @property healthScore the `drivetrain.healthScore` Health Score card title.
 * @property peakPower the `drivetrain.peakPower` Peak Power card title.
 * @property loadingLabel the `a11y.loading` TalkBack announcement for the skeleton grid ("Loading").
 */
data class TemperatureMetricCardsStrings(
    val ofMax: String,
    val noData: String,
    val healthScore: String,
    val peakPower: String,
    val loadingLabel: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight; the grid renders skeleton chrome while true.
 * @property hasData whether any sensor is present (web parent `health ?`); when false the surface renders the
 *   empty state instead of the card grid.
 * @property cards the ordered cards to render (sensors, then Health Score, then Peak Power); empty when
 *   [hasData] is false.
 */
data class TemperatureMetricCardsDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val cards: List<TemperatureMetricCard>,
)

/**
 * Pure projection from the surface's props to its render-ready [TemperatureMetricCardsDisplay] — a 1:1 port
 * of the derivations the web component performs: the per-sensor `displayTemp` value + `tempNeonColor` accent
 * + `"{pct}% of max" | "No data"` subtitle, the Health Score tile (`"{healthScore}%"` + health-derived
 * accent), and the Peak Power tile (`peakPower > 0 ? "{fmtInt} kW" : "—"`).
 */
object TemperatureMetricCardsProjection {
    /**
     * Project the surface's props using the user's [prefs] (temperature unit + locale + precision) and the
     * localized [strings]. [locale] is the grouping/separator locale for the percent-of-max + peak-power
     * figures (web `fmtNumber`'s active locale).
     */
    @Suppress("LongParameterList")
    fun project(
        sensors: List<TempSensor>,
        overallHealth: DrivetrainHealthStatus,
        healthScore: Int,
        peakPowerKw: Double,
        prefs: UnitPref,
        strings: TemperatureMetricCardsStrings,
        loading: Boolean,
        locale: Locale,
    ): TemperatureMetricCardsDisplay {
        val hasData = sensors.isNotEmpty()
        val cards =
            if (!hasData) {
                emptyList()
            } else {
                buildList {
                    sensors.forEach { add(sensorCard(it, prefs, strings, locale)) }
                    add(healthCard(overallHealth, healthScore, strings))
                    add(peakCard(peakPowerKw, strings, locale))
                }
            }
        return TemperatureMetricCardsDisplay(loading = loading, hasData = hasData, cards = cards)
    }

    /**
     * The accent for a sensor reading — a verbatim port of the web `tempNeonColor(value, maxTemp)`: a `null`
     * reading is [TemperatureMetricColor.Green], then the [value]/[maxTemp] ratio buckets into red at
     * [CRITICAL_RATIO], amber at [WARNING_RATIO], else green.
     */
    fun tempColor(
        value: Double?,
        maxTemp: Double,
    ): TemperatureMetricColor {
        if (value == null) return TemperatureMetricColor.Green
        val ratio = value / maxTemp
        return when {
            ratio >= CRITICAL_RATIO -> TemperatureMetricColor.Red
            ratio >= WARNING_RATIO -> TemperatureMetricColor.Amber
            else -> TemperatureMetricColor.Green
        }
    }

    private fun sensorCard(
        sensor: TempSensor,
        prefs: UnitPref,
        strings: TemperatureMetricCardsStrings,
        locale: Locale,
    ): TemperatureMetricCard {
        val present = sensor.value != null
        val value = if (present) formatTemperature(sensor.value, prefs) else EM_DASH
        val subtitle =
            if (present) {
                val ratio = sensor.value / sensor.maxTemp * PERCENT_SCALE
                "${ChartFormat.number(ratio, WHOLE_NUMBER_DECIMALS, locale)}% ${strings.ofMax}"
            } else {
                strings.noData
            }
        return TemperatureMetricCard(
            label = sensor.label,
            value = value,
            subtitle = subtitle,
            icon = sensor.icon,
            color = tempColor(sensor.value, sensor.maxTemp),
            contentDescription = describe(sensor.label, value, subtitle),
        )
    }

    private fun healthCard(
        overallHealth: DrivetrainHealthStatus,
        healthScore: Int,
        strings: TemperatureMetricCardsStrings,
    ): TemperatureMetricCard {
        val value = "$healthScore%"
        val color =
            when (overallHealth) {
                DrivetrainHealthStatus.Good -> TemperatureMetricColor.Green
                DrivetrainHealthStatus.Warning -> TemperatureMetricColor.Amber
                DrivetrainHealthStatus.Critical -> TemperatureMetricColor.Red
            }
        return TemperatureMetricCard(
            label = strings.healthScore,
            value = value,
            subtitle = null,
            icon = TemperatureMetricIcon.Heart,
            color = color,
            contentDescription = describe(strings.healthScore, value, null),
        )
    }

    private fun peakCard(
        peakPowerKw: Double,
        strings: TemperatureMetricCardsStrings,
        locale: Locale,
    ): TemperatureMetricCard {
        val value =
            if (peakPowerKw > 0.0) {
                "${ChartFormat.number(peakPowerKw, WHOLE_NUMBER_DECIMALS, locale)} ${PowerUnitPref.KW.label}"
            } else {
                EM_DASH
            }
        return TemperatureMetricCard(
            label = strings.peakPower,
            value = value,
            subtitle = null,
            icon = TemperatureMetricIcon.Power,
            color = TemperatureMetricColor.Purple,
            contentDescription = describe(strings.peakPower, value, null),
        )
    }

    /** Folds a card's title, value, and optional subtitle into one space-joined TalkBack label. */
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
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature value, health score, or peak power — so a diagnostics line can never leak fleet telemetry.
 */
object TemperatureMetricCardsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (matches the web component name). */
    const val SLUG: String = "TemperatureMetricCards"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
