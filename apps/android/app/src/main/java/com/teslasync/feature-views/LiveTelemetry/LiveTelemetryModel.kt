// Pure, framework-free model + projection for the LiveTelemetry feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/LiveTelemetry.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// LiveTelemetry is a presentational composite of six live panels — Drivetrain, Climate, Security, Tire
// Pressure, Media, Navigation — each fed one optional data object by the owning Dashboard page (the web
// component's only hook is `useTranslation`; the page owns the `/motor/latest`, `/climate/latest`,
// `/security/latest`, `/tire-pressure/latest`, `/media/latest`, and location queries plus their
// loading / error / stale / offline handling, exactly like the sibling LiveVehicleState surface). So the
// state set this surface itself renders is, per panel, the two branches the web source defines:
//   • a present data object → the panel's rows (web `data ? (...rows) : <SkeletonRows/>`), and
//   • an absent data object → the loading skeleton rows, never a blank box.
// Within the rows every individual value still degrades to the web `'—'` em dash / "no active modes" /
// "no saved location" empty branch, so a partially-populated panel is never blank either.
//
// Unit handling mirrors the established sibling dashboard widgets (ClimateStatusWidget,
// MotorPerformanceWidget, TirePressureVisualWidget, DestinationETAWidget) which read these same endpoints:
// the API serves SI, and the SI→display conversion happens here at the single render boundary via the
// shared [UnitFormatter] (web `useUnits` + the `toXDisplay` props). Temperatures arrive SI Celsius, the
// navigation distance arrives SI metres (wire key `miles_to_arrival`, content metres — the proto-identifier
// paradox), HVAC power arrives in kW, and torque (Nm) / g-forces / volume / fan are rendered verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveTelemetry — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveVehicleState does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetry

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.formatPressure
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** Em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Unit suffix literals the web hard-codes verbatim (not translatable copy, mirroring the sibling widgets). */
internal const val TORQUE_UNIT: String = " Nm"
internal const val G_UNIT: String = "g"
internal const val HVAC_POWER_UNIT: String = " kW"
internal const val ETA_UNIT: String = " min"
internal const val FAN_SCALE_SUFFIX: String = "/6"

/** Status emojis the web hard-codes (decorative; the localized text beside them carries the meaning). */
internal const val EMOJI_LOCKED: String = "\uD83D\uDD12"
internal const val EMOJI_UNLOCKED: String = "\uD83D\uDD13"
internal const val EMOJI_SENTRY: String = "\uD83D\uDEE1\uFE0F"

/** Render precisions pinned to the web call sites (independent of the user's decimal-precision preference). */
private const val TEMP_DECIMALS = 0
private const val HVAC_POWER_DECIMALS = 1
private const val G_DECIMALS = 2
private const val DISTANCE_DECIMALS = 1
private const val PRESSURE_DECIMALS = 1

/** Fan speed scale denominator (web `… / 6`). */
private const val FAN_MAX = 6.0

/** Numeric zero used for the web nullish `?? 0` reads and the truthy-max volume guard. */
private const val ZERO = 0.0

/**
 * Tire-pressure cutoffs, in the SAME magnitude the web `getPressureColor` constant uses, ported VERBATIM
 * from `LiveTelemetry.tsx` (the web variable is literally named `bar`). The web applies these to the raw
 * `/tire-pressure/latest` value with no conversion, and [LiveTelemetryProjection.pressureColor] does
 * likewise, so the native color-coding reproduces the web pixel-for-pixel. The web component is the single
 * source of truth; any threshold revision must land in the web source first and be re-ported here.
 */
private const val PRESSURE_DANGER_LOW = 2.068
private const val PRESSURE_WARN_LOW = 2.275
private const val PRESSURE_WARN_HIGH = 2.896
private const val PRESSURE_DANGER_HIGH = 3.103

/** Bar→kilopascal bridge: the tire value is bar (web `toPressureDisplay(bar)`); the shared formatter takes SI kPa. */
private const val KPA_PER_BAR = 100.0

/** The Go nil string representations the web `cleanNil` filters out (alongside the empty string). */
private val NIL_TOKENS = setOf("<nil>", "nil", "null")

// ── Wire data objects (the web component's six props) ──────────────────────────────────────────────────

/**
 * The `/motor/latest` slice the Drivetrain panel reads — the native mirror of the web `MotorData`
 * (web/src/features/dashboard/types.ts). Field names keep their snake_case wire form via @SerialName, and
 * every field defaults so a partial payload decodes (the decoder ignores keys this surface does not read).
 */
