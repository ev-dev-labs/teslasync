// Pure, framework-free model + projection for the LiveTelemetryPanels feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx and its seven child panels).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// LiveTelemetryPanels is a presentational composite of seven live panels — Powertrain, Climate, Security,
// Vehicle State, Tire Pressure, Energy & Charging, Media & Navigation — each fed one or two optional data
// objects by the owning vehicle-detail page (the web component's only hook is `useTranslation`; the page owns
// the `/motor/latest`, `/climate/latest`, `/security/latest`, `/tire-pressure/latest` and
// charging/media/location queries plus their loading / error / stale / offline handling). So the state set
// this surface itself renders is, per panel, the branches the web source defines:
//   • a present data object → the panel's rows, and
//   • an absent data object → the panel's friendly empty surface (web `<EmptyState/>` or the inline
//     "No … data" caption), never a blank box.
// Within the rows every individual value still degrades to the web em dash / "Unknown" / "Off" / "Closed"
// branch, so a partially-populated panel is never blank either. The Vehicle State panel always renders its
// rows (the web source gives it no empty branch), degrading each value to its own off/empty caption.
//
// Unit handling mirrors the web: the API serves SI and the SI→display conversion happens here at the single
// render boundary via the shared [UnitFormatter] (web `useUnits` + the `convertDistanceFromSI` prop). Cabin /
// outside / setpoint / motor / inverter temperatures arrive SI Celsius; tire pressure arrives SI Pascals (it
// is bridged to the formatter's SI-kilopascal contract by ÷1000, exactly as the web `paToKpa` helper does);
// the navigation distance arrives SI metres (wire key `miles_to_arrival`, content metres — the
// proto-identifier paradox); the charge rate arrives SI metres-per-hour-of-range and is divided by 3600 to
// metres-per-second before [UnitFormatter.speed], exactly as the web does. The raw numeric reads
// (power / rpm / torque / regen / voltage / current / charger power / energy added / battery level) go
// through [fmtNumber] / [fmtInt] — the native port of the web `fmtNumber` / `fmtInt` / `fmtWithUnit`, which
// use the user's global decimal precision (default 2) and en-US grouping. The charger-power "kW" and
// energy-added "kWh" suffixes are appended verbatim with no conversion, reproducing the web `fmtWithUnit`
// call sites exactly (parity, not a unit fix — the web component is the single source of truth).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveTelemetryPanels — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveTelemetry surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetrypanels

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min

/** Em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Unit-symbol literals the web hard-codes verbatim (not translatable copy). */
internal const val RPM_UNIT: String = "RPM"
internal const val TORQUE_UNIT: String = "Nm"
internal const val VOLT_UNIT: String = "V"
internal const val AMP_UNIT: String = "A"
internal const val POWER_KW_UNIT: String = "kW"
internal const val ENERGY_KWH_UNIT: String = "kWh"
internal const val PERCENT_UNIT: String = "%"

/** Status glyphs the web prefixes onto the tire-pressure badge (decorative; the localized text carries it). */
internal const val TIRE_OK_MARK: String = "\u2713 "
internal const val TIRE_BAD_MARK: String = "\u2717 "
internal const val TIRE_WARN_MARK: String = "\u26A0 "

/** Decimal precision the web `fmtNumber` defaults to when the user has set no `decimal_precision`. */
private const val DEFAULT_NUMBER_DECIMALS = 2

/** Motor temperature above which the web tints the peak read red. */
private const val MOTOR_TEMP_HOT_C = 80.0

/** Powertrain power-bar full-scale magnitude (web `… / 300`). */
private const val POWER_FULL_SCALE_KW = 300.0

/** Fan speed scale: the web renders six discrete level bars. */
internal const val FAN_BAR_COUNT = 6

/** Seconds-per-hour bridge: range-added m/h → m/s before [UnitFormatter.speed] (web `… / 3600`). */
private const val SECONDS_PER_HOUR = 3600.0

/** 1 kPa = 1000 Pa. The tire value is SI Pascals; the shared formatter takes SI kilopascals (web `paToKpa`). */
private const val PA_PER_KPA = 1000.0

/** Numeric zero used for the web nullish `?? 0` fan read. */
private const val ZERO = 0.0

/**
 * Tire-pressure cutoffs in SI Pascals, ported VERBATIM from the web `TIRE_PRESSURE_PA` constant
 * (web/src/features/vehicles/components/vehicle-detail/helpers.ts). The web applies these to the raw
 * `/tire-pressure/latest` Pascal value with no conversion, and [LiveTelemetryPanelsProjection.tireColor]
 * does likewise, so the native color-coding reproduces the web pixel-for-pixel. The web helper is the single
 * source of truth; any threshold revision must land there first and be re-ported here.
 */
private const val TIRE_LOW_CRITICAL_PA = 206_800.0
private const val TIRE_LOW_WARNING_PA = 241_300.0
private const val TIRE_HIGH_WARNING_PA = 310_300.0
private const val TIRE_HIGH_CRITICAL_PA = 344_700.0

/** Charge-state literals the web matches for badge tone. */
private const val CHARGING_STATE_CHARGING = "Charging"
private const val CHARGING_STATE_COMPLETE = "Complete"

/** Shift-state literals the web matches for the powertrain badge tone. */
private const val SHIFT_DRIVE = "D"
private const val SHIFT_REVERSE = "R"
private const val SHIFT_NEUTRAL = "N"

