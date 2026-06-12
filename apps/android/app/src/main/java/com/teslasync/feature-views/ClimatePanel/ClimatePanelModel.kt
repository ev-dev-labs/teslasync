// Pure, framework-free model + projection for the ClimatePanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest
// gate, so the composable stays a thin render layer. The web component receives a `ClimateSnapshot`
// prop and, when it is present, renders Cabin/Outside temperatures (two `MetricCard`s), Driver/Passenger
// setpoints, the HVAC state, a six-segment fan-speed meter, and three status chips (Defrost / Climate /
// Precondition); when the snapshot is null it renders a friendly "No climate data available" empty state.
// The readers below pull the typed SI fields (`inside_temp_c`, `outside_temp_c`, `driver_setpoint_c`,
// `passenger_setpoint_c`, `hvac_state`, `defrost_mode`, `is_climate_on`, `is_preconditioning`,
// `fan_status`) and narrow each exactly as the web's typed contract does (a field that is absent or of
// the wrong JSON kind reads as missing). The SI→display temperature conversion is applied through the
// shared [UnitFormatter] (web `useUnits().formatTemperature`), keeping the SI source unconverted
// (Phase-48 SI-canonical rule; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ClimatePanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling GForcePanel / ClimateStatusWidget
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatepanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * any climate payload, so a diagnostics line can never leak the vehicle's identity or cabin state.
 */
const val CLIMATE_PANEL_SLUG: String = "ClimatePanel"

/** Em dash shown for a missing reading — the web `hvac_state ?? '—'` fallback and the formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

/** The fan-speed meter has six graduated segments — the web `[1, 2, 3, 4, 5, 6].map(...)` ladder. */
const val FAN_SPEED_BARS: Int = 6

/** Fan level shown when `fan_status` is absent — the web `fan_status ?? 0` fallback. */
internal const val FAN_LEVEL_NONE: Int = 0

// The typed SI panel fields the web reads off the `ClimateSnapshot` prop. Temperatures are degrees
// Celsius (SI); the readers narrow each with the web's typed `number | string | boolean | null` contract.
private const val FIELD_INSIDE_TEMP_C = "inside_temp_c"
private const val FIELD_OUTSIDE_TEMP_C = "outside_temp_c"
private const val FIELD_DRIVER_SETPOINT_C = "driver_setpoint_c"
private const val FIELD_PASSENGER_SETPOINT_C = "passenger_setpoint_c"
private const val FIELD_HVAC_STATE = "hvac_state"
private const val FIELD_DEFROST_MODE = "defrost_mode"
private const val FIELD_IS_CLIMATE_ON = "is_climate_on"
private const val FIELD_IS_PRECONDITIONING = "is_preconditioning"
private const val FIELD_FAN_STATUS = "fan_status"

/** Defrost is "active" only when the mode is present, non-blank, and not the `Off` sentinel (web parity). */
private const val DEFROST_OFF = "Off"

/**
 * Which status chip a [ClimateChipState] represents; the render layer resolves its glyph + tone from this.
 * The web renders the three chips in this exact source order.
 */
enum class ClimateChip {
    /** Defrost mode (web `defrost_mode && defrost_mode !== 'Off'`) — a Snowflake/blue chip. */
    Defrost,

    /** Climate on/off (web `is_climate_on`) — a Bolt/green chip. */
    Climate,

    /** Preconditioning on/off (web `is_preconditioning`) — an amber chip. */
    Precondition,
}

/**
 * The climate readings this surface consumes — the native mirror of the typed `ClimateSnapshot` fields
 * the web component reads. Pure data so the projection stays unit-testable off-device. Temperatures are
 * SI degrees Celsius (converted to the user's unit only at the render boundary); `null` means the field
 * was absent or not of its expected JSON kind.
 */
data class ClimateReading(
    val insideTempC: Double?,
    val outsideTempC: Double?,
    val driverSetpointC: Double?,
    val passengerSetpointC: Double?,
    val hvacState: String?,
    val defrostMode: String?,
    val isClimateOn: Boolean,
    val isPreconditioning: Boolean,
    val fanStatus: Int?,
) {
    companion object {
        /** The all-absent reading used for a non-object snapshot (the web null-prop branch). */
        val EMPTY: ClimateReading =
            ClimateReading(
                insideTempC = null,
                outsideTempC = null,
                driverSetpointC = null,
                passengerSetpointC = null,
                hvacState = null,
                defrostMode = null,
                isClimateOn = false,
                isPreconditioning = false,
                fanStatus = null,
            )
    }
}