@Serializable
data class MotorLive(
    @SerialName("di_torque") val diTorque: Double? = null,
    @SerialName("di_stator_temp") val diStatorTempC: Double? = null,
    @SerialName("gear") val gear: String? = null,
    @SerialName("lateral_accel") val lateralAccel: Double? = null,
    @SerialName("longitudinal_accel") val longitudinalAccel: Double? = null,
)

/** The `/climate/latest` slice the Climate panel reads — the native mirror of the web `ClimateData`. */
@Serializable
data class ClimateLive(
    @SerialName("inside_temp") val insideTempC: Double? = null,
    @SerialName("outside_temp") val outsideTempC: Double? = null,
    @SerialName("hvac_power") val hvacPowerKw: Double? = null,
    @SerialName("hvac_fan_speed") val hvacFanSpeed: Double? = null,
    @SerialName("defrost_mode") val defrostMode: String? = null,
    @SerialName("battery_heater_on") val batteryHeaterOn: Boolean = false,
)

/** The `/security/latest` slice the Security panel reads — the native mirror of the web `SecurityData`. */
@Serializable
data class SecurityLive(
    @SerialName("locked") val locked: Boolean = false,
    @SerialName("sentry_mode") val sentryMode: Boolean = false,
    @SerialName("door_state") val doorState: String = "",
    @SerialName("fd_window") val fdWindow: String? = null,
    @SerialName("fp_window") val fpWindow: String? = null,
    @SerialName("rd_window") val rdWindow: String? = null,
    @SerialName("rp_window") val rpWindow: String? = null,
)

/** The `/tire-pressure/latest` slice the Tire Pressure panel reads — the native mirror of the web `TirePressureData`. */
@Serializable
data class TirePressureLive(
    @SerialName("front_left") val frontLeft: Double? = null,
    @SerialName("front_right") val frontRight: Double? = null,
    @SerialName("rear_left") val rearLeft: Double? = null,
    @SerialName("rear_right") val rearRight: Double? = null,
)

/** The `/media/latest` slice the Media panel reads — the native mirror of the web `MediaData`. */
@Serializable
data class MediaLive(
    @SerialName("now_playing_title") val nowPlayingTitle: String? = null,
    @SerialName("now_playing_artist") val nowPlayingArtist: String? = null,
    @SerialName("playback_status") val playbackStatus: String? = null,
    @SerialName("audio_volume") val audioVolume: Double? = null,
    @SerialName("audio_volume_max") val audioVolumeMax: Double? = null,
)

/**
 * The location slice the Navigation panel reads — the native mirror of the web `LocationData`. The wire key
 * `miles_to_arrival` carries SI metres (the proto-identifier paradox); it is converted from SI like every
 * other distance, exactly as the web `toDistanceDisplay` prop does.
 */
@Serializable
data class LocationLive(
    @SerialName("destination_name") val destinationName: String? = null,
    @SerialName("miles_to_arrival") val metersToArrival: Double? = null,
    @SerialName("minutes_to_arrival") val minutesToArrival: Double? = null,
    @SerialName("located_at_home") val locatedAtHome: Boolean = false,
    @SerialName("located_at_work") val locatedAtWork: Boolean = false,
    @SerialName("located_at_favorite") val locatedAtFavorite: Boolean = false,
)

/** The six optional panel inputs bundled as one prop bag (the native analogue of the web component's props). */
data class LiveTelemetryData(
    val motor: MotorLive? = null,
    val climate: ClimateLive? = null,
    val security: SecurityLive? = null,
    val tire: TirePressureLive? = null,
    val media: MediaLive? = null,
    val location: LocationLive? = null,
)

// ── Render-ready descriptors ────────────────────────────────────────────────────────────────────────────

/** Semantic chip/badge tone, resolved to the shared `BadgeVariant` / status palette at the render boundary. */
enum class BadgeTone { Info, Success, Warning, Danger, Neutral }

/** A climate status chip (web `Defrost` / `Bat Heater`); the view resolves its glyph, tone, and i18n label. */
enum class ClimateChip { Defrost, BatHeater }

/** The four tire corners, in the web `tires` array order, each carrying the web abbreviation literal. */
enum class TireCorner(
    val label: String,
) {
    FrontLeft("FL"),
    FrontRight("FR"),
    RearLeft("RL"),
    RearRight("RR"),
}

