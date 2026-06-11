// Pure, framework-free model + projection for the Vehicle Hero Card dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. SI values (range in METERS, cabin/outside temp in °C) are converted
// to the user's display unit here, at the single render-boundary seam (Phase-48 SI-canonical rule;
// web `convertDistanceFromSI` / `convertTempFromSI` + `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VehicleHeroCardWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleherocard

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import io.teslasync.shared.core.units.formatDistance
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.floor

private const val EM_DASH = "\u2014"
private const val SEPARATOR = ", "

/** The web `state?.state ?? 'offline'` fallback when no decodable state is available. */
private const val OFFLINE = "offline"

/** Battery % thresholds (web `batteryColor`: > 50 emerald, > 20 amber, else red). */
private const val BATTERY_HIGH_THRESHOLD = 50
private const val BATTERY_MID_THRESHOLD = 20

/**
 * Charger power renders with one decimal (web `fmtNumber(state.charger_power, 1)`). It is delivered in
 * kW already (the API field is kW, not SI watts — see the source's `SI-floor` note, which lists only
 * `ideal_range` + temps as SI), so it is formatted as-is rather than converted from watts.
 */
private const val CHARGER_POWER_DECIMALS = 1

/** Distance + temperature render as whole units (web `Math.round(...)` + `fmtInt`). */
private const val WHOLE_UNIT_DECIMALS = 0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. Unlike
 * most widgets, `VehicleHeroCardWidget` branches its layout on the footprint (web `isCompact` / `isWide`
 * / `isTall`), so this type drives the composable's view selection and honours the registry min/max.
 */
data class VehicleHeroCardSize(
    val cols: Int,
    val rows: Int,
)

/** Compact (1×1) hero — web `size.cols <= 1 && size.rows <= 1`. */
val VehicleHeroCardSize.isCompact: Boolean get() = cols <= 1 && rows <= 1

/** Wide (≥3 cols) — web `size.cols >= 3`; adds the Outside cell to the metric grid. */
val VehicleHeroCardSize.isWide: Boolean get() = cols >= 3

/** Tall (≥2 rows) — web `size.rows >= 2`; adds the Outside + Ideal Range row when not wide. */
val VehicleHeroCardSize.isTall: Boolean get() = rows >= 2

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`vehicle-hero-card`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object VehicleHeroCardRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "vehicle-hero-card"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "VehicleHeroCardWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = VehicleHeroCardSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = VehicleHeroCardSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = VehicleHeroCardSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: VehicleHeroCardSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VehicleHeroCardSize): VehicleHeroCardSize =
        VehicleHeroCardSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output (web `t('widget.…')` calls). The pure
 * [VehicleHeroCardProjection] reads these to assemble each row's TalkBack content description; the
 * composable additionally renders them as the visible metric labels. The composable builds this from
 * `stringResource`; tests pass a deterministic instance. Keeping i18n out of the projection lets the
 * projection stay a pure, locale-stable function.
 */
data class VehicleHeroCardStrings(
    val battery: String,
    val range: String,
    val cabin: String,
    val outside: String,
    val charging: String,
    val idealRange: String,
)

/**
 * The two cache-then-network feeds the widget composes, folded into one render payload: the resolved
 * [vehicle] (web `useVehicles` → `vehicles?.find/​[0]`, the source of the name / model / trim) and its
 * last-known [state] (web `useVehicleState`, the source of battery / range / temps / charge). A `null`
 * [vehicle] is the widget's empty surface (web `vehicle ? … : <EmptyState/>`); a `null` [state] keeps
 * the card visible with em-dash fallbacks (web `state?.x ?? …`).
 */
data class VehicleHeroCardData(
    val vehicle: Vehicle?,
    val state: VehicleState?,
)

/** Battery-level health band that selects the battery value's color (web `batteryColor`). */
enum class BatteryTier { High, Mid, Low, Unknown }

/**
 * The fully projected, render-ready view of a vehicle for any footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. The composable picks which fields to show per footprint
 * (compact battery hero vs. the full metric grid), exactly as the web `CompactView` / `FullView` split.
 */
data class VehicleHeroCardDisplay(
    val name: String,
    val subtitle: String,
    val status: String,
    val batteryLevel: Int?,
    val batteryText: String,
    val batteryTier: BatteryTier,
    val rangeText: String,
    val cabinText: String,
    val outsideText: String,
    val isCharging: Boolean,
    val chargerPowerText: String?,
    val compactDescription: String,
    val fullDescription: String,
)

/**
 * Pure projection from a resolved [Vehicle] + its (nullable) [VehicleState] to the render-ready
 * [VehicleHeroCardDisplay] — the native port of the inline derivation the web component performs in
 * JSX. SI distances/temperatures are converted to the user's display unit via the shared, golden-tested
 * `formatDistance` / `formatTemperature` (en-US grouping, fixed digits, half-expand rounding); the
 * battery %, charge state, and charger-power kW reproduce the web `?? 0 / ?? false / ?? 'offline'`
 * defaults verbatim.
 */