/** Playback-status literals the web matches for the media badge tone. */
private const val PLAYBACK_PLAYING = "Playing"
private const val PLAYBACK_PAUSED = "Paused"

/** Turn-signal "off" sentinel the web treats as inactive (`… !== 'Off'`). */
private const val TURN_SIGNAL_OFF = "Off"

/** Defrost "off" sentinel the web treats as inactive (`defrost_mode !== 'Off'`). */
private const val DEFROST_OFF = "Off"

/** The Go nil string representations the web `cleanNil` filters out (alongside the empty string). */
private val NIL_TOKENS = setOf("<nil>", "nil", "null")

// ── Wire data objects (the web component's panel props) ────────────────────────────────────────────────

/**
 * The `/motor/latest` slice the Powertrain panel reads — the native mirror of the web `MotorSnapshot`
 * (web/src/api/types.ts). Field names keep their snake_case wire form via @SerialName, and every field
 * defaults so a partial payload decodes (the decoder ignores keys this surface does not read).
 */
@Serializable
data class MotorSnapshotLive(
    @SerialName("shift_state") val shiftState: String? = null,
    @SerialName("power_kw") val powerKw: Double? = null,
    @SerialName("motor_rpm_front") val motorRpmFront: Double? = null,
    @SerialName("motor_rpm_rear") val motorRpmRear: Double? = null,
    @SerialName("torque_nm_front") val torqueNmFront: Double? = null,
    @SerialName("torque_nm_rear") val torqueNmRear: Double? = null,
    @SerialName("motor_temp_c_front") val motorTempCFront: Double? = null,
    @SerialName("motor_temp_c_rear") val motorTempCRear: Double? = null,
    @SerialName("inverter_temp_c") val inverterTempC: Double? = null,
    @SerialName("regen_kw") val regenKw: Double? = null,
)

/** The `/climate/latest` slice the Climate panel reads — the native mirror of the web `ClimateSnapshot`. */
@Serializable
data class ClimateSnapshotLive(
    @SerialName("inside_temp_c") val insideTempC: Double? = null,
    @SerialName("outside_temp_c") val outsideTempC: Double? = null,
    @SerialName("driver_setpoint_c") val driverSetpointC: Double? = null,
    @SerialName("passenger_setpoint_c") val passengerSetpointC: Double? = null,
    @SerialName("hvac_state") val hvacState: String? = null,
    @SerialName("defrost_mode") val defrostMode: String? = null,
    @SerialName("is_climate_on") val isClimateOn: Boolean? = null,
    @SerialName("is_preconditioning") val isPreconditioning: Boolean? = null,
    @SerialName("fan_status") val fanStatus: Double? = null,
)

/** The `/security/latest` slice the Security panel reads — the native mirror of the web `SecurityEvent`. */
@Serializable
data class SecurityEventLive(
    @SerialName("doors_open") val doorsOpen: String? = null,
    @SerialName("windows_open") val windowsOpen: String? = null,
    @SerialName("locked") val locked: Boolean? = null,
    @SerialName("sentry_mode") val sentryMode: Boolean? = null,
    @SerialName("user_present") val userPresent: Boolean? = null,
    @SerialName("detail") val detail: String? = null,
)

/**
 * The live-state slice the Vehicle State panel reads — the native mirror of the web `live` record. The web
 * reads these camelCase keys straight off the shared live store, so @SerialName keeps the camelCase wire
 * form. The polymorphic count/display fields arrive as a number or a string depending on the producer, so
 * they are kept as raw [JsonElement] and resolved with the web `x || '—'` truthiness rule via [truthyText].
 */
@Serializable
data class VehicleStateLive(
    @SerialName("lightsHighBeams") val lightsHighBeams: Boolean = false,
    @SerialName("lightsTurnSignal") val lightsTurnSignal: String? = null,
    @SerialName("lightsHazards") val lightsHazards: Boolean = false,
    @SerialName("driverSeatOccupied") val driverSeatOccupied: Boolean = false,
    @SerialName("pairedKeyCount") val pairedKeyCount: JsonElement? = null,
    @SerialName("valetMode") val valetMode: Boolean = false,
    @SerialName("serviceMode") val serviceMode: Boolean = false,
    @SerialName("speedLimitMode") val speedLimitMode: Boolean = false,
    @SerialName("currentSpeedLimit") val currentSpeedLimit: Double? = null,
    @SerialName("centerDisplay") val centerDisplay: JsonElement? = null,
    @SerialName("homelinkDeviceCount") val homelinkDeviceCount: JsonElement? = null,
)

/** The `/tire-pressure/latest` slice the Tire Pressure panel reads (SI Pascals per corner). */
@Serializable
data class TirePressureLive(
    @SerialName("front_left") val frontLeft: Double? = null,
    @SerialName("front_right") val frontRight: Double? = null,
    @SerialName("rear_left") val rearLeft: Double? = null,
    @SerialName("rear_right") val rearRight: Double? = null,
)

/** The charging-telemetry slice the Energy & Charging panel reads — the native mirror of `ChargingTelemetry`. */
@Serializable
data class ChargingTelemetryLive(
    @SerialName("battery_level") val batteryLevel: Double? = null,
    @SerialName("charging_state") val chargingState: String? = null,
    @SerialName("charger_voltage") val chargerVoltage: Double? = null,
    @SerialName("charger_actual_current") val chargerActualCurrent: Double? = null,
    @SerialName("charger_power_w") val chargerPowerW: Double? = null,
    @SerialName("charge_energy_added_wh") val chargeEnergyAddedWh: Double? = null,
    @SerialName("range_added_meters_per_hour") val rangeAddedMetersPerHour: Double? = null,
)

