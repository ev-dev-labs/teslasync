// Pure, framework-free model + projection for the Climate Control Panel dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx). No Compose, no Android framework,
// no HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ClimateControlPanelWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatecontrolpanel

import io.teslasync.android.components.datadisplay.FreshnessAge
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

// ── Canonical `/climate/latest` field names the widget reads (web snake_case keys). ───────────────────
private const val FIELD_INSIDE_TEMP = "inside_temp"
private const val FIELD_OUTSIDE_TEMP = "outside_temp"
private const val FIELD_HVAC_POWER = "hvac_power"
private const val FIELD_HVAC_AC_ENABLED = "hvac_ac_enabled"
private const val FIELD_HVAC_FAN_SPEED = "hvac_fan_speed"
private const val FIELD_STEERING_HEAT = "hvac_steering_wheel_heat_level"
private const val FIELD_SEAT_LEFT = "seat_heater_left"
private const val FIELD_SEAT_RIGHT = "seat_heater_right"
private const val FIELD_SEAT_REAR_LEFT = "seat_heater_rear_left"
private const val FIELD_SEAT_REAR_CENTER = "seat_heater_rear_center"
private const val FIELD_SEAT_REAR_RIGHT = "seat_heater_rear_right"
private const val FIELD_DEFROST_MODE = "defrost_mode"
private const val FIELD_BATTERY_HEATER_ON = "battery_heater_on"

/** Defrost is shown only when the mode is present, non-blank, and not the `Off` sentinel (web parity). */
private const val DEFROST_OFF = "Off"

/** Temperatures render as whole degrees (web `fmtInt`). */
private const val TEMP_DECIMALS = 0

/** HVAC power renders with one decimal (web `fmtNumber(_, 1)`) and a " kW" suffix. */
private const val HVAC_POWER_DECIMALS = 1
private const val HVAC_POWER_UNIT = " kW"

