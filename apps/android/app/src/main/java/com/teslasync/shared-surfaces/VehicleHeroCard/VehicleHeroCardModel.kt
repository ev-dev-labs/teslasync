// Pure, framework-free model + projection + diagnostics for the VehicleHeroCard shared surface — the
// native analogue of web/src/components/vehicles/VehicleHeroCard.tsx. No Compose, no Android framework,
// no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer over these pure functions (the accepted sibling-surface
// contract, e.g. MetricCard / VehicleHeroCardWidget).
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): the
// web `VehicleHeroCard` is a PRESENTATIONAL vehicle summary card, not a data-fetching view. Its parent
// loads the vehicle + its (nullable) live state and passes them down as props (`vehicle`,
// `vehicleState`, `photoUrl`); the card derives, from those props plus the user's unit preferences
// (web `useUnits`), the radial gauges (battery / range / inside / outside), an eight-cell stat grid, the
// optional hero photo, and three quick-action links. Its real, fully-reproduced render branches are:
//   * the optional hero photo block (web `photoUrl ? <img> : null`);
//   * the identity row — name + `StatusBadge` + VIN + model `Badge` (always rendered);
//   * the four gauges and the stat grid, rendered only when a live `vehicleState` is present
//     (web `{vs && (...)}`); when it is absent the card keeps its identity + actions and shows a
//     friendly "offline" empty region instead of the live metrics (never a blank box);
//   * the three navigation actions (Details / Commands / Live Map), always rendered.
//
// Why the generic data-surface states (loading / error / stale / offline-refresh) are intentionally
// absent: this card fetches nothing — it is handed finished props — so it never errors, goes stale, or
// refreshes. Modelling those would fabricate behaviour the web spec does not have (Honesty Covenant: no
// scope narrowing, no silent drift), exactly as the accepted MetricCard presentational port documents.
// The one "no value" notion the web component has is `vehicleState == null` (the car is offline /
// asleep), which this surface renders as the friendly empty metrics region above.
//
// SI on the wire, display at the boundary (Phase-48 SI-canonical): the state endpoint delivers range +
// odometer in METERS and cabin / outside temperature in °C; this projection converts them to the user's
// display unit here, the single render-boundary seam, via the shared golden-tested `convert*FromSI`
// helpers — never by mutating the source. `power` is the one field the web does NOT convert: the Tesla
// `drive_state.power` field is delivered in kW (not SI watts), so it is formatted as-is with the web
// `fmtNumber` contract, mirroring how the sibling VehicleHeroCardWidget treats `charger_power`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehicleHeroCard — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so
// the package intentionally diverges from the path, exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleherocard

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.floor

/** Em dash shown wherever a value is unknown — the web `'\u2014'` empty marker. */
internal const val VEHICLE_HERO_EM_DASH: String = "\u2014"

/** The web `state?.state ?? vehicle.state ?? 'offline'` fallback when no live state is decodable. */
internal const val VEHICLE_HERO_OFFLINE: String = "offline"

/** Universal unit symbols the web renders verbatim regardless of locale. */
internal const val VEHICLE_HERO_PERCENT: String = "%"
internal const val VEHICLE_HERO_KW: String = "kW"

/** Battery gauge color threshold — web `state.battery_level > 20 ? cyan : red`. */
internal const val VEHICLE_HERO_BATTERY_OK_THRESHOLD: Int = 20

/** Gauge maxima — web `RadialGauge max=…` (battery 100; range 644 km / 400 mi; temp 50 °C / 122 °F). */
internal const val VEHICLE_HERO_BATTERY_MAX: Double = 100.0
internal const val VEHICLE_HERO_RANGE_MAX_KM: Double = 644.0
internal const val VEHICLE_HERO_RANGE_MAX_MI: Double = 400.0
internal const val VEHICLE_HERO_TEMP_MAX_C: Double = 50.0
internal const val VEHICLE_HERO_TEMP_MAX_F: Double = 122.0

/** Distance + temperature render as whole units (web `Math.round(...)` + `fmtInt`). */
private const val WHOLE_UNIT_DECIMALS: Int = 0