/** The `/media/latest` slice the Media panel reads — the native mirror of the web `MediaSnapshot`. */
@Serializable
data class MediaSnapshotLive(
    @SerialName("now_playing_title") val nowPlayingTitle: String? = null,
    @SerialName("now_playing_artist") val nowPlayingArtist: String? = null,
    @SerialName("playback_status") val playbackStatus: String? = null,
    @SerialName("playback_source") val playbackSource: String? = null,
)

/**
 * The location slice the Navigation panel reads — the native mirror of the web `LocationSnapshot`. The wire
 * key `miles_to_arrival` carries SI metres (the proto-identifier paradox); it is converted from SI like every
 * other distance, exactly as the web `convertDistanceFromSI(value, unitPrefs.distance)` does.
 */
@Serializable
data class LocationSnapshotLive(
    @SerialName("destination_name") val destinationName: String? = null,
    @SerialName("miles_to_arrival") val metersToArrival: Double? = null,
    @SerialName("minutes_to_arrival") val minutesToArrival: Double? = null,
    @SerialName("located_at_home") val locatedAtHome: Boolean = false,
    @SerialName("located_at_work") val locatedAtWork: Boolean = false,
    @SerialName("located_at_favorite") val locatedAtFavorite: Boolean = false,
)

/** The optional panel inputs bundled as one prop bag (the native analogue of the web component's props). */
data class LiveTelemetryPanelsData(
    val motor: MotorSnapshotLive? = null,
    val climate: ClimateSnapshotLive? = null,
    val security: SecurityEventLive? = null,
    val vehicleState: VehicleStateLive = VehicleStateLive(),
    val sseConnected: Boolean = false,
    val tire: TirePressureLive? = null,
    val charging: ChargingTelemetryLive? = null,
    val media: MediaSnapshotLive? = null,
    val location: LocationSnapshotLive? = null,
    val remoteStartEnabled: Boolean? = null,
)

// ── Render-ready descriptors ──────────────────────────────────────────────────────────────────────────

/** Semantic chip/badge tone, resolved to the shared `BadgeVariant` / status palette at the render boundary. */
enum class BadgeTone { Info, Success, Warning, Danger, Neutral }

/** The powertrain power-bar fill: which half of the centre-zero track fills, and by how much (0..1). */
data class PowerFill(
    val positive: Boolean,
    val fraction: Float,
)

/**
 * The Powertrain panel content (web `PowertrainPanel`). [shiftText] is the raw shift code or `null` (the view
 * renders the localized "Unknown"); [motorTempHot] tints the peak motor temp red (web `> 80`).
 */
data class PowertrainContent(
    val shiftText: String?,
    val shiftTone: BadgeTone,
    val powerText: String,
    val powerFill: PowerFill?,
    val rpmFrontText: String,
    val rpmRearText: String,
    val torqueFrontText: String,
    val torqueRearText: String,
    val motorTempText: String,
    val motorTempHot: Boolean,
    val inverterTempText: String,
    val regenText: String,
)

/**
 * The Climate panel content (web `ClimatePanel`). [fanLevel] is the web `fan_status ?? 0` (0..6 bars filled);
 * [defrostModeValue] is the active defrost mode label or `null` (the view shows the localized "Off").
 */
data class ClimateContent(
    val cabinText: String,
    val outsideText: String,
    val driverSetpointText: String,
    val passengerSetpointText: String,
    val hvacStateText: String,
    val fanLevel: Int,
    val defrostActive: Boolean,
    val defrostModeValue: String?,
    val climateOn: Boolean,
    val preconditioning: Boolean,
)

/** The lock + sentry + door + window + presence rows (web — shown only when `securityData` is present). */
data class SecurityRows(
    val locked: Boolean,
    val sentryOn: Boolean,
    val doorsValue: String?,
    val windowsValue: String?,
    val userPresent: Boolean,
    val detail: String?,
)

/** Remote-start access tri-state (web `remoteStartEnabled == null ? '—' : enabled ? 'Enabled' : 'Disabled'`). */
enum class RemoteStartState { Unknown, Enabled, Disabled }

/**
 * The Security panel content (web `SecurityPanel`). [rows] is `null` when `securityData` is absent but a
 * remote-start value is present (the web renders only the remote-start row in that case). The whole panel is
 * `null` (its empty surface) only when both inputs are absent.
 */
data class SecurityContent(
    val rows: SecurityRows?,
    val remoteStart: RemoteStartState,
)

/**
 * The Vehicle State panel content (web `VehicleStatePanel`). The web source gives this panel no empty branch,
 * so it is non-nullable: every field degrades to its own off/empty caption. [turnSignalValue] /
 * [speedLimitValue] are the active passthrough/formatted strings or `null` (the view shows the localized
 * "Off"); [pairedKeysText] / [centerDisplayText] / [homelinkText] are the web `x || '—'` reads.
 */
data class VehicleStateContent(
    val highBeamsOn: Boolean,
    val turnSignalValue: String?,
    val hazardsActive: Boolean,
    val driverSeatOccupied: Boolean,
    val pairedKeysText: String,
    val valetEnabled: Boolean,
    val serviceActive: Boolean,
    val speedLimitActive: Boolean,
    val speedLimitValue: String?,
    val centerDisplayText: String,
    val homelinkText: String,
)

