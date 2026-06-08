package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The S7 data port for the per-vehicle settings surface — the cross-platform analogue of the web
 * `useVehicleSettings` hook domain (web/src/api/hooks/useVehicleSettings.ts). Every native
 * VehicleSettings screen (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * One read and two mutations, mirroring the three web primitives:
 *  - [vehicleSettings] — `GET /vehicles/{vehicleId}/settings`, the resolver's full per-key effective
 *    payload (web `useVehicleSettings`). Streams a cache-then-network [Resource] (ADR-013) cached
 *    under [vehicleSettingsCacheKey]. The resolver always returns the complete key whitelist, so the
 *    payload is a normal [Resource.Success] even when no overrides exist.
 *  - [upsertVehicleSetting] — `PUT /vehicles/{vehicleId}/settings/{key}` `{ value }`, the typed
 *    write (web `useUpsertVehicleSetting`). The arbitrary-JSON [value] is forwarded verbatim (the
 *    backend dispatches on the key's kind; a `mute_until` value MUST already be an RFC3339 string).
 *    On success the affected vehicle's [vehicleSettingsCacheKey] is evicted.
 *  - [resetVehicleSetting] — `DELETE /vehicles/{vehicleId}/settings/{key}`, the idempotent revert
 *    (web `useResetVehicleSetting`). The backend answers `204` even when no override row existed, so
 *    it is safe to call without pre-checking existence. On success the affected vehicle's
 *    [vehicleSettingsCacheKey] is evicted.
 *
 * The web read carries `staleTime: 30_000`, which the [io.teslasync.shared.core.cache.CacheDomain]
 * default TTL ([VEHICLE_SETTINGS_TTL_MILLIS]) matches verbatim. Both web mutations invalidate ONLY
 * this vehicle's `vehicleSettingsKeys.detail(id)` here; their SECOND invalidation
 * (`vehicleKeys.detail(id)`, because a nickname override feeds the vehicle's display name) is a
 * cross-domain concern handled by the S8 store's injected vehicle-refresh hook, not here. The S8
 * store re-collects the feed on the same success so it re-fetches rather than replaying a stale
 * entry. No field is unit-bearing, so payloads round-trip verbatim with no SI conversion.
 */
public interface VehicleSettingsRepository {
    /**
     * `GET /vehicles/{vehicleId}/settings` — the resolver's full per-key effective payload for
     * [vehicleId] (web `useVehicleSettings`). The cache key is built by [vehicleSettingsCacheKey],
     * mirroring the web `vehicleSettingsKeys.detail` tuple. Always resolves to a
     * [VehicleSettingsResponse] (the resolver returns the complete whitelist, never an error for
     * "no overrides").
     */
    public fun vehicleSettings(vehicleId: String): Flow<Resource<VehicleSettingsResponse>>

    /**
     * `PUT /vehicles/{vehicleId}/settings/{key}` `{ value }` — creates or updates a single setting
     * override (web `useUpsertVehicleSetting`). [value] is forwarded verbatim as arbitrary JSON (the
     * backend dispatches on the key's kind; a `mute_until` value MUST already be an RFC3339 string,
     * the caller's responsibility exactly as in the web). On success the affected vehicle's
     * [vehicleSettingsCacheKey] is evicted (the web `invalidateQueries(vehicleSettingsKeys
     * .detail(id))`).
     */
    public suspend fun upsertVehicleSetting(
        vehicleId: String,
        key: String,
        value: JsonElement,
    ): Result<Unit>

    /**
     * `DELETE /vehicles/{vehicleId}/settings/{key}` — reverts a single setting to its inherited
     * default (web `useResetVehicleSetting`). Idempotent on the backend (`204` even with no override
     * row). On success the affected vehicle's [vehicleSettingsCacheKey] is evicted (the web
     * `invalidateQueries(vehicleSettingsKeys.detail(id))`).
     */
    public suspend fun resetVehicleSetting(
        vehicleId: String,
        key: String,
    ): Result<Unit>
}

/**
 * Builds the stable cache/feed key for a vehicle's resolved settings payload, mirroring the web
 * `vehicleSettingsKeys.detail` tuple `['vehicle-settings', id]`. Prefixed with `vehicle-settings:` so
 * it partitions per vehicle within the one settings cache domain. Locked by golden vectors shared
 * with the C# port.
 */
public fun vehicleSettingsCacheKey(vehicleId: String): String = "vehicle-settings:$vehicleId"

/**
 * Builds the `PUT /vehicles/{vehicleId}/settings/{key}` body, mirroring the web
 * `JSON.stringify({ value })`: a single `value` key carrying the typed setting value verbatim,
 * matching the Go handler which dispatches on the key's kind. Locked by golden vectors shared with
 * the C# port.
 */
public fun upsertVehicleSettingBody(value: JsonElement): JsonObject =
    buildJsonObject {
        put("value", value)
    }

/**
 * Per-entity staleness threshold for the vehicle-settings read — the web `useVehicleSettings`
 * `staleTime` (`30_000`). Matches the [io.teslasync.shared.core.cache.CacheDomain.VehicleSettings]
 * default, so it is the domain window rather than a per-read override.
 */
public const val VEHICLE_SETTINGS_TTL_MILLIS: Long = 30_000L