/**
 * One render-ready status chip — the native analogue of one web status `<span>`. Pure data (no Compose
 * types) so every branch is unit-tested directly. [active] selects the chip's tone (web's colored vs
 * muted styling); [valueText] is the second token (the mode / "On" / "Off"); [label] is the full merged
 * phrase the chip renders and announces.
 */
data class ClimateChipState(
    val chip: ClimateChip,
    val active: Boolean,
    val valueText: String,
    val label: String,
)

/**
 * The fully projected, render-ready view of the climate snapshot — the native analogue of everything the
 * web component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly. When [hasData] is false the surface renders its empty state (web `climateData == null`);
 * otherwise it renders the temperature cards, setpoint rows, HVAC-state row, fan meter, and chips.
 *
 * @property hasData whether a climate snapshot object was decoded (web `climateData` truthy).
 * @property cabinTempText localized cabin temperature (web `formatTemperature(inside_temp_c)`).
 * @property outsideTempText localized outside temperature (web `formatTemperature(outside_temp_c)`).
 * @property driverSetpointText localized driver setpoint (web `formatTemperature(driver_setpoint_c)`).
 * @property passengerSetpointText localized passenger setpoint (web `formatTemperature(passenger_setpoint_c)`).
 * @property hvacStateText the raw HVAC state, or the em dash when absent (web `hvac_state ?? '—'`).
 * @property fanLevel the fan speed (web `fan_status ?? 0`); segment `n` fills when `fanLevel >= n`.
 * @property fanStatusText the fan level rendered for display (web `{fan_status ?? 0}`).
 * @property chips the three status chips in web source order (Defrost, Climate, Precondition).
 */
data class ClimatePanelDisplay(
    val hasData: Boolean,
    val cabinTempText: String,
    val outsideTempText: String,
    val driverSetpointText: String,
    val passengerSetpointText: String,
    val hvacStateText: String,
    val fanLevel: Int,
    val fanStatusText: String,
    val chips: List<ClimateChipState>,
) {
    /** Whether fan-meter segment [level] (1..[FAN_SPEED_BARS]) is filled — web `(fan_status ?? 0) >= level`. */
    fun fanBarFilled(level: Int): Boolean = fanLevel >= level

    companion object {
        /** The no-snapshot projection (web `climateData == null`): the surface shows its empty state. */
        fun empty(): ClimatePanelDisplay =
            ClimatePanelDisplay(
                hasData = false,
                cabinTempText = EM_DASH,
                outsideTempText = EM_DASH,
                driverSetpointText = EM_DASH,
                passengerSetpointText = EM_DASH,
                hvacStateText = EM_DASH,
                fanLevel = FAN_LEVEL_NONE,
                fanStatusText = FAN_LEVEL_NONE.toString(),
                chips = emptyList(),
            )
    }
}

/**
 * The localized strings the panel renders — the native mirror of every `t('…')` call the web component
 * makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays
 * framework-free yet fully localized. [snapshotLabel] personalizes the error surface's retry copy.
 */
data class ClimatePanelStrings(
    val title: String,
    val cabin: String,
    val outside: String,
    val driverSetpoint: String,
    val passengerSetpoint: String,
    val hvacState: String,
    val fanSpeed: String,
    val defrost: String,
    val climate: String,
    val precondition: String,
    val on: String,
    val off: String,
    val noData: String,
    val snapshotLabel: String = title,
)

/**
 * Pure projection from the climate snapshot to the panel's render state — a 1:1 port of the web
 * component's field reads, null guards, fan-meter logic, and per-chip branch. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves
 * localized strings + the live [UnitFormatter] and draws what these return.
 */
