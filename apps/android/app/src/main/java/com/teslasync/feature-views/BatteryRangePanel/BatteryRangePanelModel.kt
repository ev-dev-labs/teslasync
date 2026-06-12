// Pure, framework-free model + projection for the BatteryRangePanel feature view — the native analogue of
// every value the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// BatteryRangePanel is a presentational vehicle-detail panel — the web component takes `state: VehicleState`
// as a prop from the owning vehicle-detail page (which owns the `useVehicleState` TanStack query) and reads
// two context hooks for display: `useTranslation` (labels) and `useUnits` (`formatDistance`). It defines a
// single always-rendered surface (a battery gauge beside three metric cards) with two in-card conditionals:
//   • the Charging card value — `is_charging ? "${formatDistance(charge_rate)}/h" : t('common.notCharging')`;
//   • the Charging card subtitle — `is_charging && time_to_full_charge > 0` →
//     `"${t('vehicles.detail.fullIn')} ${fmtNumber(time_to_full_charge, 1)}h"`, else absent.
// As in the sibling AcDcStatsPanel port, the cache-then-network lifecycle (loading / error / stale / offline)
// is supplied by the owning host through the shared P1/S8 state-holder layer as a [UiState]; the composable
// renders every state that layer can carry without ever fetching. This pure file owns the parts the web render
// derives from `state`: the gauge tone (web `batteryColor`), the three formatted metric values, and the two
// charging conditionals.
//
// Unit handling floors on SI exactly as the web source does: `rated_range`, `ideal_range`, and `charge_rate`
// are SI metres on the wire and are converted at the display boundary by the shared [UnitFormatter] (the native
// `useUnits` binding) — the conversion factors live in the shared units lib, never here. `time_to_full_charge`
// is hours on the wire and the web renders it verbatim (`fmtNumber(value, 1)` + `'h'`) with NO conversion, so
// this port formats that magnitude exactly as handed and performs no SI re-scaling of its own (faithful to the
// observable web behaviour, never silently "corrected"). The `%` and `/h` symbols are international SI-derived
// symbols kept as code constants, exactly as the sibling charging feature-view ports do.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryRangePanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryrangepanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Gauge ceiling — web `max={100}` (battery percent). */
internal const val BATTERY_MAX_PERCENT: Double = 100.0

/** Battery gauge unit — web `unit="%"`. */
internal const val BATTERY_UNIT: String = "%"

/** Web `${formatDistance(state.charge_rate)}/h` rate suffix on the charging card value. */
internal const val PER_HOUR_SUFFIX: String = "/h"

/** Web `${fmtNumber(state.time_to_full_charge, 1)}h` hour suffix on the charging card subtitle. */
internal const val HOUR_SUFFIX: String = "h"

/** Web `formatDistance(value, { precision: 0 })` on the rated/ideal range cards. */
private const val RANGE_DECIMALS: Int = 0

/** Web `fmtNumber(state.time_to_full_charge, 1)` on the charging subtitle. */
private const val TIME_TO_FULL_DECIMALS: Int = 1

/** Web `batteryColor`: `level > 60` → emerald (`#10b981`). */
private const val TONE_GOOD_THRESHOLD: Double = 60.0

/** Web `batteryColor`: `level > 25` → amber (`#f59e0b`); at/below → red (`#ef4444`). */
private const val TONE_WARN_THRESHOLD: Double = 25.0

/** Web `state.is_charging && state.time_to_full_charge > 0` subtitle guard. */
private const val TIME_TO_FULL_VISIBLE_THRESHOLD: Double = 0.0

// ── Input ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The slice of `VehicleState` this surface reads — the native mirror of the six fields the web component
 * pulls off its `state` prop. Modelled as the surface's own input type (not the full generated
 * [VehicleState]) so the projection is asserted off-device with concise fixtures, exactly as the sibling
 * AcDcStatsPanel port carries its own `AcDcBreakdownData`. SI semantics are documented per field.
 *
 * @property batteryLevel the charge percentage 0–100 (web `state.battery_level`); the gauge value.
 * @property ratedRangeMeters the rated range, SI metres (web `state.rated_range`).
 * @property idealRangeMeters the ideal range, SI metres (web `state.ideal_range`).
 * @property isCharging whether the vehicle is charging (web `state.is_charging`).
 * @property chargeRateMeters the charge rate as range-added, SI metres per hour (web `state.charge_rate`).
 * @property timeToFullChargeHours the estimated time to full, in HOURS on the wire (web
 *   `state.time_to_full_charge`); the web renders it verbatim with no SI conversion.
 */
data class BatteryRangeData(
    val batteryLevel: Double,
    val ratedRangeMeters: Double,
    val idealRangeMeters: Double,
    val isCharging: Boolean,
    val chargeRateMeters: Double,
    val timeToFullChargeHours: Double,
) {
    public companion object {
        /** Projects the generated [VehicleState] onto the six fields this surface reads (web `state` prop). */
        public fun from(state: VehicleState): BatteryRangeData =
            BatteryRangeData(
                batteryLevel = state.batteryLevel.toDouble(), // parity:allow Long→Double widening, toDouble substring false positive
                ratedRangeMeters = state.ratedRange,
                idealRangeMeters = state.idealRange,
                isCharging = state.isCharging,
                chargeRateMeters = state.chargeRate,
                timeToFullChargeHours = state.timeToFullCharge,
            )
    }
}