/** The tire value color band (web `getPressureColor`): a null reading is muted, never green. */
enum class TireColor { Normal, Warn, Danger, Muted }

/** A saved-location family the Navigation panel badges (web 🏠 / 🏢 / ⭐); the view resolves its i18n label. */
enum class NavLocation(
    val emoji: String,
) {
    Home("\uD83C\uDFE0"),
    Work("\uD83C\uDFE2"),
    Favorite("\u2B50"),
}

/**
 * The Drivetrain panel content. [gearText] is the cleaned gear string or `null` (the view renders the em
 * dash); [gearTone] colors the gear badge (web `'D'` → success, `'R'` → danger, else neutral).
 */
data class DrivetrainContent(
    val torqueText: String,
    val motorTempText: String,
    val gearText: String?,
    val gearTone: BadgeTone,
    val gforceText: String,
)

/**
 * The Climate panel content. [fanLabel] is the web `{fan ?? 0}/6` text and [fanFraction] the 0..1 bar width;
 * [chips] is empty when neither defrost nor the battery heater is active (the view shows "No active modes").
 */
data class ClimateContent(
    val cabinText: String,
    val outsideText: String,
    val hvacPowerText: String,
    val fanLabel: String,
    val fanFraction: Float,
    val chips: List<ClimateChip>,
)

/**
 * The Security panel content. [openDoors] / [openWindows] drive the badge text + tone (0 → "All Closed"
 * success, else "{n} Open" warning); [locked] / [sentryOn] pick the lock + sentry lines.
 */
data class SecurityContent(
    val locked: Boolean,
    val sentryOn: Boolean,
    val openDoors: Int,
    val openWindows: Int,
) {
    /** Door badge tone (web `openDoors.length === 0 ? 'success' : 'warning'`). */
    val doorsTone: BadgeTone get() = if (openDoors == 0) BadgeTone.Success else BadgeTone.Warning

    /** Window badge tone (web `openWindows.length === 0 ? 'success' : 'warning'`). */
    val windowsTone: BadgeTone get() = if (openWindows == 0) BadgeTone.Success else BadgeTone.Warning
}

/** One render-ready tire corner: its [corner] position, formatted [valueText] (no unit), and [color]. */
data class TireCornerCell(
    val corner: TireCorner,
    val valueText: String,
    val color: TireColor,
)

/**
 * The Tire Pressure panel content. [allNormal] is the web badge check (every corner null OR within the warn
 * band) — distinct from the per-corner [TireColor], which treats a null reading as muted.
 */
data class TireContent(
    val cells: List<TireCornerCell>,
    val unitLabel: String,
    val allNormal: Boolean,
)

/**
 * The Media panel content. [artist] is the cleaned artist or `null` (the view shows "Unknown artist");
 * [statusText] is the cleaned playback status or `null` (the view shows the em dash); [statusTone] colors
 * the badge (web `'Playing'` → success, `'Paused'` → warning, else neutral).
 */
data class MediaContent(
    val title: String,
    val artist: String?,
    val statusText: String?,
    val statusTone: BadgeTone,
    val volumeText: String,
    val volumeFraction: Float,
)

/**
 * The Navigation panel content. [locations] is empty when the vehicle is not at a saved place (the view
 * shows "No saved location").
 */
data class NavigationContent(
    val destinationText: String,
    val distanceText: String,
    val etaText: String,
    val locations: List<NavLocation>,
)

/**
 * The fully projected surface — one nullable content per panel. A `null` content is the panel's loading
 * state (web `data ? rows : <SkeletonRows/>`): the view renders the header plus the skeleton rows, never a
 * blank box.
 */
data class LiveTelemetryDisplay(
    val drivetrain: DrivetrainContent?,
    val climate: ClimateContent?,
    val security: SecurityContent?,
    val tire: TireContent?,
    val media: MediaContent?,
    val navigation: NavigationContent?,
)

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the six optional panel inputs to the render-ready [LiveTelemetryDisplay] — a 1:1 port
 * of the per-panel data derivations in `LiveTelemetry.tsx`. Each panel projects to a content object when its
 * input is present, or to `null` (the loading skeleton) when absent. The SI→display conversions run here
 * through the shared [UnitFormatter] (web `useUnits()` + the `toXDisplay` props), keeping the SI source
 * unconverted (Phase-48; ADR-013).
 */