object ClimatePanelProjection {
    /**
     * The readings the web derives from the snapshot. Temperatures use the typed `number` guard (a
     * quoted-string field reads as `null`, matching the web's typed contract); the HVAC state / defrost
     * mode use the string guard; the on/preconditioning flags default to `false` when absent; the fan
     * status is the JSON number truncated to a whole level (web `fan_status` is an integer level).
     */
    fun parse(snapshot: JsonElement?): ClimateReading {
        val obj = snapshot as? JsonObject ?: return ClimateReading.EMPTY
        return ClimateReading(
            insideTempC = obj.numberOrNull(FIELD_INSIDE_TEMP_C),
            outsideTempC = obj.numberOrNull(FIELD_OUTSIDE_TEMP_C),
            driverSetpointC = obj.numberOrNull(FIELD_DRIVER_SETPOINT_C),
            passengerSetpointC = obj.numberOrNull(FIELD_PASSENGER_SETPOINT_C),
            hvacState = obj.stringOrNull(FIELD_HVAC_STATE),
            defrostMode = obj.stringOrNull(FIELD_DEFROST_MODE),
            isClimateOn = obj.boolOrFalse(FIELD_IS_CLIMATE_ON),
            isPreconditioning = obj.boolOrFalse(FIELD_IS_PRECONDITIONING),
            fanStatus = obj.intOrNull(FIELD_FAN_STATUS),
        )
    }

    /**
     * True when [snapshot] carries no climate object (web `climateData` falsy) → render the empty state.
     * Used by the view-model to classify the cache-then-network feed onto [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** Whether the defrost chip is active (web `defrost_mode && defrost_mode !== 'Off'`). */
    fun isDefrostActive(defrostMode: String?): Boolean = !defrostMode.isNullOrBlank() && defrostMode != DEFROST_OFF

    /**
     * Projects [snapshot] onto the render-ready [ClimatePanelDisplay] using [formatter] for the SI→display
     * temperature boundary (web `useUnits().formatTemperature`) and [strings] for every label. A
     * `null`/`JsonNull`/non-object snapshot yields [ClimatePanelDisplay.empty] (the web null-prop branch);
     * otherwise every field is read + formatted exactly as the web component does.
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: ClimatePanelStrings,
    ): ClimatePanelDisplay {
        if (snapshot !is JsonObject) return ClimatePanelDisplay.empty()
        val reading = parse(snapshot)
        val fanLevel = reading.fanStatus ?: FAN_LEVEL_NONE
        return ClimatePanelDisplay(
            hasData = true,
            cabinTempText = formatter.temperature(reading.insideTempC),
            outsideTempText = formatter.temperature(reading.outsideTempC),
            driverSetpointText = formatter.temperature(reading.driverSetpointC),
            passengerSetpointText = formatter.temperature(reading.passengerSetpointC),
            hvacStateText = reading.hvacState ?: EM_DASH,
            fanLevel = fanLevel,
            fanStatusText = fanLevel.toString(),
            chips = buildChips(reading, strings),
        )
    }

    /** The three chips in web source order, each with its active flag, value token, and full label. */
    private fun buildChips(
        reading: ClimateReading,
        strings: ClimatePanelStrings,
    ): List<ClimateChipState> {
        val defrostActive = isDefrostActive(reading.defrostMode)
        val defrostValue = if (defrostActive) reading.defrostMode!! else strings.off
        val climateValue = if (reading.isClimateOn) strings.on else strings.off
        val preconditionValue = if (reading.isPreconditioning) strings.on else strings.off
        return listOf(
            ClimateChipState(
                chip = ClimateChip.Defrost,
                active = defrostActive,
                valueText = defrostValue,
                label = "${strings.defrost} $defrostValue",
            ),
            ClimateChipState(
                chip = ClimateChip.Climate,
                active = reading.isClimateOn,
                valueText = climateValue,
                label = "${strings.climate} $climateValue",
            ),
            ClimateChipState(
                chip = ClimateChip.Precondition,
                active = reading.isPreconditioning,
                valueText = preconditionValue,
                label = "${strings.precondition} $preconditionValue",
            ),
        )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CLIMATE_PANEL_SLUG] (P1/S11). Carries
 * no temperature/HVAC payload or vehicle id, so a diagnostics line can never leak cabin state. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's
 * first-composition effect.
 */
fun recordClimatePanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CLIMATE_PANEL_SLUG))
}

/** A JSON number field as a [Double], or `null` when absent or not a JSON number (web typed `number`). */
private fun JsonObject.numberOrNull(key: String): Double? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) null else primitive.doubleOrNull
}

/** A JSON number field truncated to a whole fan level, or `null` when absent / not a finite number. */
private fun JsonObject.intOrNull(key: String): Int? = numberOrNull(key)?.takeIf { it.isFinite() }?.toInt()

/** A JSON boolean field, defaulting to `false` when absent / not a JSON boolean (web typed `boolean`). */
private fun JsonObject.boolOrFalse(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** A JSON string field, or `null` when absent / not a quoted string (web typed `string`). */
private fun JsonObject.stringOrNull(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