/** The web `fmtNumber(power)` default precision (its global precision, default 2) when none is set. */
private const val POWER_DEFAULT_DECIMALS: Int = 2

/**
 * The canonical FSM vehicle-state set the web normalizes against — web
 * `web/src/types/fsm/vehicle.ts` `VEHICLE_STATES`, consumed by `VehicleHeroCard`'s `toStatus`. Any
 * value outside this set resolves to [VEHICLE_HERO_OFFLINE] so the status badge never shows an unknown
 * FSM state.
 */
internal val VEHICLE_HERO_FSM_STATES: Set<String> =
    setOf("online", "driving", "charging", "parked", "updating", "asleep", "offline")

/**
 * Canonical registry metadata for the VehicleHeroCard surface. The diagnostics [SLUG] is emitted with
 * the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`VehicleHeroCard`).
 */
object VehicleHeroCardRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "vehicle-hero-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "VehicleHeroCard"
}

/**
 * The arc / value accent a gauge resolves to — the native tag for the web hard-coded gauge colors
 * (`#22d3ee` cyan, `#ef4444` red, `#4ade80` green, `#f59e0b` amber, `#a78bfa` purple). The render
 * boundary maps each variant onto a theme token (never a raw hex), so light / dark / high-contrast stay
 * correct.
 */
enum class VehicleHeroAccent {
    /** Battery ≥ threshold (web `#22d3ee`) — maps to the info token. */
    Cyan,

    /** Battery below threshold (web `#ef4444`) — maps to the danger token. */
    Red,

    /** Range gauge (web `#4ade80`) — maps to the success token. */
    Green,

    /** Inside-temperature gauge (web `#f59e0b`) — maps to the warning token. */
    Amber,

    /** Outside-temperature gauge (web `#a78bfa`) — maps to the chart power-series token. */
    Purple,
}

/**
 * One render-ready radial-gauge spec — the native mirror of a web `<RadialGauge value max label unit
 * color>`. [value] is already converted to the user's display unit and rounded to whole units (web
 * `Math.round`); [max] + [unit] reproduce the web props; [accent] selects the arc color at the render
 * boundary. The localized label is supplied by the composable from the i18n catalog, so this spec stays
 * locale-pure.
 */
data class VehicleHeroGauge(
    val value: Double,
    val max: Double,
    val unit: String,
    val accent: VehicleHeroAccent,
)

/**
 * The fully projected, render-ready view of a vehicle hero card — the native analogue of everything the
 * web component computes before returning JSX. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host. The composable pairs the localized labels with these fields; nothing
 * here is locale-dependent except the already-formatted numeric strings (en-US display contract).
 *
 * @property name the card title (web `vehicle.display_name`), falling back to the VIN when blank.
 * @property vin the monospace VIN line (web `vehicle.vin`).
 * @property model the trailing model badge text (web `vehicle.model`); blank ⇒ the badge is omitted.
 * @property status the resolved, FSM-normalized status for the badge (web `toStatus(...)`).
 * @property hasState whether a live state was supplied (web `vs`); gates the gauges + stat grid.
 * @property batteryGauge / rangeGauge / insideGauge / outsideGauge the four gauge specs (state present).
 * @property insideTempText / outsideTempText / odometerText / rangeText the stat-grid numeric strings.
 * @property isLocked / sentryOn the boolean stats resolved to localized text by the composable.
 * @property firmware the firmware stat (web `vs.software_version`), em dash when blank.
 * @property powerText the drivetrain power stat (web `fmtNumber(vs.power)`), rendered in kW.
 */
data class VehicleHeroCardDisplay(
    val name: String,
    val vin: String,
    val model: String,
    val status: String,
    val hasState: Boolean,
    val batteryGauge: VehicleHeroGauge,
    val rangeGauge: VehicleHeroGauge,
    val insideGauge: VehicleHeroGauge,
    val outsideGauge: VehicleHeroGauge,
    val distanceUnit: String,
    val temperatureUnit: String,
    val insideTempText: String,
    val outsideTempText: String,
    val odometerText: String,
    val rangeText: String,
    val isLocked: Boolean,
    val sentryOn: Boolean,
    val firmware: String,
    val powerText: String,
)