/** The four tire corners, in the web `tires` array order, each carrying the web abbreviation literal. */
enum class TireCorner(
    val label: String,
) {
    FrontLeft("FL"),
    FrontRight("FR"),
    RearLeft("RL"),
    RearRight("RR"),
}

/** The tire value color band (web `getColor`): a null reading is muted, never green. */
enum class TireColor { Normal, Warn, Danger, Muted }

/** The tire summary badge (web `allGood ? … : anyBad ? … : …`). */
enum class TireStatus { AllNormal, Attention, Check }

/** One render-ready tire corner: its [corner] position, formatted [valueText] (with unit), and [color]. */
data class TireCornerCell(
    val corner: TireCorner,
    val valueText: String,
    val color: TireColor,
)

/** The Tire Pressure panel content (web `TirePressurePanel`); `null` input → the inline "No … data" caption. */
data class TireContent(
    val cells: List<TireCornerCell>,
    val status: TireStatus,
)

/**
 * The Energy & Charging panel content (web `EnergyChargingPanel`). [chargingStateText] is the raw charging
 * state or `null` (the view shows the localized "Unknown"); [chargingTone] colors the state badge.
 */
data class EnergyContent(
    val chargerVoltageText: String,
    val chargerCurrentText: String,
    val chargerPowerText: String,
    val energyAddedText: String,
    val chargingStateText: String?,
    val chargingTone: BadgeTone,
    val batteryLevelText: String,
    val chargeRateText: String,
)

/**
 * The "Now Playing" block (web `MediaNavigationPanel`). [titleValue] / [artistValue] are the cleaned strings
 * or `null` (the view shows the localized "Nothing playing" / "Unknown artist"); [statusValue] is the cleaned
 * playback status or `null` (the badge is hidden when absent); [sourceValue] is the cleaned playback source.
 */
data class NowPlayingContent(
    val titleValue: String?,
    val artistValue: String?,
    val sourceValue: String?,
    val statusValue: String?,
    val statusTone: BadgeTone,
)

/** A saved-location family the Navigation panel badges (web 🏠 / 🏢 / ⭐); the view resolves its i18n label. */
enum class NavPlace(
    val emoji: String,
) {
    Home("\uD83C\uDFE0"),
    Work("\uD83C\uDFE2"),
    Favorite("\u2B50"),
}

/**
 * An active navigation destination (web — shown when `destination_name` is present). [distanceText] is the
 * fully-formatted distance (value + unit) or `null`; [etaMinutesText] is the integer minutes or `null` (the
 * view appends the localized "min").
 */
data class DestinationContent(
    val name: String,
    val distanceText: String?,
    val etaMinutesText: String?,
)

/**
 * The Navigation block (web `MediaNavigationPanel`). [destination] is `null` when no destination is set (the
 * view shows "No active destination"); [places] is empty when the vehicle is not at a saved place.
 */
data class NavigationContent(
    val destination: DestinationContent?,
    val places: List<NavPlace>,
)

/**
 * The Media & Navigation panel content (web `MediaNavigationPanel`). The web source always renders both
 * sub-sections, each with its own empty caption, so this is non-nullable. [nowPlaying] is `null` when there
 * is no media data (the view shows "No media data"); [navigation] is `null` when there is no location data.
 */
data class MediaContent(
    val nowPlaying: NowPlayingContent?,
    val navigation: NavigationContent?,
)

/**
 * The fully projected surface — one content per panel. A `null` content (where allowed) is the panel's empty
 * surface (web `data ? rows : <EmptyState/>`): the view renders the header plus the empty caption, never a
 * blank box. [vehicleState] and [media] always render. [sseConnected] drives the Vehicle State "Live" chip.
 */
data class LiveTelemetryPanelsDisplay(
    val powertrain: PowertrainContent?,
    val climate: ClimateContent?,
    val security: SecurityContent?,
    val vehicleState: VehicleStateContent,
    val sseConnected: Boolean,
    val tire: TireContent?,
    val energy: EnergyContent?,
    val media: MediaContent,
)

// ── Projection ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the optional panel inputs to the render-ready [LiveTelemetryPanelsDisplay] — a 1:1
 * port of the per-panel data derivations across `LiveTelemetryPanels.tsx` and its seven child panels. Each
 * data-bearing panel projects to a content object when its input is present, or to `null` (its empty surface)
 * when absent; the Vehicle State and Media panels always project. The SI→display conversions run here through
 * the shared [UnitFormatter] (web `useUnits()` + `convertDistanceFromSI`), keeping the SI source unconverted
 * (Phase-48; ADR-013).
 */
object LiveTelemetryPanelsProjection {
    /** Project all panels for the given [data] + [formatter]. */
    fun project(
        data: LiveTelemetryPanelsData,
        formatter: UnitFormatter,
    ): LiveTelemetryPanelsDisplay =
        LiveTelemetryPanelsDisplay(
            powertrain = powertrain(data.motor, formatter),
            climate = climate(data.climate, formatter),
            security = security(data.security, data.remoteStartEnabled),
            vehicleState = vehicleState(data.vehicleState, formatter),
            sseConnected = data.sseConnected,
            tire = tire(data.tire, formatter),
            energy = energy(data.charging, formatter),
            media = media(data.media, data.location, formatter),
        )