/**
 * The battery gauge tone — the native, color-free analogue of the web `batteryColor(level)` helper. The
 * composable resolves each tone to a design-token color (P1/S9); keeping the threshold logic here (not the
 * Color) keeps the projection pure and unit-tested. Web map: `> 60` emerald → [Good], `> 25` amber → [Warn],
 * otherwise red → [Critical].
 */
enum class BatteryTone { Good, Warn, Critical }

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) and threads into the
 * projection so the render-ready [BatteryRangeDisplay] carries no English literal. Keys map 1:1 to the web
 * `t(...)` calls: `common.battery`, `vehicles.detail.ratedRange`, `vehicles.detail.idealRange`,
 * `common.charging`, `common.notCharging`, `vehicles.detail.fullIn`.
 */
data class BatteryRangeStrings(
    val battery: String,
    val ratedRange: String,
    val idealRange: String,
    val charging: String,
    val notCharging: String,
    val fullIn: String,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. Pure
 * data (no Compose types) so the whole projection is asserted off-device; the per-state instance doubles as
 * the surface's snapshot.
 *
 * @property batteryLevel the gauge value (web `value={state.battery_level}`).
 * @property batteryUnit the gauge unit, `%` (web `unit="%"`).
 * @property batteryLabel the localized gauge label (web `t('common.battery')`).
 * @property tone the gauge tone the composable maps to a token color (web `batteryColor`).
 * @property ratedRangeLabel / [ratedRangeValue] the Rated Range card (web `formatDistance(rated_range, 0)`).
 * @property idealRangeLabel / [idealRangeValue] the Ideal Range card (web `formatDistance(ideal_range, 0)`).
 * @property chargingLabel the Charging card label (web `t('common.charging')`).
 * @property chargingValue the charging value — rate `"{dist}/h"` or the localized "Not Charging" (web ternary).
 * @property chargingActive whether the vehicle is charging; selects the card accent (web green vs cyan).
 * @property chargingSubtitle the "Full in {x}h" line, or `null` when not charging / no estimate (web guard).
 */
data class BatteryRangeDisplay(
    val batteryLevel: Double,
    val batteryUnit: String,
    val batteryLabel: String,
    val tone: BatteryTone,
    val ratedRangeLabel: String,
    val ratedRangeValue: String,
    val idealRangeLabel: String,
    val idealRangeValue: String,
    val chargingLabel: String,
    val chargingValue: String,
    val chargingActive: Boolean,
    val chargingSubtitle: String?,
)

/**
 * Pure projection from the surface's input + display preferences to its render-ready [BatteryRangeDisplay] — a
 * 1:1 port of the derivations the web component performs. The composable resolves [BatteryRangeStrings] from
 * the i18n catalog and the live [UnitFormatter] from the shared settings holder, then hands them here.
 */
object BatteryRangeProjection {
    /** Maps a charge percentage onto its gauge [BatteryTone] — the native `batteryColor` thresholds. */
    fun tone(level: Double): BatteryTone =
        when {
            level > TONE_GOOD_THRESHOLD -> BatteryTone.Good
            level > TONE_WARN_THRESHOLD -> BatteryTone.Warn
            else -> BatteryTone.Critical
        }

    /**
     * Selects the render-ready view for the given [data] (the owning page's `state` prop), the live
     * [formatter] (web `useUnits`), the localized [strings], and the [locale] used only for the
     * hours-to-full number formatting. Reproduces the web derivations verbatim: the SI-floored distance
     * conversions, the charging-vs-not value ternary, and the "Full in {x}h" subtitle guard.
     */
    fun project(
        data: BatteryRangeData,
        formatter: UnitFormatter,
        strings: BatteryRangeStrings,
        locale: Locale,
    ): BatteryRangeDisplay {
        val chargingValue =
            if (data.isCharging) {
                formatter.distance(data.chargeRateMeters) + PER_HOUR_SUFFIX
            } else {
                strings.notCharging
            }
        val chargingSubtitle =
            if (data.isCharging && data.timeToFullChargeHours > TIME_TO_FULL_VISIBLE_THRESHOLD) {
                "${strings.fullIn} ${ChartFormat.number(data.timeToFullChargeHours, TIME_TO_FULL_DECIMALS, locale)}$HOUR_SUFFIX"
            } else {
                null
            }
        return BatteryRangeDisplay(
            batteryLevel = data.batteryLevel,
            batteryUnit = BATTERY_UNIT,
            batteryLabel = strings.battery,
            tone = tone(data.batteryLevel),
            ratedRangeLabel = strings.ratedRange,
            ratedRangeValue = formatter.distance(data.ratedRangeMeters, RANGE_DECIMALS),
            idealRangeLabel = strings.idealRange,
            idealRangeValue = formatter.distance(data.idealRangeMeters, RANGE_DECIMALS),
            chargingLabel = strings.charging,
            chargingValue = chargingValue,
            chargingActive = data.isCharging,
            chargingSubtitle = chargingSubtitle,
        )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a battery
 * level, range, charge rate, or time-to-full — so a diagnostics line can never leak the vehicle's state.
 */
object BatteryRangePanelDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "battery-range-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryRangePanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
