// Pure, framework-free model + projection for the VehicleCard feature view — the native analogue of
// everything the web component derives before returning JSX (web/src/features/vehicles/components/VehicleCard.tsx).
// No Compose, no Android framework, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component takes a `vehicle` prop and binds `useVehicleState(vehicle.id)` itself, then renders a
// `GlassPanel` with: a gradient accent strip, a `TeslaCarViz` (which ALWAYS renders — battery defaults to 50
// and locked to true when no live state), the vehicle name (link) + `StatusBadge`, a model/trim/vin subtitle,
// and — only when a live `state` is present — a stats row (battery `ProgressRing` + percent + rated range, the
// inside temperature, the odometer + its unit, the charger power when charging, and lock / sentry glyphs), plus
// two actions (open details, remove). This file owns the parts the web derives from those props: the resolved
// name / subtitle / status (web `getVehicleStatus`), the battery accent (web `batteryColor`), the SI→display
// formatted figures, the always-on car-viz inputs, and the accessible summary. Values stay SI on the wire; the
// SI→display conversion happens here through the injected [UnitFormatter] (the web `useUnits` boundary), never
// by mutating the source (Phase-48 SI-canonical rule; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale

/** Em dash shown wherever a value is unknown — the web `'\u2014'` empty marker. */
internal const val CARD_EM_DASH: String = "\u2014"

/** Universal unit symbols the web renders verbatim regardless of locale (`kW`, `%`). */
internal const val CARD_KW: String = "kW"
internal const val CARD_PERCENT: String = "%"

/** Middle dot joining the model/trim and the VIN in the subtitle (web `·`). */
internal const val CARD_DOT: String = "\u00B7"

/** Web `getVehicleStatus(undefined)` fallback + the FSM passthrough states (`deriveVehicleStatus`). */
internal const val CARD_STATUS_OFFLINE: String = "offline"
internal const val CARD_STATUS_CHARGING: String = "charging"
internal const val CARD_STATUS_DRIVING: String = "driving"
internal const val CARD_STATUS_ONLINE: String = "online"

/**
 * The vehicle operational states the web `deriveVehicleStatus` passes through verbatim (web `@/types/fsm`
 * `VEHICLE_STATES`); any other `state.state` falls back to [CARD_STATUS_ONLINE], exactly as the web does.
 */
internal val CARD_VEHICLE_STATES: Set<String> =
    setOf("online", "driving", "charging", "parked", "updating", "asleep", "offline")

/** Battery accent thresholds — the web `batteryColor`: `> 60` good, `> 25` warning, else danger. */
internal const val CARD_BATTERY_GOOD_MIN: Int = 60
internal const val CARD_BATTERY_WARN_MIN: Int = 25

/** The car-viz battery default when no live state is present — web `state?.battery_level ?? 50`. */
internal const val CARD_VIZ_DEFAULT_BATTERY: Double = 50.0

/** Render precision: the odometer is a whole number (web `fmtInt`); the charger power shows one decimal. */
internal const val CARD_ODOMETER_DECIMALS: Int = 0
internal const val CARD_POWER_DECIMALS: Int = 1

/**
 * The accent the battery figure (`ProgressRing` arc) takes, mapped to a design token at the render boundary —
 * the native analogue of the web `batteryColor(level)` traffic-light (emerald / amber / red).
 */
enum class BatteryAccent { Good, Warn, Danger }

/**
 * The already-localized microcopy the surface folds into its output — the four `t('card.*')` keys the web
 * component resolves plus the "asleep" empty-state line (the native lifecycle chrome the web card omits). The
 * loading / offline / freshness chrome is resolved inline at the Compose boundary, so this stays a thin carrier.
 */
data class VehicleCardStrings(
    val interior: String,
    val charging: String,
    val viewDetails: String,
    val removeVehicle: String,
    val asleep: String,
)

