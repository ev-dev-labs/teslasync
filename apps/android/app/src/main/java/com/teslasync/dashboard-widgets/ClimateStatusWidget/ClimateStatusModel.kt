// Pure, framework-free model + projection for the Climate Status dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/ClimateStatusWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ClimateStatusWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling AutomationHistoryWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatestatus

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

private const val FIELD_INSIDE_TEMP = "inside_temp"
private const val FIELD_OUTSIDE_TEMP = "outside_temp"
private const val FIELD_HVAC_POWER = "hvac_power"
private const val FIELD_DEFROST_MODE = "defrost_mode"
private const val FIELD_BATTERY_HEATER_ON = "battery_heater_on"

/** Defrost is shown only when the mode is present, non-blank, and not the `Off` sentinel (web parity). */
private const val DEFROST_OFF = "Off"

/** Temperatures render as whole degrees (web `fmtInt`); HVAC power renders with one decimal (web `fmtNumber(_, 1)`). */
private const val TEMP_DECIMALS = 0
private const val HVAC_POWER_DECIMALS = 1
private const val HVAC_POWER_UNIT = " kW"

/**
 * The widget grid footprint (columns × rows). The web `ClimateStatusWidget` destructures only
 * `vehicleId` from `WidgetProps` and never reads `size`, so the surface renders identically at every
 * footprint; this type exists to mirror the registry's size contract (consumed by the grid host), not
 * to branch the layout.
 */
data class ClimateStatusSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/climate.ts (`climate-status`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object ClimateStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "climate-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "climate"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ClimateStatusWidget"

    /** Default footprint: 1 column × 2 rows. */
    val DEFAULT_SIZE: ClimateStatusSize = ClimateStatusSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: ClimateStatusSize = ClimateStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows. */
    val MAX_SIZE: ClimateStatusSize = ClimateStatusSize(cols = 2, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ClimateStatusSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ClimateStatusSize): ClimateStatusSize =
        ClimateStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** Which status chip a [ClimateChip] represents; the render layer resolves its glyph, tone, and label. */
enum class ClimateChipKind {
    /** Active defrost (web `defrost_mode && defrost_mode !== 'Off'`) — a Snowflake/blue chip. */
    Defrost,

    /** Battery heater on (web `battery_heater_on`) — a Bolt/amber chip. */
    Heater,
}

/**
 * The fully projected, render-ready view of the climate snapshot — the native analogue of everything the
 * web component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly.
 *
 * @property hasData whether a climate snapshot object was decoded (web `climateData` truthy); when false
 *   the surface renders its empty state instead of the rows.
 * @property cabinTempText the localized cabin temperature (web `inside_temp`), already SI→display
 *   converted and unit-suffixed, or the em dash when absent.
 * @property outsideTempText the localized outside temperature (web `outside_temp`), likewise, or the em dash.
 * @property hvacPowerText the HVAC power as "{n.n} kW" (web `hvac_power`), or the em dash when absent.
 * @property chips the ordered status chips to render (Defrost and/or Heater), possibly empty.
 */
data class ClimateStatusDisplay(
    val hasData: Boolean,
    val cabinTempText: String,
    val outsideTempText: String,
    val hvacPowerText: String,
    val chips: List<ClimateChipKind>,
) {
    companion object {
        /** The no-snapshot projection (web `climateData == null`): the surface shows its empty state. */
        val EMPTY: ClimateStatusDisplay =
            ClimateStatusDisplay(
                hasData = false,
                cabinTempText = EM_DASH,
                outsideTempText = EM_DASH,
                hvacPowerText = EM_DASH,
                chips = emptyList(),
            )
    }
}

/**
 * Pure projection from a decoded climate snapshot [JsonElement] to the render-ready
 * [ClimateStatusDisplay] — the native port of the field reads + null/`Off` guards in
 * `ClimateStatusWidget.tsx`. The web reads the compat-alias fields (`inside_temp` / `outside_temp` /
 * `hvac_power` / `defrost_mode` / `battery_heater_on`) off the `/climate/latest` document and treats the
 * temperatures as SI Celsius; this reproduces those exact reads against the typed contract (a field that
 * is absent or not of the expected JSON kind reads as missing → em dash / chip hidden). The
 * SI→display temperature conversion is applied here through the shared [UnitFormatter] (web
 * `useUnits()` + `convertTempFromSI`), keeping the SI source unconverted (Phase-48; ADR-013).
 */
object ClimateStatusProjection {
    /**
     * Project [snapshot] into the render model using [formatter] for the SI→display temperature boundary.
     * A `null`/`JsonNull`/non-object snapshot yields [ClimateStatusDisplay.EMPTY] (web's `climateData`
     * falsy branch).
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
    ): ClimateStatusDisplay {
        val obj = snapshot as? JsonObject ?: return ClimateStatusDisplay.EMPTY

        val insideTempC = obj.doubleField(FIELD_INSIDE_TEMP)
        val outsideTempC = obj.doubleField(FIELD_OUTSIDE_TEMP)
        val hvacPowerKw = obj.doubleField(FIELD_HVAC_POWER)
        val defrostMode = obj.stringField(FIELD_DEFROST_MODE)
        val batteryHeaterOn = obj.boolField(FIELD_BATTERY_HEATER_ON)

        return ClimateStatusDisplay(
            hasData = true,
            cabinTempText = formatter.temperature(insideTempC, TEMP_DECIMALS),
            outsideTempText = formatter.temperature(outsideTempC, TEMP_DECIMALS),
            hvacPowerText = formatHvacPower(hvacPowerKw, formatter.prefs.locale),
            chips = buildChips(defrostMode, batteryHeaterOn),
        )
    }

    /** True when [snapshot] carries no climate object (web `climateData` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** Whether the defrost chip shows (web `defrost_mode && defrost_mode !== 'Off'`). */
    fun showsDefrost(defrostMode: String?): Boolean = !defrostMode.isNullOrBlank() && defrostMode != DEFROST_OFF

    private fun buildChips(
        defrostMode: String?,
        batteryHeaterOn: Boolean,
    ): List<ClimateChipKind> =
        buildList {
            if (showsDefrost(defrostMode)) add(ClimateChipKind.Defrost)
            if (batteryHeaterOn) add(ClimateChipKind.Heater)
        }

    private fun formatHvacPower(
        valueKw: Double?,
        localeTag: String?,
    ): String {
        if (valueKw == null || !valueKw.isFinite()) return EM_DASH
        val pattern = "#,##0." + "0".repeat(HVAC_POWER_DECIMALS)
        val formatted = DecimalFormat(pattern, DecimalFormatSymbols(localeFrom(localeTag))).format(valueKw)
        return "$formatted$HVAC_POWER_UNIT"
    }

    private fun localeFrom(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
}

/** Read a numeric field, or `null` when absent / `JsonNull` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a boolean field, defaulting to `false` when absent / `JsonNull` / not a JSON boolean (web typed `boolean`). */
private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/**
 * The active vehicle id the widget reads climate for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
