// Pure, framework-free model + projection for the LiveVehicleState feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/LiveVehicleState.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// LiveVehicleState is a presentational surface — the web component takes its `latest` security event as a
// prop from the Security/Access page (which owns the `/security/latest` TanStack query and its loading /
// error / stale / offline handling, e.g. `<SecurityStatusCards latest isLoading />`). So, exactly like the
// sibling StatusHeader port, this surface binds no data hooks (its only web hook is `useTranslation`) and
// the cache-then-network states live on the owning page, not here. The two branches the web source defines
// are the complete state set this surface renders:
//   • a present `latest` → the live-signal grid plus the pulsing "Live" indicator
//     (web `liveSignals.length > 0` and `latest &&` respectively), and
//   • an absent `latest` → a friendly empty state ("No live state data available"), never a blank box
//     (web `<EmptyState .../>`), which doubles as the offline-cached-empty surface.
//
// The web reads ten signals off the optional `SecurityEvent`; [SecurityEventLive] mirrors that wire shape
// (snake_case via @SerialName, matching the Go JSON tags emitted by `internal/api/security/handler.go`) so
// the projection can run straight off the cached API JSON. Three of those fields — `lights_turn_signal`,
// `speed_limit_mode`, `center_display` — arrive as a raw `signal.SignalValue` that may be a string OR a
// boolean (see web `lib/typeGuards.ts::asNonEmptyString`); they are modelled as [JsonElement] and narrowed
// in the projection exactly as the web `asNonEmptyString` / `typeof === 'boolean'` guards do, so a boolean
// never gets coerced into a string and vice-versa.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveVehicleState — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livevehiclestate

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * The slice of `/security/latest` this surface reads — the native mirror of the ten `SecurityEvent` fields
 * the web `buildLiveSignals` consumes (`web/src/types/admin.ts`). Field names keep their snake_case wire
 * form via @SerialName so the projection runs directly off the cached API JSON, and every field defaults so
 * a partial payload decodes without error (a decoder must ignore unknown keys for the columns this surface
 * does not read).
 *
 * The three union-typed fields ([lightsTurnSignal], [speedLimitMode], [centerDisplay]) are [JsonElement]
 * because the backend serializes a raw `signal.SignalValue` that can be a JSON string *or* a JSON boolean;
 * they are narrowed in [LiveVehicleStateProjection] rather than coerced, preserving the web type-guard
 * invariant.
 */
@Serializable
data class SecurityEventLive(
    @SerialName("lights_hazards_active") val lightsHazardsActive: Boolean? = null,
    @SerialName("lights_high_beams") val lightsHighBeams: Boolean? = null,
    @SerialName("lights_turn_signal") val lightsTurnSignal: JsonElement? = null,
    @SerialName("driver_seat_occupied") val driverSeatOccupied: Boolean? = null,
    @SerialName("paired_phone_key_count") val pairedPhoneKeyCount: Int? = null,
    @SerialName("valet_mode_enabled") val valetModeEnabled: Boolean? = null,
    @SerialName("service_mode") val serviceMode: Boolean? = null,
    @SerialName("speed_limit_mode") val speedLimitMode: JsonElement? = null,
    @SerialName("homelink_device_count") val homelinkDeviceCount: Int? = null,
    @SerialName("center_display") val centerDisplay: JsonElement? = null,
)

/**
 * Stable identity of each live signal, in the exact order the web `buildLiveSignals` emits them. The view
 * maps each key onto its i18n label and glyph; keeping the key separate from the resolved label keeps the
 * projection free of any Android/i18n dependency.
 */
enum class LiveSignalKey {
    HAZARDS,
    HIGH_BEAMS,
    TURN_SIGNAL,
    DRIVER_SEAT,
    PAIRED_KEYS,
    VALET_MODE,
    SERVICE_MODE,
    SPEED_LIMIT,
    HOMELINK_DEVICES,
    CENTER_DISPLAY,
}

/**
 * The render-ready value of a signal, decoupled from its localized text so the projection stays pure. The
 * view resolves [On]/[Off]/[Occupied]/[Empty] through the i18n catalog and renders [Dash] as the em-dash
 * fallback; [Literal] carries an already-final string (a passthrough enum/state name or a count) that is
 * not itself translated — mirroring the web `String(n)` / `asNonEmptyString(...)` value paths.
 */
sealed interface SignalValue {
    /** Web `boolLabel(true)` / the boolean `speed_limit_mode` true branch → "On" (`admin.security.on`). */
    data object On : SignalValue

    /** Web `boolLabel(false)` / the boolean `speed_limit_mode` false branch → "Off" (`admin.security.off`). */
    data object Off : SignalValue

    /** Web driver-seat occupied branch → "Occupied" (`admin.security.live.occupied`). */
    data object Occupied : SignalValue

    /** Web driver-seat empty branch → "Empty" (`admin.security.live.empty`). */
    data object Empty : SignalValue

    /** Web `'—'` fallback whenever a value is null/absent (or a non-string in a string field). */
    data object Dash : SignalValue

    /** A non-translated passthrough value: a turn-signal/center-display/speed-limit string, or a count. */
    data class Literal(
        val text: String,
    ) : SignalValue
}

/**
 * One fully projected live-signal cell — the native analogue of the web `LiveSignal` (minus the JSX icon,
 * which the view supplies from [LiveSignalKey]). Pure data so the projection is unit-tested without a UI
 * host; the per-state list of these doubles as the surface's snapshot.
 *
 * @property key the signal identity (drives label + glyph in the view).
 * @property value the render-ready value descriptor.
 * @property active whether the signal is in an "on/occupied/non-zero" state — web `active`, which tints the
 *   icon and value (accent vs muted).
 */