/**
 * The fully projected, render-ready view of a vehicle card — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host.
 *
 * The header fields ([name] / [subtitle] / [status]) and the car-viz inputs ([vizBatteryLevel] / [isCharging] /
 * [isLocked] / [sentryMode] / [modelKey]) are ALWAYS populated — with the web's `?? 50 / ?? true / ?? false`
 * defaults when no live state is present — so the card never renders blank. The stats fields ([batteryLevel] …
 * [chargerPowerText]) are meaningful only when [hasState] is true (the web `{state && …}` gate); the view shows
 * them then and an "asleep" hint otherwise.
 *
 * @property hasState whether a live [VehicleState] resolved (web `state` truthy) — gates the stats row.
 * @property batteryLevel the battery percentage (web `state.battery_level`); `0` when [hasState] is false.
 * @property batteryAccent the `ProgressRing` arc accent (web `batteryColor`).
 * @property rangeText the SI→display rated range with its unit (web `formatDistance(state.rated_range)`).
 * @property interiorText the SI→display inside temperature (web `formatTemperature(state.inside_temp)`).
 * @property odometerText the SI→display odometer, whole-number + grouped (web `fmtInt(convertDistanceFromSI…)`).
 * @property distanceUnitLabel the distance unit shown under the odometer (web `unitPrefs.distance`).
 * @property chargerPowerText the charger power in kW (web `{state.charger_power} kW`); shown only when charging.
 * @property vizBatteryLevel the car-viz state-of-charge (web `state?.battery_level ?? 50`).
 * @property modelKey the raw model string the view parses into a `TeslaModel` (web `parseModelKey(vehicle.model)`).
 * @property accessibleSummary the spoken summary for the whole card (TalkBack).
 */
data class VehicleCardDisplay(
    val name: String,
    val subtitle: String,
    val status: String,
    val hasState: Boolean,
    val batteryLevel: Int,
    val batteryPercentText: String,
    val batteryAccent: BatteryAccent,
    val rangeText: String,
    val interiorText: String,
    val odometerText: String,
    val distanceUnitLabel: String,
    val isCharging: Boolean,
    val chargerPowerText: String,
    val isLocked: Boolean,
    val sentryMode: Boolean,
    val vizBatteryLevel: Double,
    val modelKey: String?,
    val accessibleSummary: String,
)

/** Resolves the rendered name — web `vehicle.display_name || vehicle.vin`. */
internal fun vehicleCardName(vehicle: Vehicle): String = vehicle.displayName.ifBlank { vehicle.vin }

/**
 * Resolves the model/trim/vin subtitle — web `{model} {trim_badging} · {vin}`. The OpenAPI [Vehicle] carries
 * `trim_level` rather than the web's `trim_badging`, so the trim is taken from it (the same parity mapping the
 * sibling VehicleHero surface uses); an absent model + trim degrades to the bare VIN.
 */
internal fun vehicleCardSubtitle(vehicle: Vehicle): String {
    val modelTrim =
        listOf(vehicle.model?.trim().orEmpty(), vehicle.trimLevel?.trim().orEmpty())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
    return if (modelTrim.isEmpty()) vehicle.vin else "$modelTrim $CARD_DOT ${vehicle.vin}"
}

/**
 * Derives the display status — the 1:1 port of the web `getVehicleStatus` (`deriveVehicleStatus`): no state is
 * "offline"; a charging vehicle is "charging"; a moving vehicle (`speed > 0`) is "driving"; otherwise the
 * vehicle's own `state` when it is a known FSM state, else "online".
 */
internal fun deriveVehicleCardStatus(state: VehicleState?): String =
    when {
        state == null -> CARD_STATUS_OFFLINE
        state.isCharging -> CARD_STATUS_CHARGING
        state.speed > 0.0 -> CARD_STATUS_DRIVING
        else -> state.state.lowercase(Locale.ROOT).takeIf { it in CARD_VEHICLE_STATES } ?: CARD_STATUS_ONLINE
    }

/** Maps a battery percentage onto its accent — the web `batteryColor` thresholds. */
internal fun batteryAccentFor(level: Int): BatteryAccent =
    when {
        level > CARD_BATTERY_GOOD_MIN -> BatteryAccent.Good
        level > CARD_BATTERY_WARN_MIN -> BatteryAccent.Warn
        else -> BatteryAccent.Danger
    }

/**
 * Pure projection from the vehicle + its (nullable) live state to the render-ready [VehicleCardDisplay] — a 1:1
 * port of the web component's derivations. SI distance/temperature values are converted through the injected
 * [formatter] (the web `useUnits` boundary); the charger power is kW on the wire (the API field unit, mirrored
 * from the web `{charger_power} kW`) so it is formatted as-is. A `null` [state] yields the header-only display
 * with the web car-viz defaults (battery 50, locked, not charging) — the never-blank "asleep" presentation.
 */