    /** Powertrain rows (web `PowertrainPanel`); `null` input → the empty surface. */
    fun powertrain(
        motor: MotorSnapshotLive?,
        formatter: UnitFormatter,
    ): PowertrainContent? {
        if (motor == null) return null
        val maxMotorTemp = peakMotorTemp(motor.motorTempCFront, motor.motorTempCRear)
        return PowertrainContent(
            shiftText = motor.shiftState,
            shiftTone = shiftTone(motor.shiftState),
            powerText = numberUnitOrDash(motor.powerKw, POWER_KW_UNIT, formatter),
            powerFill = powerFill(motor.powerKw),
            rpmFrontText = intOrDash(motor.motorRpmFront),
            rpmRearText = intOrDash(motor.motorRpmRear),
            torqueFrontText = numberOrDash(motor.torqueNmFront, formatter),
            torqueRearText = numberOrDash(motor.torqueNmRear, formatter),
            motorTempText = if (maxMotorTemp != null) formatter.temperature(maxMotorTemp) else EM_DASH,
            motorTempHot = maxMotorTemp != null && maxMotorTemp > MOTOR_TEMP_HOT_C,
            inverterTempText = formatter.temperature(motor.inverterTempC),
            regenText = numberUnitOrDash(motor.regenKw, POWER_KW_UNIT, formatter),
        )
    }

    /** Climate rows (web `ClimatePanel`); `null` input → the empty surface. */
    fun climate(
        climate: ClimateSnapshotLive?,
        formatter: UnitFormatter,
    ): ClimateContent? {
        if (climate == null) return null
        val active = showsDefrost(climate.defrostMode)
        return ClimateContent(
            cabinText = formatter.temperature(climate.insideTempC),
            outsideText = formatter.temperature(climate.outsideTempC),
            driverSetpointText = formatter.temperature(climate.driverSetpointC),
            passengerSetpointText = formatter.temperature(climate.passengerSetpointC),
            hvacStateText = climate.hvacState ?: EM_DASH,
            fanLevel = (climate.fanStatus ?: ZERO).toInt().coerceIn(0, FAN_BAR_COUNT),
            defrostActive = active,
            defrostModeValue = if (active) climate.defrostMode else null,
            climateOn = climate.isClimateOn == true,
            preconditioning = climate.isPreconditioning == true,
        )
    }

    /** Security rows (web `SecurityPanel`); both inputs absent → the empty surface. */
    fun security(
        security: SecurityEventLive?,
        remoteStartEnabled: Boolean?,
    ): SecurityContent? {
        if (security == null && remoteStartEnabled == null) return null
        return SecurityContent(
            rows =
                security?.let {
                    SecurityRows(
                        locked = it.locked == true,
                        sentryOn = it.sentryMode == true,
                        doorsValue = it.doorsOpen,
                        windowsValue = it.windowsOpen,
                        userPresent = it.userPresent == true,
                        detail = it.detail?.takeIf { d -> d.isNotEmpty() },
                    )
                },
            remoteStart = remoteStartState(remoteStartEnabled),
        )
    }

    /** Vehicle State rows (web `VehicleStatePanel`); always present — each value degrades to its own caption. */
    fun vehicleState(
        live: VehicleStateLive,
        formatter: UnitFormatter,
    ): VehicleStateContent =
        VehicleStateContent(
            highBeamsOn = live.lightsHighBeams,
            turnSignalValue = live.lightsTurnSignal?.takeIf { it.isNotEmpty() && it != TURN_SIGNAL_OFF },
            hazardsActive = live.lightsHazards,
            driverSeatOccupied = live.driverSeatOccupied,
            pairedKeysText = truthyText(live.pairedKeyCount) ?: EM_DASH,
            valetEnabled = live.valetMode,
            serviceActive = live.serviceMode,
            speedLimitActive = live.speedLimitMode,
            speedLimitValue = if (live.speedLimitMode) formatter.speed(live.currentSpeedLimit) else null,
            centerDisplayText = truthyText(live.centerDisplay) ?: EM_DASH,
            homelinkText = truthyText(live.homelinkDeviceCount) ?: EM_DASH,
        )

    /** Tire rows (web `TirePressurePanel`); `null` input → the inline "No … data" caption. */
    fun tire(
        tire: TirePressureLive?,
        formatter: UnitFormatter,
    ): TireContent? {
        if (tire == null) return null
        val raw =
            listOf(
                TireCorner.FrontLeft to tire.frontLeft,
                TireCorner.FrontRight to tire.frontRight,
                TireCorner.RearLeft to tire.rearLeft,
                TireCorner.RearRight to tire.rearRight,
            )
        return TireContent(
            cells = raw.map { (corner, pa) -> TireCornerCell(corner, tirePressureText(pa, formatter), tireColor(pa)) },
            status = tireStatus(raw.map { it.second }),
        )
    }

    /** Energy rows (web `EnergyChargingPanel`); `null` input → the empty surface. */
    fun energy(
        charging: ChargingTelemetryLive?,
        formatter: UnitFormatter,
    ): EnergyContent? {
        if (charging == null) return null
        return EnergyContent(
            chargerVoltageText = charging.chargerVoltage?.let { fmtNumber(it, formatter) } ?: EM_DASH,
            chargerCurrentText = charging.chargerActualCurrent?.let { fmtNumber(it, formatter) } ?: EM_DASH,
            chargerPowerText = charging.chargerPowerW?.let { fmtWithUnit(it, POWER_KW_UNIT, formatter) } ?: EM_DASH,
            energyAddedText =
                charging.chargeEnergyAddedWh?.let { fmtWithUnit(it, ENERGY_KWH_UNIT, formatter) } ?: EM_DASH,
            chargingStateText = charging.chargingState,
            chargingTone = chargingTone(charging.chargingState),
            batteryLevelText = charging.batteryLevel?.let { fmtNumber(it, formatter) + PERCENT_UNIT } ?: EM_DASH,
            chargeRateText =
                charging.rangeAddedMetersPerHour?.let { formatter.speed(it / SECONDS_PER_HOUR) } ?: EM_DASH,
        )
    }