object LiveTelemetryProjection {
    /** Project all six panels for the given [data] + [formatter]. */
    fun project(
        data: LiveTelemetryData,
        formatter: UnitFormatter,
    ): LiveTelemetryDisplay =
        LiveTelemetryDisplay(
            drivetrain = drivetrain(data.motor, formatter),
            climate = climate(data.climate, formatter),
            security = security(data.security),
            tire = tire(data.tire, formatter),
            media = media(data.media),
            navigation = navigation(data.location, formatter),
        )

    /** Drivetrain rows (web `DrivetrainPanel`); `null` input → the loading skeleton. */
    fun drivetrain(
        motor: MotorLive?,
        formatter: UnitFormatter,
    ): DrivetrainContent? {
        if (motor == null) return null
        val gear = cleanNil(motor.gear)
        return DrivetrainContent(
            torqueText = motor.diTorque?.let { jsNumber(it) + TORQUE_UNIT } ?: EM_DASH,
            motorTempText = formatter.temperature(motor.diStatorTempC, TEMP_DECIMALS),
            gearText = gear,
            gearTone = gearTone(gear),
            gforceText = gforceText(motor.lateralAccel, motor.longitudinalAccel),
        )
    }

    /** Climate rows (web `ClimatePanel`); `null` input → the loading skeleton. */
    fun climate(
        climate: ClimateLive?,
        formatter: UnitFormatter,
    ): ClimateContent? {
        if (climate == null) return null
        val fan = climate.hvacFanSpeed ?: ZERO
        return ClimateContent(
            cabinText = formatter.temperature(climate.insideTempC, TEMP_DECIMALS),
            outsideText = formatter.temperature(climate.outsideTempC, TEMP_DECIMALS),
            hvacPowerText = hvacPowerText(climate.hvacPowerKw),
            fanLabel = jsNumber(fan) + FAN_SCALE_SUFFIX,
            fanFraction = fraction(fan, FAN_MAX),
            chips = climateChips(climate.defrostMode, climate.batteryHeaterOn),
        )
    }

    /** Security rows (web `SecurityPanel`); `null` input → the loading skeleton. */
    fun security(security: SecurityLive?): SecurityContent? {
        if (security == null) return null
        return SecurityContent(
            locked = security.locked,
            sentryOn = security.sentryMode,
            openDoors = openDoorCount(security.doorState),
            openWindows = openWindowCount(security),
        )
    }