object VehicleCardProjection {
    /**
     * Projects [vehicle] + (nullable) [state] for the live [formatter] into the render-ready display.
     *
     * @param vehicle the card's vehicle (web `vehicle` prop — the source of name / model / trim / vin).
     * @param state the vehicle's last-known live state (web `useVehicleState(...).state`); `null` is the asleep
     *   / offline header-only presentation.
     * @param formatter the SI→display formatter bound to the user's units (web `useUnits()`).
     * @param strings the localized microcopy (web `t('card.*')`), folded into the accessible summary.
     * @param locale formats the numeric odometer / power values (web `Intl.NumberFormat`).
     */
    fun project(
        vehicle: Vehicle,
        state: VehicleState?,
        formatter: UnitFormatter,
        strings: VehicleCardStrings,
        locale: Locale,
    ): VehicleCardDisplay {
        val name = vehicleCardName(vehicle)
        val subtitle = vehicleCardSubtitle(vehicle)
        val status = deriveVehicleCardStatus(state)
        if (state == null) {
            return VehicleCardDisplay(
                name = name,
                subtitle = subtitle,
                status = status,
                hasState = false,
                batteryLevel = 0,
                batteryPercentText = CARD_EM_DASH,
                batteryAccent = BatteryAccent.Danger,
                rangeText = CARD_EM_DASH,
                interiorText = CARD_EM_DASH,
                odometerText = CARD_EM_DASH,
                distanceUnitLabel = formatter.prefs.distance.label,
                isCharging = false,
                chargerPowerText = CARD_EM_DASH,
                isLocked = true,
                sentryMode = false,
                vizBatteryLevel = CARD_VIZ_DEFAULT_BATTERY,
                modelKey = vehicle.model,
                accessibleSummary = buildSummary(name, status, state = null, strings),
            )
        }
        val level = state.batteryLevel.toInt()
        return VehicleCardDisplay(
            name = name,
            subtitle = subtitle,
            status = status,
            hasState = true,
            batteryLevel = level,
            batteryPercentText = "$level$CARD_PERCENT",
            batteryAccent = batteryAccentFor(level),
            rangeText = formatter.distance(state.ratedRange),
            interiorText = formatter.temperature(state.insideTemp),
            odometerText =
                ChartFormat.number(
                    convertDistanceFromSI(state.odometer, formatter.prefs.distance),
                    CARD_ODOMETER_DECIMALS,
                    locale,
                ),
            distanceUnitLabel = formatter.prefs.distance.label,
            isCharging = state.isCharging,
            chargerPowerText = "${ChartFormat.number(state.chargerPower, CARD_POWER_DECIMALS, locale)} $CARD_KW",
            isLocked = state.isLocked,
            sentryMode = state.sentryMode,
            vizBatteryLevel = state.batteryLevel * 1.0,
            modelKey = vehicle.model,
            accessibleSummary = buildSummary(name, status, state, strings),
        )
    }

    /**
     * The card's spoken summary (the web equivalent of the visible name / status / battery / charging cues).
     * Carries the localized labels but never the VIN, so the summary reads naturally without leaking identity.
     */
    private fun buildSummary(
        name: String,
        status: String,
        state: VehicleState?,
        strings: VehicleCardStrings,
    ): String =
        buildList {
            add(name)
            add(status)
            if (state != null) {
                add("${state.batteryLevel}$CARD_PERCENT")
                if (state.isCharging) add(strings.charging)
            }
        }.joinToString(SUMMARY_SEPARATOR)

    private const val SUMMARY_SEPARATOR = ", "
}

/**
 * The mutually-exclusive surface the card's stats region renders for a given [UiState] of the live-state feed.
 * The card chrome (car viz + name + status + subtitle + actions) always renders; only this inner region
 * switches, so no part of the card is ever hidden. [Content] is a resolved live state, [Empty] is the asleep /
 * offline "no live state" presentation (web `{state && …}` false), [Loading] is the first fetch, and [Error] is
 * a hard failure with nothing cached.
 */
enum class VehicleCardStatsSurface { Loading, Error, Content, Empty }

/**
 * Maps the live-state [UiState] onto the stats-region surface. Stale/offline cached state stays [Content] (plus
 * a freshness chip) — the honest "last known" contract the sibling surfaces follow — never a blanked region.
 */
fun vehicleCardStatsSurface(state: UiState<VehicleStateEnvelope>): VehicleCardStatsSurface =
    when {
        state.isLoading -> VehicleCardStatsSurface.Loading
        state.isError && !state.hasData -> VehicleCardStatsSurface.Error
        state.data?.state != null -> VehicleCardStatsSurface.Content
        else -> VehicleCardStatsSurface.Empty
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the VIN,
 * battery level, location, or any live value — so a diagnostics line can never leak the vehicle's identity or
 * posture.
 */
object VehicleCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "VehicleCard"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
