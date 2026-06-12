// Pure, framework-free model + projection for the VehicleStatePanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// VehicleStatePanel is a presentational surface. The web component takes two props — `live`
// (a `Record<string, unknown>` of the latest live signal values) and `sseConnected` — from the owning
// Vehicle-detail page, which owns the live SSE stream and therefore owns the cache-then-network states
// (initial load, hard error, stale, offline). So, exactly like the sibling LiveVehicleState / StatusHeader
// ports, this surface binds no data hooks for its rows (its web hooks are `useTranslation` + `useUnits`) and
// those page-level states live on the owner, not here. The state set this surface itself renders is:
//   • the always-present panel of ten rows in three groups — each row degrades to its own "off"/em-dash
//     fallback, so an empty `live` map still renders a fully-populated panel and never a blank box
//     (the web has no separate empty branch; the rows ARE the never-blank empty presentation), and
//   • the pulsing "Live" indicator, shown exactly when `sseConnected` is true (the disconnected/offline
//     presentation simply withholds the chip while the rows keep their last-known/fallback values).
//
// The web reads eleven fields off the `live` map by their camelCase keys; [VehicleLiveState] mirrors that
// shape (the kotlinx.serialization default uses the property name as the JSON key, so the projection can run
// straight off the serialized live object) and every field defaults so a partial payload decodes without
// error. The boolean rows take a plain JS-truthiness check; the string rows (`lightsTurnSignal`,
// `centerDisplay`) and the count rows (`pairedKeyCount`, `homelinkDeviceCount`) arrive as `unknown`, so they
// are modelled as [JsonElement] and narrowed in the projection exactly as the web `(x as string) || …`
// guards do — a number `0` and an empty string fall back to the em-dash just like the web `||` operator.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleStatePanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclestatepanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The slice of the live-signal map this surface reads — the native mirror of the eleven `live.*` keys the web
 * `VehicleStatePanel` consumes. Property names are the exact camelCase keys the web reads, so the kotlinx
 * default key strategy decodes a serialized `live` object directly; every field defaults so a partial payload
 * (or an empty `{}` map) decodes without error.
 *
 * Three groups of fields, by how the web narrows them:
 *  • plain booleans checked with JS truthiness ([lightsHighBeams], [lightsHazards], [driverSeatOccupied],
 *    [valetMode], [serviceMode], [speedLimitMode]),
 *  • [currentSpeedLimit], the SI metres-per-second the web passes to `formatSpeed` when speed-limit mode is on,
 *  • union-typed `unknown` fields ([lightsTurnSignal], [pairedKeyCount], [centerDisplay], [homelinkDeviceCount])
 *    modelled as [JsonElement] and narrowed in [VehicleStatePanelProjection] rather than coerced.
 */
@Serializable
data class VehicleLiveState(
    val lightsHighBeams: Boolean? = null,
    val lightsTurnSignal: JsonElement? = null,
    val lightsHazards: Boolean? = null,
    val driverSeatOccupied: Boolean? = null,
    val pairedKeyCount: JsonElement? = null,
    val valetMode: Boolean? = null,
    val serviceMode: Boolean? = null,
    val speedLimitMode: Boolean? = null,
    val currentSpeedLimit: Double? = null,
    val centerDisplay: JsonElement? = null,
    val homelinkDeviceCount: JsonElement? = null,
)

/**
 * Stable identity of each row, in the exact order the web renders them. The view maps each key onto its i18n
 * label and glyph; keeping the key separate from the resolved label keeps the projection free of any
 * Android / i18n dependency.
 */
enum class StateRowKey {
    HIGH_BEAMS,
    TURN_SIGNAL,
    HAZARDS,
    DRIVER_SEAT,
    PAIRED_KEYS,
    VALET_MODE,
    SERVICE_MODE,
    SPEED_LIMIT,
    CENTER_DISPLAY,
    HOMELINK_DEVICES,
}

/**
 * The accent a row's value takes when it is active — the native mapping of the per-row Tailwind colors the
 * web hard-codes (`text-cyan-300` / `text-amber-300` / `text-rose-300` / `text-green-400` / `text-purple-400`).
 * [NEUTRAL] marks the three rows the web always paints with the primary foreground regardless of value
 * (`text-[var(--text-primary)]`: Paired Keys, Center Display, HomeLink Devices); the view resolves it to the
 * primary color and ignores `active` for those rows.
 */
enum class RowAccent {
    INFO,
    WARNING,
    DANGER,
    SUCCESS,
    PURPLE,
    NEUTRAL,
}