    /** Tire rows (web `TirePressurePanel`); `null` input → the loading skeleton. */
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
            cells = raw.map { (corner, value) -> TireCornerCell(corner, pressureValueText(value, formatter), pressureColor(value)) },
            unitLabel = formatter.prefs.pressure.label,
            allNormal = raw.all { (_, value) -> isPressureNormal(value) },
        )
    }

    /** Media rows (web `MediaPanel`); `null` input → the loading skeleton. */
    fun media(media: MediaLive?): MediaContent? {
        if (media == null) return null
        val status = cleanNil(media.playbackStatus)
        return MediaContent(
            title = cleanNil(media.nowPlayingTitle) ?: EM_DASH,
            artist = cleanNil(media.nowPlayingArtist),
            statusText = status,
            statusTone = statusTone(status),
            volumeText = volumeText(media.audioVolume, media.audioVolumeMax),
            volumeFraction = volumeFraction(media.audioVolume, media.audioVolumeMax),
        )
    }

    /** Navigation rows (web `NavigationPanel`); `null` input → the loading skeleton. */
    fun navigation(
        location: LocationLive?,
        formatter: UnitFormatter,
    ): NavigationContent? {
        if (location == null) return null
        return NavigationContent(
            destinationText = location.destinationName?.takeIf { it.isNotEmpty() } ?: EM_DASH,
            distanceText = formatter.distance(location.metersToArrival, DISTANCE_DECIMALS),
            etaText = location.minutesToArrival?.let { formatInt(it) + ETA_UNIT } ?: EM_DASH,
            locations = savedLocations(location),
        )
    }

    // ── value helpers (web parity) ──

    /** Web `${fmtNumber(Math.max(|lat|, |lon|), 2)}g`, but only when at least one axis is present. */
    fun gforceText(
        lateral: Double?,
        longitudinal: Double?,
    ): String {
        if (lateral == null && longitudinal == null) return EM_DASH
        val magnitude = maxOf(abs(lateral ?: ZERO), abs(longitudinal ?: ZERO))
        return formatDecimal(magnitude, G_DECIMALS) + G_UNIT
    }

    /** Web `${fmtNumber(hvac_power, 1)} kW`, em dash when absent / non-finite. */
    fun hvacPowerText(valueKw: Double?): String =
        if (valueKw != null && valueKw.isFinite()) formatDecimal(valueKw, HVAC_POWER_DECIMALS) + HVAC_POWER_UNIT else EM_DASH

    /** Web gear badge tone: `'D'` → success, `'R'` → danger, anything else → neutral. */
    fun gearTone(gear: String?): BadgeTone =
        when (gear) {
            "D" -> BadgeTone.Success
            "R" -> BadgeTone.Danger
            else -> BadgeTone.Neutral
        }

    /** Web media status badge tone: `'Playing'` → success, `'Paused'` → warning, else neutral. */
    fun statusTone(status: String?): BadgeTone =
        when (status) {
            "Playing" -> BadgeTone.Success
            "Paused" -> BadgeTone.Warning
            else -> BadgeTone.Neutral
        }

    /** Climate chips in web order: Defrost (mode present and not `Off`) then Bat Heater (`battery_heater_on`). */
    fun climateChips(
        defrostMode: String?,
        batteryHeaterOn: Boolean,
    ): List<ClimateChip> =
        buildList {
            if (showsDefrost(defrostMode)) add(ClimateChip.Defrost)
            if (batteryHeaterOn) add(ClimateChip.BatHeater)
        }

    /** Web `defrost_mode && defrost_mode !== 'Off'`. */
    fun showsDefrost(defrostMode: String?): Boolean = !defrostMode.isNullOrBlank() && defrostMode != "Off"

    /** Web `doorStates.split(',').map(trim).filter(Boolean).filter(includes 'open')`. */
    fun openDoorCount(doorState: String?): Int =
        (doorState ?: "")
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .count { it.lowercase().contains("open") }

    /** Web `windows.filter((w) => w.val && w.val.toLowerCase() !== 'closed')` over the four window fields. */
    fun openWindowCount(security: SecurityLive): Int =
        listOf(security.fdWindow, security.fpWindow, security.rdWindow, security.rpWindow)
            .count { !it.isNullOrEmpty() && it.lowercase() != "closed" }

    /** Web saved-location badges in order (home, work, favorite); empty → "No saved location". */
    fun savedLocations(location: LocationLive): List<NavLocation> =
        buildList {
            if (location.locatedAtHome) add(NavLocation.Home)
            if (location.locatedAtWork) add(NavLocation.Work)
            if (location.locatedAtFavorite) add(NavLocation.Favorite)
        }

    /**
     * Web `getPressureColor(bar)`: a null reading is muted (never green); outside the danger band is danger;
     * outside the warn band is warn; otherwise normal. Operates on the raw bar value, verbatim thresholds.
     */
    fun pressureColor(bar: Double?): TireColor =
        when {
            bar == null -> TireColor.Muted
            bar < PRESSURE_DANGER_LOW || bar > PRESSURE_DANGER_HIGH -> TireColor.Danger
            bar < PRESSURE_WARN_LOW || bar > PRESSURE_WARN_HIGH -> TireColor.Warn
            else -> TireColor.Normal
        }

    /** Web `allNormal` per-corner check: a null reading counts as normal, else it must sit within the warn band. */
    fun isPressureNormal(bar: Double?): Boolean = bar == null || (bar in PRESSURE_WARN_LOW..PRESSURE_WARN_HIGH)

    /**
     * Web `fmtNumber(toPressureDisplay(bar), 1)` with the unit rendered separately. The value is bar; the
     * shared [formatPressure] takes SI kilopascals, so it is bridged by ×100 (1 bar = 100 kPa) and the unit
     * suffix the footer renders on its own line is stripped. A null/non-finite reading is the em dash.
     */
    fun pressureValueText(
        bar: Double?,
        formatter: UnitFormatter,
    ): String {
        if (bar == null || !bar.isFinite()) return EM_DASH
        val withUnit = formatPressure(bar * KPA_PER_BAR, formatter.prefs, PRESSURE_DECIMALS)
        return withUnit.removeSuffix(" ${formatter.prefs.pressure.label}")
    }

    /** Web volume label: `${volume}` (or em dash) followed by `/${max}` when the max is present. */
    fun volumeText(
        volume: Double?,
        max: Double?,
    ): String {
        val head = if (volume != null) jsNumber(volume) else EM_DASH
        val tail = if (max != null) "/" + jsNumber(max) else ""
        return head + tail
    }

    /** Web volume bar fraction: `volume / max` only when both are present and the max is truthy (non-zero). */
    fun volumeFraction(
        volume: Double?,
        max: Double?,
    ): Float = if (volume != null && max != null && max != ZERO) fraction(volume, max) else 0f

    /** Web `cleanNil`: filters the Go nil string representations and the empty string to `null`. */
    fun cleanNil(value: String?): String? = value?.takeUnless { it.isEmpty() || it in NIL_TOKENS }

    private fun fraction(
        value: Double,
        scale: Double,
    ): Float = (value / scale).coerceIn(0.0, 1.0).toFloat()

    /**
     * Mirrors a JavaScript template-literal `${number}`: an integral value prints with no fraction (and no
     * grouping), a fractional value prints its shortest decimal form — reproducing the web torque / fan /
     * volume reads which interpolate the raw number rather than running it through `fmtNumber`.
     */
    fun jsNumber(value: Double): String {
        if (value.isFinite() && value == floor(value)) return value.toLong().toString()
        return value.toString()
    }

    /** Locale-stable grouped decimal formatter (web `fmtNumber`), half-expand rounding, en-US separators. */
    fun formatDecimal(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    /** Locale-stable grouped integer formatter (web `fmtInt`). */
    fun formatInt(value: Double): String = groupedFormat(0).format(value)

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_UP }
    }
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any telemetry
 * value — so a diagnostics line can never leak the vehicle's location, media, lock posture, or sensor data.
 */
object LiveTelemetryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveTelemetry"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * The generated i18n resource names this surface resolves (P1/S10), mirroring every `t('telemetry.*')` key
 * the web component calls. Kept as a single contract object so the accessibility/label test can assert the
 * surface still covers the full web key set without standing up a Compose host.
 */
internal object LiveTelemetryKeys {
    const val TITLE = "translation_telemetry_title"
    const val DRIVETRAIN = "translation_telemetry_drivetrain"
    const val CLIMATE = "translation_telemetry_climate"
    const val SECURITY = "translation_telemetry_security"
    const val TIRE_PRESSURE = "translation_telemetry_tirePressure"
    const val MEDIA = "translation_telemetry_media"
    const val NAVIGATION = "translation_telemetry_navigation"
    const val TORQUE = "translation_telemetry_torque"
    const val MOTOR_TEMP = "translation_telemetry_motorTemp"
    const val GEAR = "translation_telemetry_gear"
    const val GFORCE = "translation_telemetry_gforce"
    const val CABIN = "translation_telemetry_cabin"
    const val OUTSIDE = "translation_telemetry_outside"
    const val HVAC = "translation_telemetry_hvac"
    const val FAN = "translation_telemetry_fan"
    const val DEFROST = "translation_telemetry_defrost"
    const val BAT_HEATER = "translation_telemetry_batHeater"
    const val NO_MODES = "translation_telemetry_noModes"
    const val LOCK = "translation_telemetry_lock"
    const val LOCKED = "translation_telemetry_locked"
    const val UNLOCKED = "translation_telemetry_unlocked"
    const val SENTRY = "translation_telemetry_sentry"
    const val ACTIVE = "translation_telemetry_active"
    const val OFF = "translation_telemetry_off"
    const val DOORS = "translation_telemetry_doors"
    const val ALL_CLOSED = "translation_telemetry_allClosed"
    const val OPEN = "translation_telemetry_open"
    const val WINDOWS = "translation_telemetry_windows"
    const val ALL_NORMAL = "translation_telemetry_allNormal"
    const val WARNING = "translation_telemetry_warning"
    const val UNKNOWN_ARTIST = "translation_telemetry_unknownArtist"
    const val STATUS = "translation_telemetry_status"
    const val VOLUME = "translation_telemetry_volume"
    const val DESTINATION = "translation_telemetry_destination"
    const val DISTANCE = "translation_telemetry_distance"
    const val ETA = "translation_telemetry_eta"
    const val HOME = "translation_telemetry_home"
    const val WORK = "translation_telemetry_work"
    const val FAVORITE = "translation_telemetry_favorite"
    const val NO_SAVED_LOCATION = "translation_telemetry_noSavedLocation"
}