    /** Media + Navigation (web `MediaNavigationPanel`); always present, each sub-section with its own caption. */
    fun media(
        media: MediaSnapshotLive?,
        location: LocationSnapshotLive?,
        formatter: UnitFormatter,
    ): MediaContent =
        MediaContent(
            nowPlaying =
                media?.let {
                    NowPlayingContent(
                        titleValue = cleanNil(it.nowPlayingTitle),
                        artistValue = cleanNil(it.nowPlayingArtist),
                        sourceValue = cleanNil(it.playbackSource),
                        statusValue = cleanNil(it.playbackStatus),
                        statusTone = statusTone(cleanNil(it.playbackStatus)),
                    )
                },
            navigation = location?.let { navigation(it, formatter) },
        )

    private fun navigation(
        location: LocationSnapshotLive,
        formatter: UnitFormatter,
    ): NavigationContent =
        NavigationContent(
            destination =
                location.destinationName?.takeIf { it.isNotEmpty() }?.let { name ->
                    DestinationContent(
                        name = name,
                        distanceText = location.metersToArrival?.let { distanceText(it, formatter) },
                        etaMinutesText = location.minutesToArrival?.let { fmtInt(it) },
                    )
                },
            places = savedPlaces(location),
        )

    // ── value helpers (web parity) ──

    /** Web `Math.max(front ?? -Infinity, rear ?? -Infinity)`, returning `null` only when neither is present. */
    fun peakMotorTemp(
        front: Double?,
        rear: Double?,
    ): Double? {
        if (front == null && rear == null) return null
        return maxOf(front ?: Double.NEGATIVE_INFINITY, rear ?: Double.NEGATIVE_INFINITY)
    }

    /** Web shift badge tone: `'D'` → success, `'R'` → danger, `'N'` → warning, anything else → neutral. */
    fun shiftTone(shift: String?): BadgeTone =
        when (shift) {
            SHIFT_DRIVE -> BadgeTone.Success
            SHIFT_REVERSE -> BadgeTone.Danger
            SHIFT_NEUTRAL -> BadgeTone.Warning
            else -> BadgeTone.Neutral
        }

    /** Web charging-state badge tone: `'Charging'` → info, `'Complete'` → success, else neutral. */
    fun chargingTone(state: String?): BadgeTone =
        when (state) {
            CHARGING_STATE_CHARGING -> BadgeTone.Info
            CHARGING_STATE_COMPLETE -> BadgeTone.Success
            else -> BadgeTone.Neutral
        }

    /** Web media-status badge tone: `'Playing'` → success, `'Paused'` → warning, else neutral. */
    fun statusTone(status: String?): BadgeTone =
        when (status) {
            PLAYBACK_PLAYING -> BadgeTone.Success
            PLAYBACK_PAUSED -> BadgeTone.Warning
            else -> BadgeTone.Neutral
        }

    /**
     * Web power bar: rendered only when `power_kw` is present. Fills the right (positive) or left (negative)
     * half of the centre-zero track by `min(|power| / 300, 1)` of that half.
     */
    fun powerFill(powerKw: Double?): PowerFill? {
        if (powerKw == null) return null
        val fraction = min(abs(powerKw) / POWER_FULL_SCALE_KW, 1.0).toFloat()
        return PowerFill(positive = powerKw >= 0, fraction = fraction)
    }

    /** Web `defrost_mode && defrost_mode !== 'Off'`. */
    fun showsDefrost(defrostMode: String?): Boolean = !defrostMode.isNullOrBlank() && defrostMode != DEFROST_OFF

    /** Web remote-start tri-state read (`null` → unknown, `true` → enabled, `false` → disabled). */
    fun remoteStartState(enabled: Boolean?): RemoteStartState =
        when (enabled) {
            null -> RemoteStartState.Unknown
            true -> RemoteStartState.Enabled
            false -> RemoteStartState.Disabled
        }

    /**
     * Web `getColor(pa)`: a null reading is muted (never green); outside the critical band is danger; outside
     * the warning band is warn; otherwise normal. Operates on the raw SI Pascal value, verbatim thresholds.
     */
    fun tireColor(pa: Double?): TireColor =
        when {
            pa == null -> TireColor.Muted
            pa < TIRE_LOW_CRITICAL_PA || pa > TIRE_HIGH_CRITICAL_PA -> TireColor.Danger
            pa < TIRE_LOW_WARNING_PA || pa > TIRE_HIGH_WARNING_PA -> TireColor.Warn
            else -> TireColor.Normal
        }

    /**
     * Web tire summary badge: `allGood` (every corner present AND within the warning band) → All Normal;
     * else `anyBad` (some corner present AND outside the critical band) → Attention; else Check.
     */
    fun tireStatus(pressures: List<Double?>): TireStatus {
        val allGood = pressures.all { it != null && it in TIRE_LOW_WARNING_PA..TIRE_HIGH_WARNING_PA }
        if (allGood) return TireStatus.AllNormal
        val anyBad = pressures.any { it != null && (it < TIRE_LOW_CRITICAL_PA || it > TIRE_HIGH_CRITICAL_PA) }
        return if (anyBad) TireStatus.Attention else TireStatus.Check
    }