/**
 * Pure projection from the web props ([vehicle] + nullable [state]) and the user's unit preferences
 * ([prefs]) to the render-ready [VehicleHeroCardDisplay] — the native port of the inline derivation the
 * web component performs in JSX. SI distances / temperatures are converted to the display unit via the
 * shared, golden-tested `convert*FromSI`; whole-unit rounding reproduces the web `Math.round`; grouped
 * integers reproduce `fmtInt`; the power figure reproduces `fmtNumber(power)` at the user's precision.
 */
object VehicleHeroCardProjection {
    /**
     * Project [vehicle] + [state] using the user's [prefs]. A `null` [state] yields the offline card the
     * web renders while a vehicle is enrolled but its live state is unknown (status `offline`, no gauges
     * / stat grid); the identity + actions are unaffected.
     */
    fun project(
        vehicle: Vehicle,
        state: VehicleState?,
        prefs: UnitPref,
    ): VehicleHeroCardDisplay {
        val distanceUnit = prefs.distance.label
        val temperatureUnit = prefs.temperature.label
        return VehicleHeroCardDisplay(
            name = vehicle.displayName.ifBlank { vehicle.vin },
            vin = vehicle.vin,
            model = vehicle.model?.trim().orEmpty(),
            status = resolveStatus(state),
            hasState = state != null,
            batteryGauge = batteryGauge(state),
            rangeGauge = rangeGauge(state, prefs),
            insideGauge = tempGauge(state?.insideTemp, prefs, VehicleHeroAccent.Amber),
            outsideGauge = tempGauge(state?.outsideTemp, prefs, VehicleHeroAccent.Purple),
            distanceUnit = distanceUnit,
            temperatureUnit = temperatureUnit,
            insideTempText = wholeTempText(state?.insideTemp, prefs),
            outsideTempText = wholeTempText(state?.outsideTemp, prefs),
            odometerText = if (state != null) groupedDistanceText(state.odometer, prefs) else VEHICLE_HERO_EM_DASH,
            rangeText = if (state != null) wholeDistanceText(state.ratedRange, prefs) else VEHICLE_HERO_EM_DASH,
            isLocked = state?.isLocked ?: false,
            sentryOn = state?.sentryMode ?: false,
            firmware = state?.softwareVersion?.ifBlank { VEHICLE_HERO_EM_DASH } ?: VEHICLE_HERO_EM_DASH,
            powerText = powerStat(state, prefs),
        )
    }

    /**
     * The drivetrain power stat (web `fmtNumber(vs.power)`, unit `kW`). The Tesla `drive_state.power`
     * field is delivered in kW already (not SI watts), so it is formatted as-is at the user's precision —
     * never divided down from watts. `null` state renders the em dash.
     */
    private fun powerStat(
        state: VehicleState?,
        prefs: UnitPref,
    ): String =
        if (state != null) {
            formatPlainNumber(state.power, prefs.precision ?: POWER_DEFAULT_DECIMALS)
        } else {
            VEHICLE_HERO_EM_DASH
        }

    /**
     * Web `toStatus(vehicleState?.state ?? vehicle.state ?? 'offline')`: an unknown / absent state
     * normalizes to offline. The OpenAPI-generated [Vehicle] carries no `state` field (it is a
     * list-endpoint datum the web prop adds), so the live state is the only source — `null` is offline,
     * matching the sibling widget's `state?.state ?: OFFLINE`. The membership check is exact (the API
     * emits canonical lower-case FSM states), reproducing the web `state in FSM_REGISTRY.vehicle.states`.
     */
    private fun resolveStatus(state: VehicleState?): String {
        val raw = state?.state?.trim()?.takeIf { it.isNotEmpty() } ?: VEHICLE_HERO_OFFLINE
        return if (raw in VEHICLE_HERO_FSM_STATES) raw else VEHICLE_HERO_OFFLINE
    }

    /** Battery gauge (web `value={battery_level} max=100 color={level > 20 ? cyan : red}`). */
    private fun batteryGauge(state: VehicleState?): VehicleHeroGauge {
        val level = state?.batteryLevel?.toDouble() ?: 0.0 // parity:allow Long→Double; scanner matches "toDo" in toDouble
        val accent = if (level > VEHICLE_HERO_BATTERY_OK_THRESHOLD) VehicleHeroAccent.Cyan else VehicleHeroAccent.Red
        return VehicleHeroGauge(value = level, max = VEHICLE_HERO_BATTERY_MAX, unit = VEHICLE_HERO_PERCENT, accent = accent)
    }