data class LiveSignal(
    val key: LiveSignalKey,
    val value: SignalValue,
    val active: Boolean,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX.
 *
 * @property live whether the pulsing "Live" indicator renders — web `latest &&` (true exactly when a
 *   `latest` event is present).
 * @property signals the live-signal cells; empty when `latest` is absent, which selects the empty state
 *   (web `liveSignals.length > 0 ? grid : <EmptyState/>`). When present it always holds all ten signals,
 *   matching the web builder which returns the full set for any non-null event.
 */
data class LiveVehicleStateDisplay(
    val live: Boolean,
    val signals: List<LiveSignal>,
)

/**
 * Pure projection from the optional security event to its render-ready [LiveVehicleStateDisplay] — a 1:1
 * port of the web `buildLiveSignals(latest, t)` plus the two render conditionals. A null event yields no
 * signals (empty state) and `live = false`; a present event yields all ten signals and `live = true`,
 * exactly like the web nullish handling.
 */
object LiveVehicleStateProjection {
    /** Select the render-ready view for the optional [latest] security event (web `latest` prop). */
    fun project(latest: SecurityEventLive?): LiveVehicleStateDisplay =
        if (latest == null) {
            LiveVehicleStateDisplay(live = false, signals = emptyList())
        } else {
            LiveVehicleStateDisplay(live = true, signals = buildSignals(latest))
        }

    /** Build all ten signals in the exact order the web `buildLiveSignals` emits them. */
    private fun buildSignals(ev: SecurityEventLive): List<LiveSignal> =
        listOf(
            boolSignal(LiveSignalKey.HAZARDS, ev.lightsHazardsActive),
            boolSignal(LiveSignalKey.HIGH_BEAMS, ev.lightsHighBeams),
            stringSignal(LiveSignalKey.TURN_SIGNAL, ev.lightsTurnSignal),
            driverSeat(ev.driverSeatOccupied),
            countSignal(LiveSignalKey.PAIRED_KEYS, ev.pairedPhoneKeyCount),
            boolSignal(LiveSignalKey.VALET_MODE, ev.valetModeEnabled),
            boolSignal(LiveSignalKey.SERVICE_MODE, ev.serviceMode),
            speedLimit(ev.speedLimitMode),
            countSignal(LiveSignalKey.HOMELINK_DEVICES, ev.homelinkDeviceCount),
            stringSignal(LiveSignalKey.CENTER_DISPLAY, ev.centerDisplay),
        )

    /** Web `boolLabel` + `active: !!val`: null → "—", true → "On", false → "Off". */
    private fun boolSignal(
        key: LiveSignalKey,
        value: Boolean?,
    ): LiveSignal = LiveSignal(key, boolValue(value), value == true)

    /**
     * Web string signal (`turnSignal`, `centerDisplay`): value is the non-empty string or "—", and it is
     * active when present and not an "off"-ish state.
     */
    private fun stringSignal(
        key: LiveSignalKey,
        raw: JsonElement?,
    ): LiveSignal {
        val text = nonEmptyString(raw)
        return LiveSignal(key, text?.let { SignalValue.Literal(it) } ?: SignalValue.Dash, isActiveText(text))
    }

    /** Web count signal (`pairedKeys`, `homelinkDevices`): `String(n)` or "—", active when `(n ?? 0) > 0`. */
    private fun countSignal(
        key: LiveSignalKey,
        count: Int?,
    ): LiveSignal = LiveSignal(key, count?.let { SignalValue.Literal(it.toString()) } ?: SignalValue.Dash, (count ?: 0) > 0)

    /** Web `driverSeat`: null → "—", true → "Occupied", false → "Empty"; active when occupied. */
    private fun driverSeat(occupied: Boolean?): LiveSignal {
        val value =
            when (occupied) {
                null -> SignalValue.Dash
                true -> SignalValue.Occupied
                false -> SignalValue.Empty
            }
        return LiveSignal(LiveSignalKey.DRIVER_SEAT, value, occupied == true)
    }

    /**
     * Web `speedLimit`: if the raw value is a boolean, render "On"/"Off" with `active = value`; otherwise
     * treat it as a string exactly like the other string signals.
     */
    private fun speedLimit(raw: JsonElement?): LiveSignal {
        val bool = booleanScalar(raw)
        return if (bool != null) {
            LiveSignal(LiveSignalKey.SPEED_LIMIT, if (bool) SignalValue.On else SignalValue.Off, bool)
        } else {
            val text = nonEmptyString(raw)
            LiveSignal(LiveSignalKey.SPEED_LIMIT, text?.let { SignalValue.Literal(it) } ?: SignalValue.Dash, isActiveText(text))
        }
    }

    private fun boolValue(value: Boolean?): SignalValue =
        when (value) {
            null -> SignalValue.Dash
            true -> SignalValue.On
            false -> SignalValue.Off
        }

    /** Web `!!s && !s.toLowerCase().includes('off')`. */
    private fun isActiveText(text: String?): Boolean = text != null && !text.lowercase().contains("off")

    /** Web `asNonEmptyString`: the value only when it is a non-empty JSON string; null otherwise. */
    private fun nonEmptyString(el: JsonElement?): String? {
        val primitive = el as? JsonPrimitive
        return if (primitive == null || !primitive.isString) null else primitive.content.takeIf { it.isNotEmpty() }
    }

    /** Web `typeof v === 'boolean'`: the value only when it is a JSON boolean (a quoted string is not). */
    private fun booleanScalar(el: JsonElement?): Boolean? {
        val primitive = el as? JsonPrimitive
        return if (primitive == null || primitive.isString) null else primitive.booleanOrNull
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any
 * security signal value — so a diagnostics line can never leak the vehicle's lock/valet/seat/key posture.
 */
object LiveVehicleStateDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveVehicleState"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