    /**
     * Web `formatPressure(paToKpa(pa))`: the corner value is SI Pascals; `paToKpa` divides by 1000 (and maps
     * a null/non-finite read to `null`), then the shared formatter renders the user's pressure unit + label.
     * A null/non-finite read is the em dash.
     */
    fun tirePressureText(
        pa: Double?,
        formatter: UnitFormatter,
    ): String {
        if (pa == null || !pa.isFinite()) return EM_DASH
        return formatter.pressure(pa / PA_PER_KPA)
    }

    /**
     * Web `${fmtNumber(convertDistanceFromSI(meters, distance))} ${distance}`: the SI metres are converted to
     * the user's distance unit, rendered with [fmtNumber] (the web global precision, NOT the distance-specific
     * precision), and the unit label is appended.
     */
    fun distanceText(
        meters: Double,
        formatter: UnitFormatter,
    ): String {
        val value = convertDistanceFromSI(meters, formatter.prefs.distance)
        return fmtNumber(value, formatter) + " " + formatter.prefs.distance.label
    }

    /** Web saved-place badges in order (home, work, favorite); empty → "No active destination" sibling caption. */
    fun savedPlaces(location: LocationSnapshotLive): List<NavPlace> =
        buildList {
            if (location.locatedAtHome) add(NavPlace.Home)
            if (location.locatedAtWork) add(NavPlace.Work)
            if (location.locatedAtFavorite) add(NavPlace.Favorite)
        }

    /**
     * Web `x || '—'` truthiness over a live-store value that may be a number or a string: a non-empty string
     * (even `"0"`) is truthy; a non-zero number is truthy; `0` / `false` / empty / null are falsy → `null`.
     */
    fun truthyText(value: JsonElement?): String? {
        val prim = value as? JsonPrimitive ?: return null
        return when {
            prim.isString -> prim.content.ifEmpty { null }
            prim.booleanOrNull != null -> prim.content.takeIf { prim.booleanOrNull == true }
            prim.doubleOrNull != null -> prim.content.takeIf { prim.doubleOrNull != ZERO }
            else -> null
        }
    }

    /** Web `cleanNil`: filters the Go nil string representations and the empty string to `null`. */
    fun cleanNil(value: String?): String? = value?.takeUnless { it.isEmpty() || it in NIL_TOKENS }

    /** A present number formatted by [fmtNumber], else the em dash (web `value != null ? fmtNumber(value) : '—'`). */
    private fun numberOrDash(
        value: Double?,
        formatter: UnitFormatter,
    ): String = value?.let { fmtNumber(it, formatter) } ?: EM_DASH

    /** A present number formatted by [fmtInt], else the em dash (web `value != null ? fmtInt(value) : '—'`). */
    private fun intOrDash(value: Double?): String = value?.let { fmtInt(it) } ?: EM_DASH

    /** A present number with a trailing unit, else the em dash (web `value != null ? `${fmtNumber} unit` : '—'`). */
    private fun numberUnitOrDash(
        value: Double?,
        unit: String,
        formatter: UnitFormatter,
    ): String = value?.let { fmtNumber(it, formatter) + " " + unit } ?: EM_DASH

    /**
     * Locale-stable grouped decimal formatter — the native port of the web `fmtNumber`. Uses the user's
     * global decimal precision (`prefs.precision`, default 2), en-US grouping, and ECMAScript `halfExpand`
     * (round half away from zero) rounding.
     */
    fun fmtNumber(
        value: Double,
        formatter: UnitFormatter,
    ): String = groupedFormat(numberDecimals(formatter)).format(value)

    /** Locale-stable grouped integer formatter — the native port of the web `fmtInt`. */
    fun fmtInt(value: Double): String = groupedFormat(0).format(value)

    /** Web `fmtWithUnit(v, unit)`: `fmtNumber(v)` then a space and the verbatim unit suffix (no conversion). */
    fun fmtWithUnit(
        value: Double,
        unit: String,
        formatter: UnitFormatter,
    ): String = fmtNumber(value, formatter) + " " + unit

    private fun numberDecimals(formatter: UnitFormatter): Int = formatter.prefs.precision?.takeIf { it >= 0 } ?: DEFAULT_NUMBER_DECIMALS

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_UP }
    }
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any telemetry
 * value — so a diagnostics line can never leak the vehicle's location, media, lock posture, or sensor data.
 */
object LiveTelemetryPanelsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveTelemetryPanels"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * The generated i18n resource names this surface resolves (P1/S10), mirroring every `t()` key the web
 * component calls plus the localized counterparts of the web's hard-coded Vehicle State / Tire Pressure
 * captions. Kept as a single contract object so the accessibility/label test can assert the surface still
 * covers the full web key set without standing up a Compose host.
 */
internal object LiveTelemetryPanelsKeys {
    // Section + panel headers
    const val TITLE = "translation_common_liveTelemetry"
    const val POWERTRAIN = "translation_common_powertrain"
    const val CLIMATE = "translation_common_climate"
    const val SECURITY = "translation_common_security"
    const val VEHICLE_STATE = "translation_telemetry_vehicleState"
    const val TIRE_PRESSURE = "translation_common_tirePressure"
    const val ENERGY_CHARGING = "translation_telemetry_energyCharging"
    const val MEDIA_NAV = "translation_telemetry_mediaNav"

