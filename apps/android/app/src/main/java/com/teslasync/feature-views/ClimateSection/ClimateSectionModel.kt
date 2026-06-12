// Pure, framework-free model + projection for the ClimateSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ClimateSection is a presentational surface — the web component takes its `climateData` snapshot as a prop
// from the vehicle-detail page (which owns the query), so this surface binds no data fetch. Its two bound
// data sources are `useTranslation` (the i18n catalog, P1/S10 — the labels + the "Level"/"On"/"Off" value
// words the component renders) and `useUnits` (the temperature display preference + locale, P1/S8). The
// branches the web source itself defines are: the eight-tile metric grid when `climateData` is present, and
// a friendly empty state ("No climate data available") when it is absent. The cache-then-network lifecycle
// states (loading / error / stale / offline) live on the owning page; the stateful composable still renders
// each one it can carry through the shared `UiState`, exactly as the sibling surfaces do.
//
// Every per-tile string the web derives flows through this pure projection: the three temperatures are
// formatted at the display boundary via the shared `formatTemperature` (Phase-48 SI-canonical rule; the
// backend serves SI Celsius and conversion is display-only, web `useUnits().formatTemperature`), the fan
// speed is the numeric status or an em dash, each seat heater is `"Level {n}"` or an em dash, the defrost
// tile is the active mode or the "Off" word, and the climate tile is "On"/"Off" — each with the same accent
// the web `MetricCard color` prop chooses (the defrost + climate tiles switch green/cyan on whether they are
// active, exactly as the web ternary does).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ClimateSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatesection

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ClimateSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "climate-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / vehicle data. */
    const val SLUG: String = "ClimateSection"
}

/** The em dash the web renders for an absent fan speed / seat-heater reading (web `'—'`, U+2014). */
internal const val EM_DASH: String = "\u2014"

/** The web literal the defrost tile treats as "inactive" (`defrost_mode !== 'Off'`). */
private const val DEFROST_OFF: String = "Off"

/**
 * The climate snapshot the surface renders — the native analogue of the fields the web component reads from
 * its `ClimateSnapshot` prop. Every reading is SI-canonical (temperatures in degrees Celsius), resolved by
 * the host/state-holder from the API response: each field carries the value the web `??` coalescing yields
 * (the pre-migration JSONB aliases the web defends against — `inside_temp`, `hvac_fan_status`, `is_ac_on` —
 * are duplicates of the same canonical reading, so the resolved value is modelled once here).
 *
 * @property insideTempC cabin inside temperature in °C, or `null` (web `inside_temp ?? inside_temp_c`).
 * @property outsideTempC outside ambient temperature in °C, or `null` (web `outside_temp ?? outside_temp_c`).
 * @property driverSetpointC driver HVAC setpoint in °C, or `null` (web `driver_temp_setting ?? driver_setpoint_c`).
 * @property fanStatus the HVAC fan status level, or `null` (web `hvac_fan_status ?? fan_status`).
 * @property seatHeaterLeft the left-seat heater level, or `null` (web `seat_heater_left`).
 * @property seatHeaterRight the right-seat heater level, or `null` (web `seat_heater_right`).
 * @property defrostMode the active defrost mode string, or `null` (web `defrost_mode`).
 * @property isClimateOn whether climate is on, or `null` (web `is_ac_on ?? is_climate_on`).
 */
data class ClimateData(
    val insideTempC: Double? = null,
    val outsideTempC: Double? = null,
    val driverSetpointC: Double? = null,
    val fanStatus: Int? = null,
    val seatHeaterLeft: Int? = null,
    val seatHeaterRight: Int? = null,
    val defrostMode: String? = null,
    val isClimateOn: Boolean? = null,
)

/**
 * The eight climate tiles, in the web grid render order. Each id resolves a localized label + a leading
 * glyph at the Compose boundary; the projection only computes the formatted value + accent.
 */
enum class ClimateMetricId {
    InsideTemp,
    OutsideTemp,
    DriverSetpoint,
    FanSpeed,
    SeatHeaterLeft,
    SeatHeaterRight,
    Defrost,
    ClimateOn,
}

/**
 * A tile's accent — the native identity of the web `MetricCard` `color` prop. The composable maps each onto
 * a design token (`Green`→status.success, `Cyan`→chart.regen, `Purple`→chart.power), keeping this projection
 * free of any Compose `Color`.
 */
enum class ClimateMetricTone { Green, Cyan, Purple }

/**
 * The localized strings the projected tile VALUES need (P1/S10) — the three value words the web renders via
 * `t(...)` inside a tile. Kept injectable so the pure projection carries no English literal and the stateless
 * content composable can be exercised without a resources host.
 *
 * @property level the `common.level` prefix joined before a seat-heater level ("Level").
 * @property on the `common.on` climate-on word ("On").
 * @property off the `common.off` word, shared by the climate-off and defrost-inactive tiles ("Off").
 */