    /** Range gauge (web `value={round(convert(rated_range))} max={km?644:400} color=green`). */
    private fun rangeGauge(
        state: VehicleState?,
        prefs: UnitPref,
    ): VehicleHeroGauge {
        val value = if (state != null) jsRound(convertDistanceFromSI(state.ratedRange, prefs.distance)) else 0.0
        return VehicleHeroGauge(
            value = value,
            max = rangeMax(prefs.distance),
            unit = prefs.distance.label,
            accent = VehicleHeroAccent.Green,
        )
    }

    /** Temperature gauge (web `value={round(convert(temp))} max={C?50:122}`); [accent] selects the hue. */
    private fun tempGauge(
        celsius: Double?,
        prefs: UnitPref,
        accent: VehicleHeroAccent,
    ): VehicleHeroGauge {
        val value = if (celsius != null) jsRound(convertTempFromSI(celsius, prefs.temperature)) else 0.0
        return VehicleHeroGauge(value = value, max = tempMax(prefs.temperature), unit = prefs.temperature.label, accent = accent)
    }

    /** Web range gauge maximum scales with the display unit (`km ? 644 : 400`). */
    private fun rangeMax(unit: DistanceUnitPref): Double =
        if (unit == DistanceUnitPref.KM) VEHICLE_HERO_RANGE_MAX_KM else VEHICLE_HERO_RANGE_MAX_MI

    /** Web temperature gauge maximum scales with the display unit (`°C ? 50 : 122`). */
    private fun tempMax(unit: TemperatureUnitPref): Double =
        if (unit == TemperatureUnitPref.CELSIUS) VEHICLE_HERO_TEMP_MAX_C else VEHICLE_HERO_TEMP_MAX_F

    /** A whole-unit temperature stat string (web passes the rounded number; React renders it bare). */
    private fun wholeTempText(
        celsius: Double?,
        prefs: UnitPref,
    ): String = if (celsius != null) jsRound(convertTempFromSI(celsius, prefs.temperature)).toLong().toString() else VEHICLE_HERO_EM_DASH

    /** A whole-unit distance stat string with no grouping (web `value={rangeDisplay}`, a bare number). */
    private fun wholeDistanceText(
        meters: Double,
        prefs: UnitPref,
    ): String = jsRound(convertDistanceFromSI(meters, prefs.distance)).toLong().toString()

    /** A grouped whole-unit distance stat string (web `fmtInt(round(convert(odometer)))`). */
    private fun groupedDistanceText(
        meters: Double,
        prefs: UnitPref,
    ): String = formatPlainNumber(jsRound(convertDistanceFromSI(meters, prefs.distance)), WHOLE_UNIT_DECIMALS)

    /** JS `Math.round` (rounds halves toward +∞: `-2.5 -> -2`), reproduced with `floor(x + 0.5)`. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    /**
     * Locale-stable `fmtNumber` parity (web `Intl.NumberFormat` with min == max == [digits], `halfExpand`
     * rounding, en-US grouping): rounds the value's shortest decimal representation half-away-from-zero
     * via [BigDecimal], then groups thousands with [Locale.US]. A non-finite value renders as `0` (web
     * `safeNumber`). So e.g. `48.05` at 1 digit renders `"48.1"`, `50000` at 0 digits renders `"50,000"`.
     */
    private fun formatPlainNumber(
        value: Double,
        digits: Int,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val pattern = if (digits > 0) "#,##0." + "0".repeat(digits) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
            .format(BigDecimal(safe.toString()).setScale(digits, RoundingMode.HALF_UP))
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened`
 * event tagged with the surface [VehicleHeroCardRegistration.SLUG] — never the vehicle name, VIN,
 * battery level, range, or location, so a diagnostics line can never leak what the card displays. Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it once per open.
 */
object VehicleHeroCardDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to VehicleHeroCardRegistration.SLUG))
    }
}