    // Powertrain
    const val SHIFT_STATE = "translation_telemetry_shiftState"
    const val POWER = "translation_telemetry_power"
    const val RPM_FRONT = "translation_telemetry_rpmFront"
    const val RPM_REAR = "translation_telemetry_rpmRear"
    const val TORQUE_FRONT = "translation_telemetry_torqueFront"
    const val TORQUE_REAR = "translation_telemetry_torqueRear"
    const val MOTOR_TEMP = "translation_telemetry_motorTemp"
    const val INVERTER_TEMP = "translation_telemetry_inverterTemp"
    const val REGEN = "translation_telemetry_regen"
    const val NO_MOTOR_DATA = "translation_telemetry_noMotorData"

    // Climate
    const val INSIDE_TEMP = "translation_common_insideTemp"
    const val OUTSIDE_TEMP = "translation_common_outsideTemp"
    const val DRIVER_SETPOINT = "translation_telemetry_driverSetpoint"
    const val PASSENGER_SETPOINT = "translation_telemetry_passengerSetpoint"
    const val HVAC_STATE = "translation_telemetry_hvacState"
    const val FAN_SPEED = "translation_telemetry_fanSpeed"
    const val DEFROST = "translation_telemetry_defrost"
    const val CLIMATE_BADGE = "translation_telemetry_climate"
    const val PRECONDITION = "translation_telemetry_precondition"
    const val NO_CLIMATE_DATA = "translation_telemetry_noClimateData"

    // Security
    const val LOCKED = "translation_common_locked"
    const val UNLOCKED = "translation_common_unlocked"
    const val LOCK_STATUS = "translation_telemetry_lockStatus"
    const val SENTRY_MODE = "translation_telemetry_sentryMode"
    const val DOORS = "translation_telemetry_doors"
    const val WINDOWS = "translation_telemetry_windows"
    const val USER_PRESENT = "translation_telemetry_userPresent"
    const val REMOTE_START = "translation_telemetry_remoteStart"
    const val NO_SECURITY_DATA = "translation_telemetry_noSecurityData"

    // Vehicle State
    const val HIGH_BEAMS = "translation_admin_security_live_highBeams"
    const val TURN_SIGNAL = "translation_admin_security_live_turnSignal"
    const val HAZARDS = "translation_admin_security_live_hazards"
    const val DRIVER_SEAT = "translation_admin_security_live_driverSeat"
    const val OCCUPIED = "translation_admin_security_live_occupied"
    const val EMPTY = "translation_admin_security_live_empty"
    const val PAIRED_KEYS = "translation_admin_security_live_pairedKeys"
    const val VALET_MODE = "translation_admin_security_live_valetMode"
    const val SERVICE_MODE = "translation_admin_security_live_serviceMode"
    const val SPEED_LIMIT = "translation_admin_security_live_speedLimit"
    const val CENTER_DISPLAY = "translation_admin_security_live_centerDisplay"
    const val HOMELINK_DEVICES = "translation_admin_security_live_homelinkDevices"
    const val LIVE_INDICATOR = "translation_admin_security_live_indicator"

    // Tire Pressure
    const val NO_TIRE_DATA = "translation_vehicles_detail_noTireData"
    const val ALL_NORMAL = "translation_telemetry_allNormal"
    const val ATTENTION_NEEDED = "translation_telemetry_attentionNeeded"
    const val CHECK_PRESSURE = "translation_widget_tireWarning"

    // Energy & Charging
    const val CHARGER_VOLTAGE = "translation_telemetry_chargerVoltage"
    const val CHARGER_CURRENT = "translation_telemetry_chargerCurrent"
    const val CHARGER_POWER = "translation_telemetry_chargerPower"
    const val ENERGY_ADDED = "translation_telemetry_energyAdded"
    const val CHARGING_STATE = "translation_telemetry_chargingState"
    const val BATTERY_LEVEL = "translation_telemetry_batteryLevel"
    const val CHARGE_RATE = "translation_telemetry_chargeRate"
    const val NO_CHARGING = "translation_telemetry_noChargingTelemetry"

    // Media & Navigation
    const val NOW_PLAYING = "translation_telemetry_nowPlaying"
    const val NOTHING_PLAYING = "translation_telemetry_nothingPlaying"
    const val UNKNOWN_ARTIST = "translation_telemetry_unknownArtist"
    const val NO_MEDIA_DATA = "translation_telemetry_noMediaData"
    const val NAVIGATION = "translation_telemetry_navigation"
    const val NO_ACTIVE_DESTINATION = "translation_telemetry_noActiveDestination"
    const val MIN_SHORT = "translation_common_minShort"
    const val PLACE_HOME = "translation_telemetry_placeHome"
    const val PLACE_WORK = "translation_telemetry_placeWork"
    const val PLACE_FAVORITE = "translation_telemetry_placeFavorite"
    const val NO_LOCATION_DATA = "translation_telemetry_noLocationData"

    // Shared common values
    const val UNKNOWN = "translation_common_unknown"
    const val OFF = "translation_common_off"
    const val ON = "translation_common_on"
    const val ACTIVE = "translation_common_active"
    const val INACTIVE = "translation_common_inactive"
    const val CLOSED = "translation_common_closed"
    const val YES = "translation_common_yes"
    const val NO = "translation_common_no"
    const val ENABLED = "translation_common_enabled"
    const val DISABLED = "translation_common_disabled"
}