data class ClimateValueStrings(
    val level: String,
    val on: String,
    val off: String,
)

/**
 * One projected, render-ready tile — the native analogue of a single web `<MetricCard>`. Pure data (no
 * Compose types) so the projection is unit-tested without a UI host.
 *
 * @property id selects the tile's localized label + leading glyph at the Compose boundary.
 * @property value the fully formatted headline value (a temperature with unit, a fan level, `"Level {n}"`,
 *   a defrost mode, "On"/"Off", or the [EM_DASH] fallback).
 * @property tone the accent identity (the web `color` prop).
 */
data class ClimateMetric(
    val id: ClimateMetricId,
    val value: String,
    val tone: ClimateMetricTone,
)

/**
 * The fully projected, render-ready grid — the native analogue of everything the web component computes
 * before returning the tile grid. Always the eight tiles in web order (the web always renders all eight when
 * `climateData` is present), so a sparse snapshot shows em-dash / "Off" tiles rather than a blank box.
 */
data class ClimateSectionProjectionResult(
    val metrics: List<ClimateMetric>,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-tile value +
 * accent derivation. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ClimateSectionProjection {
    /**
     * Projects [data] into the eight render-ready tiles, in the web grid order. [formatTemperature] is the
     * injected SI-Celsius display formatter (web `useUnits().formatTemperature`, em dash for `null`); [strings]
     * supplies the "Level"/"On"/"Off" value words. The result always carries all eight tiles.
     */
    fun project(
        data: ClimateData,
        formatTemperature: (Double?) -> String,
        strings: ClimateValueStrings,
    ): ClimateSectionProjectionResult =
        ClimateSectionProjectionResult(
            metrics =
                listOf(
                    ClimateMetric(ClimateMetricId.InsideTemp, formatTemperature(data.insideTempC), ClimateMetricTone.Green),
                    ClimateMetric(ClimateMetricId.OutsideTemp, formatTemperature(data.outsideTempC), ClimateMetricTone.Cyan),
                    ClimateMetric(
                        ClimateMetricId.DriverSetpoint,
                        formatTemperature(data.driverSetpointC),
                        ClimateMetricTone.Purple,
                    ),
                    ClimateMetric(ClimateMetricId.FanSpeed, fanValue(data.fanStatus), ClimateMetricTone.Cyan),
                    ClimateMetric(
                        ClimateMetricId.SeatHeaterLeft,
                        seatHeaterValue(data.seatHeaterLeft, strings),
                        ClimateMetricTone.Green,
                    ),
                    ClimateMetric(
                        ClimateMetricId.SeatHeaterRight,
                        seatHeaterValue(data.seatHeaterRight, strings),
                        ClimateMetricTone.Green,
                    ),
                    defrostMetric(data.defrostMode, strings),
                    climateOnMetric(data.isClimateOn, strings),
                ),
        )

    /** The fan-speed tile value — the numeric status (web `String(fan_status)`), or [EM_DASH] when absent. */
    private fun fanValue(fanStatus: Int?): String = fanStatus?.toString() ?: EM_DASH

    /** A seat-heater tile value — `"{level} {n}"` (web `` `${t('common.level')} ${n}` ``), or [EM_DASH] when absent. */
    private fun seatHeaterValue(
        level: Int?,
        strings: ClimateValueStrings,
    ): String = if (level != null) "${strings.level} $level" else EM_DASH

    /**
     * The defrost tile — the active mode when present and not the web `'Off'` literal (green accent),
     * otherwise the "Off" word (cyan accent). Reproduces the web `defrost_mode && defrost_mode !== 'Off'`
     * ternary for both the value and the color.
     */
    private fun defrostMetric(
        defrostMode: String?,
        strings: ClimateValueStrings,
    ): ClimateMetric {
        val active = defrostMode != null && defrostMode != DEFROST_OFF
        return ClimateMetric(
            id = ClimateMetricId.Defrost,
            value = if (active) defrostMode else strings.off,
            tone = if (active) ClimateMetricTone.Green else ClimateMetricTone.Cyan,
        )
    }

    /**
     * The climate-on tile — "On" + green when climate is on, "Off" + cyan otherwise. Reproduces the web
     * `(is_ac_on ?? is_climate_on) ? 'On' : 'Off'` value + color ternary (a `null` reading reads as off).
     */
    private fun climateOnMetric(
        isClimateOn: Boolean?,
        strings: ClimateValueStrings,
    ): ClimateMetric {
        val on = isClimateOn == true
        return ClimateMetric(
            id = ClimateMetricId.ClimateOn,
            value = if (on) strings.on else strings.off,
            tone = if (on) ClimateMetricTone.Green else ClimateMetricTone.Cyan,
        )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ClimateSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Carries only the surface slug — never a temperature, setpoint, or any
 * vehicle reading — so a diagnostics line can never leak fleet telemetry.
 */
fun recordClimateSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ClimateSectionRegistration.SLUG))
}