/**
 * The render-ready value of a row, decoupled from its localized text so the projection stays pure. The view
 * resolves the enum cases through the i18n catalog (P1/S10) and renders [Dash] as the em-dash fallback;
 * [Literal] carries an already-final string (a passthrough enum/state name, a stringified count, or a
 * formatted speed) that is not itself translated — mirroring the web `String(n)` / `formatSpeed(...)` /
 * passthrough value paths.
 */
sealed interface SignalValue {
    /** Web `'On'` branch → `common.on`. */
    data object On : SignalValue

    /** Web `'Off'` / `t('common.off', 'Off')` branch → `common.off`. */
    data object Off : SignalValue

    /** Web `'Active'` branch → `common.active`. */
    data object Active : SignalValue

    /** Web driver-seat occupied branch → `admin.security.live.occupied`. */
    data object Occupied : SignalValue

    /** Web driver-seat empty branch → `admin.security.live.empty`. */
    data object Empty : SignalValue

    /** Web `'Enabled'` branch → `common.enabled`. */
    data object Enabled : SignalValue

    /** Web `'—'` fallback whenever a value is falsy (`|| '—'`). */
    data object Dash : SignalValue

    /** A non-translated passthrough value: a turn-signal/center-display string, a count, or a formatted speed. */
    data class Literal(
        val text: String,
    ) : SignalValue
}

/**
 * One fully projected row — the native analogue of a single `flex items-center justify-between` line in the
 * web list (minus the glyph, which the view supplies from [StateRowKey]). Pure data so the projection is
 * unit-tested without a UI host; the grouped list of these doubles as the surface's per-state snapshot.
 *
 * @property key the row identity (drives label + glyph in the view).
 * @property value the render-ready value descriptor.
 * @property active whether the value renders in its accent color (web truthy branch); ignored by the view for
 *   [RowAccent.NEUTRAL] rows, which always render the primary foreground.
 * @property accent the accent the value takes when [active] (or [RowAccent.NEUTRAL] for the always-primary rows).
 */
data class StateRow(
    val key: StateRowKey,
    val value: SignalValue,
    val active: Boolean,
    val accent: RowAccent,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX.
 *
 * @property live whether the pulsing "Live" indicator renders — web `sseConnected &&` (true exactly when the
 *   SSE stream is connected).
 * @property groups the rows split into the web's three divider-separated groups (Lights; Driver & Keys;
 *   Access Modes). Always the full ten rows for any input, including an empty `live` map — each row carries
 *   its own fallback value, so the panel is never blank.
 */
data class VehicleStateDisplay(
    val live: Boolean,
    val groups: List<List<StateRow>>,
)

/**
 * Pure projection from the live-signal slice + the connection flag to the render-ready [VehicleStateDisplay] —
 * a 1:1 port of the web row derivations. The speed-limit row formats SI metres-per-second through the shared
 * [UnitFormatter] (the web `useUnits().formatSpeed` boundary); every other derivation is plain data narrowing.
 */
object VehicleStatePanelProjection {
    /**
     * Project the live slice and connection flag onto the render-ready view (web `{ live, sseConnected }`).
     *
     * @param live the latest live-signal slice (web `live` prop); an all-null instance models an empty `{}` map.
     * @param sseConnected whether the SSE stream is connected (web `sseConnected` prop) — gates the indicator.
     * @param formatter the SI→display formatter bound to the user's units (web `useUnits()`), used for the
     *   speed-limit value only.
     */
    fun project(
        live: VehicleLiveState,
        sseConnected: Boolean,
        formatter: UnitFormatter,
    ): VehicleStateDisplay =
        VehicleStateDisplay(
            live = sseConnected,
            groups =
                listOf(
                    listOf(
                        boolRow(StateRowKey.HIGH_BEAMS, live.lightsHighBeams, SignalValue.On, RowAccent.INFO),
                        turnSignalRow(live.lightsTurnSignal),
                        boolRow(StateRowKey.HAZARDS, live.lightsHazards, SignalValue.Active, RowAccent.DANGER),
                    ),
                    listOf(
                        driverSeatRow(live.driverSeatOccupied),
                        neutralRow(StateRowKey.PAIRED_KEYS, live.pairedKeyCount),
                    ),
                    listOf(
                        boolRow(StateRowKey.VALET_MODE, live.valetMode, SignalValue.Enabled, RowAccent.PURPLE),
                        boolRow(StateRowKey.SERVICE_MODE, live.serviceMode, SignalValue.Active, RowAccent.WARNING),
                        speedLimitRow(live.speedLimitMode, live.currentSpeedLimit, formatter),
                        neutralRow(StateRowKey.CENTER_DISPLAY, live.centerDisplay),
                        neutralRow(StateRowKey.HOMELINK_DEVICES, live.homelinkDeviceCount),
                    ),
                ),
        )