/** Seat heaters + steering wheel render their level out of three (web `{level}/3`). */
private const val LEVEL_MAX = "/3"

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` and the single size
 * branch in the web source: [isCompact] (`size.cols <= 1 && size.rows <= 1`) renders the single-temperature
 * hero, otherwise the full HVAC / temperature / fan / seat-heater panel is shown.
 */
data class ClimateControlPanelSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a 1×1 footprint (web `size.cols <= 1 && size.rows <= 1`): show the compact temperature hero. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/climate.ts (`climate-control-panel`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object ClimateControlPanelRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "climate-control-panel"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "climate"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ClimateControlPanelWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: ClimateControlPanelSize = ClimateControlPanelSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: ClimateControlPanelSize = ClimateControlPanelSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: ClimateControlPanelSize = ClimateControlPanelSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ClimateControlPanelSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ClimateControlPanelSize): ClimateControlPanelSize =
        ClimateControlPanelSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [ClimateControlPanelProjection] reads the content labels; the composable chrome additionally reads
 * [refreshLabel] / [refreshingLabel] / [offlineLabel] / [loadingLabel] / [formatRelative]. The composable
 * builds this from `stringResource` (P1/S10); tests pass a deterministic instance. Keeping i18n out of the
 * projection lets the projection stay a pure, locale-stable function.
 */
data class ClimateControlPanelStrings(
    val title: String,
    val noData: String,
    val hvacOn: String,
    val hvacOff: String,
    val cabin: String,
    val outside: String,
    val fanSpeed: String,
    val steeringHeat: String,
    val off: String,
    val seatFL: String,
    val seatFR: String,
    val seatRL: String,
    val seatRC: String,
    val seatRR: String,
    val noSeatHeat: String,
    val defrost: String,
    val batHeater: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val loadingLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/** One active seat heater — its localized seat [label] (FL/FR/RL/RC/RR) and its `level/3` [levelText]. */
data class SeatHeaterChip(
    val label: String,
    val levelText: String,
)

/** Which bottom status chip a chip represents; the render layer resolves its glyph, tone, and label. */
enum class ClimateChipKind {
    /** Active defrost (web `defrost_mode && defrost_mode !== 'Off'`) — a Snowflake/blue chip. */
    Defrost,

    /** Battery heater on (web `battery_heater_on`) — a Bolt/amber chip. */
    BatHeater,
}

/**
 * The fully projected, render-ready view of the climate snapshot — the native analogue of everything the
 * web component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly.
 *
 * @property hasData whether a climate snapshot object was decoded (web `climateData` truthy); when false
 *   the surface renders its empty state instead of the panel.
 * @property hvacOn whether HVAC is on (web `hvac_power > 0 || hvac_ac_enabled === true`).
 * @property hvacStatusText the localized HVAC on/off badge text.
 * @property hvacPowerText the HVAC draw as "{n.n} kW" (web `hvac_power`), or `null` when absent / not > 0.
 * @property cabinTempText the localized cabin temperature (web `inside_temp`), SI→display converted and
 *   unit-suffixed, or the em dash when absent.
 * @property outsideTempText the localized outside temperature (web `outside_temp`), likewise.
 * @property fanSpeedText the fan-speed level (web `hvac_fan_speed`) as a plain number, or the em dash.
 * @property wheelHeatText the steering-wheel heat as "{level}/3" (web `hvac_steering_wheel_heat_level`),
 *   or the localized "Off" when the level is zero.
 * @property seatHeaters the ordered active seat heaters (web's `> 0` rows), possibly empty.
 * @property chips the ordered bottom status chips to render (Defrost and/or Bat Heater), possibly empty.
 */
data class ClimateControlPanelDisplay(
    val hasData: Boolean,
    val hvacOn: Boolean,
    val hvacStatusText: String,
    val hvacPowerText: String?,
    val cabinLabel: String,
    val cabinTempText: String,
    val outsideLabel: String,
    val outsideTempText: String,
    val fanSpeedLabel: String,
    val fanSpeedText: String,
    val wheelHeatLabel: String,
    val wheelHeatText: String,
    val seatHeaters: List<SeatHeaterChip>,
    val noSeatHeatLabel: String,
    val chips: List<ClimateChipKind>,
) {
    /** Whether any seat heater is active (web `seatHeaters.length > 0`). */
    val hasSeatHeaters: Boolean get() = seatHeaters.isNotEmpty()

    companion object {
        /** The no-snapshot projection (web `climateData == null`): the surface shows its empty state. */
        fun empty(strings: ClimateControlPanelStrings): ClimateControlPanelDisplay =
            ClimateControlPanelDisplay(
                hasData = false,
                hvacOn = false,
                hvacStatusText = strings.hvacOff,
                hvacPowerText = null,
                cabinLabel = strings.cabin,
                cabinTempText = strings.emDash,
                outsideLabel = strings.outside,
                outsideTempText = strings.emDash,
                fanSpeedLabel = strings.fanSpeed,
                fanSpeedText = strings.emDash,
                wheelHeatLabel = strings.steeringHeat,
                wheelHeatText = strings.off,
                seatHeaters = emptyList(),
                noSeatHeatLabel = strings.noSeatHeat,
                chips = emptyList(),
            )
    }
}

/**
 * Pure projection from a decoded climate snapshot [JsonElement] to the render-ready
 * [ClimateControlPanelDisplay] — the native port of the field reads + null/`Off`/`> 0` guards in
 * `ClimateControlPanelWidget.tsx`. The web reads the compat-alias fields off the `/climate/latest`
 * document and treats the temperatures as SI Celsius; this reproduces those exact reads against the typed
 * contract (a field that is absent or not of the expected JSON kind reads as missing → em dash / hidden).
 * The SI→display temperature conversion is applied here through the shared [UnitFormatter] (web
 * `useUnits()` + `convertTempFromSI`), keeping the SI source unconverted (Phase-48; ADR-013).
 */
object ClimateControlPanelProjection {
    /**
     * Project [snapshot] into the render model using [formatter] for the SI→display temperature boundary
     * and [strings] for every localized label. A `null`/`JsonNull`/non-object snapshot yields
     * [ClimateControlPanelDisplay.empty] (web's `climateData` falsy branch).
     */
    fun project(
        snapshot: JsonElement?,
        strings: ClimateControlPanelStrings,
        formatter: UnitFormatter,
    ): ClimateControlPanelDisplay {
        val obj = snapshot as? JsonObject ?: return ClimateControlPanelDisplay.empty(strings)

        val insideTempC = obj.doubleField(FIELD_INSIDE_TEMP)
        val outsideTempC = obj.doubleField(FIELD_OUTSIDE_TEMP)
        val hvacPowerKw = obj.doubleField(FIELD_HVAC_POWER)
        val hvacAcEnabled = obj.boolField(FIELD_HVAC_AC_ENABLED)
        val fanSpeed = obj.doubleField(FIELD_HVAC_FAN_SPEED)
        val steeringHeat = obj.doubleField(FIELD_STEERING_HEAT) ?: 0.0
        val defrostMode = obj.stringField(FIELD_DEFROST_MODE)
        val batteryHeaterOn = obj.boolField(FIELD_BATTERY_HEATER_ON)

        val localeTag = formatter.prefs.locale
        val hvacOn = (hvacPowerKw != null && hvacPowerKw > 0) || hvacAcEnabled

        return ClimateControlPanelDisplay(
            hasData = true,
            hvacOn = hvacOn,
            hvacStatusText = if (hvacOn) strings.hvacOn else strings.hvacOff,
            hvacPowerText = if (hvacPowerKw != null && hvacPowerKw > 0) formatHvacPower(hvacPowerKw, localeTag) else null,
            cabinLabel = strings.cabin,
            cabinTempText = formatter.temperature(insideTempC, TEMP_DECIMALS),
            outsideLabel = strings.outside,
            outsideTempText = formatter.temperature(outsideTempC, TEMP_DECIMALS),
            fanSpeedLabel = strings.fanSpeed,
            fanSpeedText = fanSpeed?.let { formatLevel(it, localeTag) } ?: strings.emDash,
            wheelHeatLabel = strings.steeringHeat,
            wheelHeatText = if (steeringHeat > 0) "${formatLevel(steeringHeat, localeTag)}$LEVEL_MAX" else strings.off,
            seatHeaters = buildSeatHeaters(obj, strings, localeTag),
            noSeatHeatLabel = strings.noSeatHeat,
            chips = buildChips(defrostMode, batteryHeaterOn),
        )
    }

    /** True when [snapshot] carries no climate object (web `climateData` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** Whether HVAC counts as on (web `hvac_power > 0 || hvac_ac_enabled === true`). */
    fun isHvacOn(
        hvacPowerKw: Double?,
        hvacAcEnabled: Boolean,
    ): Boolean = (hvacPowerKw != null && hvacPowerKw > 0) || hvacAcEnabled

    /** Whether the defrost chip shows (web `defrost_mode && defrost_mode !== 'Off'`). */
    fun showsDefrost(defrostMode: String?): Boolean = !defrostMode.isNullOrBlank() && defrostMode != DEFROST_OFF

    private fun buildSeatHeaters(
        obj: JsonObject,
        strings: ClimateControlPanelStrings,
        localeTag: String?,
    ): List<SeatHeaterChip> =
        buildList {
            addSeat(obj, FIELD_SEAT_LEFT, strings.seatFL, localeTag)
            addSeat(obj, FIELD_SEAT_RIGHT, strings.seatFR, localeTag)
            addSeat(obj, FIELD_SEAT_REAR_LEFT, strings.seatRL, localeTag)
            addSeat(obj, FIELD_SEAT_REAR_CENTER, strings.seatRC, localeTag)
            addSeat(obj, FIELD_SEAT_REAR_RIGHT, strings.seatRR, localeTag)
        }

    private fun MutableList<SeatHeaterChip>.addSeat(
        obj: JsonObject,
        field: String,
        label: String,
        localeTag: String?,
    ) {
        val level = obj.doubleField(field)
        if (level != null && level > 0) {
            add(SeatHeaterChip(label = label, levelText = "${formatLevel(level, localeTag)}$LEVEL_MAX"))
        }
    }

    private fun buildChips(
        defrostMode: String?,
        batteryHeaterOn: Boolean,
    ): List<ClimateChipKind> =
        buildList {
            if (showsDefrost(defrostMode)) add(ClimateChipKind.Defrost)
            if (batteryHeaterOn) add(ClimateChipKind.BatHeater)
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

    /**
     * Formats a level the way the web interpolates a JS number (`${level}`): a whole value renders with no
     * decimals, a fractional value keeps its (locale-stable, trailing-zero-trimmed) fraction. Levels are
     * dimensionless, so there is no unit conversion.
     */
    private fun formatLevel(
        value: Double,
        localeTag: String?,
    ): String =
        if (value % 1.0 == 0.0) {
            value.toLong().toString()
        } else {
            DecimalFormat("0.######", DecimalFormatSymbols(localeFrom(localeTag))).format(value)
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