object VehicleHeroCardProjection {
    /**
     * Project [vehicle] + [state] using the user's [prefs] and the localized [strings]. A `null`
     * [state] yields the fallback card the web renders while a vehicle is enrolled but its state is
     * not yet known (status `offline`, battery / range / temps as an em-dash).
     */
    fun project(
        vehicle: Vehicle,
        state: VehicleState?,
        prefs: UnitPref,
        strings: VehicleHeroCardStrings,
    ): VehicleHeroCardDisplay {
        val name = vehicle.displayName.ifBlank { vehicle.vin }
        val status = state?.state ?: OFFLINE
        val batteryLevel = state?.batteryLevel?.toInt()
        val batteryText = batteryLevel?.let { "$it%" } ?: EM_DASH
        val rangeText = if (state != null) formatDistance(state.idealRange, prefs, WHOLE_UNIT_DECIMALS) else EM_DASH
        val cabinText = if (state != null) formatTemp(state.insideTemp, prefs) else EM_DASH
        val outsideText = if (state != null) formatTemp(state.outsideTemp, prefs) else EM_DASH
        val isCharging = state?.isCharging ?: false
        val chargerPowerText = chargerPowerText(state)
        return VehicleHeroCardDisplay(
            name = name,
            subtitle = subtitle(vehicle),
            status = status,
            batteryLevel = batteryLevel,
            batteryText = batteryText,
            batteryTier = batteryTier(state),
            rangeText = rangeText,
            cabinText = cabinText,
            outsideText = outsideText,
            isCharging = isCharging,
            chargerPowerText = chargerPowerText,
            compactDescription =
                listOf(name, status, "${strings.battery} $batteryText").joinToString(SEPARATOR),
            fullDescription =
                buildList {
                    add(name)
                    add(status)
                    add("${strings.battery} $batteryText")
                    add("${strings.range} $rangeText")
                    add("${strings.cabin} $cabinText")
                    add("${strings.outside} $outsideText")
                    if (isCharging) {
                        add(chargerPowerText?.let { "${strings.charging} $it" } ?: strings.charging)
                    }
                }.joinToString(SEPARATOR),
        )
    }

    /**
     * The card subtitle: model followed by trim (web `{model}{trimBadging ? ' ' + trimBadging : ''}`).
     * The OpenAPI-generated [Vehicle] exposes the trim as `trim_level` (the web `Vehicle` type calls the
     * same datum `trim_badging`); both name the vehicle's trim, so `trimLevel` is the faithful mapping.
     * Blank when neither is present, so the composable can omit an empty subtitle line.
     */
    private fun subtitle(vehicle: Vehicle): String =
        listOf(vehicle.model?.trim().orEmpty(), vehicle.trimLevel?.trim().orEmpty())
            .filter { it.isNotEmpty() }
            .joinToString(" ")

    /** Battery health band (web: no state → muted, > 50 → emerald, > 20 → amber, else red). */
    private fun batteryTier(state: VehicleState?): BatteryTier {
        val level = state?.batteryLevel ?: return BatteryTier.Unknown
        return when {
            level > BATTERY_HIGH_THRESHOLD -> BatteryTier.High
            level > BATTERY_MID_THRESHOLD -> BatteryTier.Mid
            else -> BatteryTier.Low
        }
    }

    /**
     * Whole-degree temperature for display (web `${Math.round(convertTempFromSI(...))}${tempUnit}`).
     * JS `Math.round` rounds halves toward +∞ (`-2.5 -> -2`), which differs from the shared formatter's
     * half-away-from-zero for negative half-degree (winter) readings, so it is reproduced exactly with
     * `floor(x + 0.5)`. No grouping is needed (temperatures are small) and no space precedes the unit.
     */
    private fun formatTemp(
        celsius: Double,
        prefs: UnitPref,
    ): String {
        val display = convertTempFromSI(celsius, prefs.temperature)
        return "${floor(display + 0.5).toLong()}${prefs.temperature.label}"
    }

    /**
     * The charge banner's power figure (web shows it only when `is_charging && charger_power > 0`).
     * `null` hides the figure entirely; otherwise `"{kW} kW"` with the web's one-decimal precision.
     */
    private fun chargerPowerText(state: VehicleState?): String? {
        if (state == null || !state.isCharging || state.chargerPower <= 0.0) return null
        return "${formatKilowatts(state.chargerPower)} kW"
    }

    /**
     * Locale-stable kW formatter (web `fmtNumber(value, 1)`): grouped thousands, one fraction digit,
     * half-up rounding of the value's SHORTEST decimal representation. Rounding the `Double.toString`
     * form (via [BigDecimal]) — not the raw binary double — reproduces the web `Intl.NumberFormat`
     * contract the shared `formatNumber` also uses, so e.g. `48.05` renders `"48.1"`, not `"48.0"`.
     * [Locale.US] keeps grouping/decimal separators deterministic.
     */
    private fun formatKilowatts(value: Double): String =
        DecimalFormat("#,##0." + "0".repeat(CHARGER_POWER_DECIMALS), DecimalFormatSymbols(Locale.US))
            .format(BigDecimal(value.toString()).setScale(CHARGER_POWER_DECIMALS, RoundingMode.HALF_UP))
}