    /**
     * Web boolean row (`live.x ? onLabel : 'Off'`): the value is [onValue] when the flag is truthy and
     * [SignalValue.Off] otherwise (there is no em-dash branch — a falsy flag always shows "Off"), and the row
     * is active exactly when the flag is truthy.
     */
    private fun boolRow(
        key: StateRowKey,
        value: Boolean?,
        onValue: SignalValue,
        accent: RowAccent,
    ): StateRow = StateRow(key, if (value == true) onValue else SignalValue.Off, value == true, accent)

    /**
     * Web turn-signal row (`(live.lightsTurnSignal as string) || 'Off'`, active when present and `!== 'Off'`):
     * the value is the non-empty string or "Off", and it is active only when a non-empty string other than
     * "Off" is present.
     */
    private fun turnSignalRow(raw: JsonElement?): StateRow {
        val text = nonEmptyString(raw)
        val value = text?.let { SignalValue.Literal(it) } ?: SignalValue.Off
        return StateRow(StateRowKey.TURN_SIGNAL, value, text != null && text != "Off", RowAccent.WARNING)
    }

    /** Web driver-seat row (`live.driverSeatOccupied ? 'Occupied' : 'Empty'`): active when occupied. */
    private fun driverSeatRow(occupied: Boolean?): StateRow =
        StateRow(
            StateRowKey.DRIVER_SEAT,
            if (occupied == true) SignalValue.Occupied else SignalValue.Empty,
            occupied == true,
            RowAccent.SUCCESS,
        )

    /**
     * Web speed-limit row (`live.speedLimitMode ? formatSpeed(live.currentSpeedLimit) : t('common.off')`):
     * when speed-limit mode is on the value is the SI speed formatted through the shared [formatter] and the
     * row is active; otherwise it is "Off" and inactive.
     */
    private fun speedLimitRow(
        mode: Boolean?,
        speed: Double?,
        formatter: UnitFormatter,
    ): StateRow {
        val active = mode == true
        val value = if (active) SignalValue.Literal(formatter.speed(speed)) else SignalValue.Off
        return StateRow(StateRowKey.SPEED_LIMIT, value, active, RowAccent.INFO)
    }

    /**
     * Web always-primary count/string row (`(live.x as string) || '—'`): the value is the stringified non-zero
     * number or non-empty string, else the em-dash. The accent is [RowAccent.NEUTRAL] so the view always paints
     * the primary foreground (web `text-[var(--text-primary)]`); `active` tracks presence for completeness only.
     */
    private fun neutralRow(
        key: StateRowKey,
        raw: JsonElement?,
    ): StateRow {
        val value = truthyOrDash(raw)
        return StateRow(key, value, value is SignalValue.Literal, RowAccent.NEUTRAL)
    }

    /**
     * Web `(value as string) || '—'` JS-truthiness narrowing: a non-empty string and a non-zero number pass
     * through stringified; an empty string, a numeric zero, a boolean, and an absent value fall back to the
     * em-dash. A string `"0"` is truthy (passes through) but a numeric `0` is falsy (em-dash), exactly like JS.
     */
    private fun truthyOrDash(el: JsonElement?): SignalValue {
        val primitive = el as? JsonPrimitive ?: return SignalValue.Dash
        val text =
            when {
                primitive.isString -> primitive.content.takeIf { it.isNotEmpty() }
                else -> primitive.doubleOrNull?.takeIf { it != 0.0 }?.let { primitive.content }
            }
        return text?.let { SignalValue.Literal(it) } ?: SignalValue.Dash
    }

    /** Web `asNonEmptyString`: the value only when it is a non-empty JSON string; null otherwise. */
    private fun nonEmptyString(el: JsonElement?): String? {
        val primitive = el as? JsonPrimitive ?: return null
        return if (!primitive.isString) null else primitive.content.takeIf { it.isNotEmpty() }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any live
 * signal value — so a diagnostics line can never leak the vehicle's lights / valet / seat / key posture.
 */
object VehicleStatePanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "VehicleStatePanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
