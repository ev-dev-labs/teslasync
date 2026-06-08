package io.teslasync.shared.core.presentation.vehiclesettings

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The layer that produced an [EffectiveSetting]'s value — the cross-platform port of the web
 * `EffectiveSettingSource` union (web/src/api/types.ts: `'override' | 'user' | 'vehicle' |
 * 'default'`). The resolver tags every row with the discriminator so a consumer can render a
 * "source" pill exactly as the web `VehicleSettingsTab` does. The wire string is matched verbatim via
 * [SerialName] (the closed backend `EffectiveSettingSource` enum in
 * `internal/database/vehicle_settings_repo.go`), so the KMP core and the Windows C# port decode the
 * identical set (ADR-004).
 */
@Serializable
public enum class EffectiveSettingSource {
    @SerialName("override")
    OVERRIDE,

    @SerialName("user")
    USER,

    @SerialName("vehicle")
    VEHICLE,

    @SerialName("default")
    DEFAULT,
}

/**
 * One resolved per-vehicle setting row — the cross-platform port of the web `EffectiveSetting`
 * interface (web/src/api/types.ts). The resolver always fills [value] (never null) and always returns
 * the complete key whitelist, so a consumer renders every row without presence checks.
 *
 * [value] is carried as a raw [JsonElement] (the web `unknown`) because the typed shape depends on
 * the key's kind (a string nickname, a numeric threshold, a boolean toggle, or an RFC3339
 * `mute_until` stamp); the render boundary dispatches on the key. No field is unit-bearing, so the
 * row round-trips verbatim with no SI conversion. Keys arrive snake_case and are matched verbatim via
 * [SerialName].
 *
 * @property key the setting's stable identifier (the resolver whitelist key).
 * @property value the resolved typed value, carried verbatim as arbitrary JSON.
 * @property source the layer that produced [value], rendered as the "source" pill.
 */
@Serializable
public data class EffectiveSetting(
    @SerialName("key") val key: String,
    @SerialName("value") val value: JsonElement,
    @SerialName("source") val source: EffectiveSettingSource,
)

/**
 * The envelope returned by `GET /vehicles/{vehicleID}/settings` — the cross-platform port of the web
 * `VehicleSettingsResponse` interface (web/src/api/types.ts). [settings] defaults to an empty list so
 * a malformed/absent payload decodes cleanly and a consumer can iterate without a null guard.
 *
 * @property settings every resolved per-vehicle setting row, one per supported key.
 */
@Serializable
public data class VehicleSettingsResponse(
    @SerialName("settings") val settings: List<EffectiveSetting> = emptyList(),
)

/**
 * Pulls a single key's effective row out of the resolver payload — the cross-platform port of the web
 * `findEffectiveSetting` selector (web/src/api/hooks/useVehicleSettings.ts). Returns the entire
 * [EffectiveSetting] (so a caller can also inspect [EffectiveSetting.source]) or `null` when the key
 * is absent or [payload] is `null`, mirroring the web `payload?.settings?.find(...)` exactly. Locked
 * by golden vectors shared with the C# port.
 *
 * @param payload the resolver response, or `null` before the first load.
 * @param key the setting key to look up.
 */
public fun findEffectiveSetting(
    payload: VehicleSettingsResponse?,
    key: String,
): EffectiveSetting? = payload?.settings?.firstOrNull { it.key == key }
