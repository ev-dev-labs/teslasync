// The data port the VehicleSettingsTab surface binds to (P1/S8 state-holder seam) — the native analogue of
// the three web hooks the section composes: `useVehicleSettings` (the resolver payload read),
// `useUpsertVehicleSetting` (the typed override write), and `useResetVehicleSetting` (the revert-to-default
// delete) (web/src/api/hooks/useVehicleSettings.ts). The view never performs HTTP; a concrete adapter over
// the shared S8 [VehicleSettingsStore] drives this seam in production (a test fake drives it in unit tests),
// so the surface depends on the real shared store end to end without re-implementing the endpoint, the cache
// key, the upsert body shape, or the per-vehicle invalidation rules. Bound to a single vehicle id so the
// view + view-model never repeat it; the shared store keys every feed + mutation by that id.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleSettingsTab) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `VehicleSettingsTab*` filename cannot match the
// surface's `VehicleSettingsTabSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.vehiclesettingstab

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The per-vehicle settings data seam the section binds to — the native analogue of the web hook
 * composition, scoped to one vehicle. A concrete adapter over the shared S8 [VehicleSettingsStore] (or a
 * test fake) drives it; the view performs no HTTP.
 */
interface VehicleSettingsTabSource {
    /** Cache-then-network `GET /vehicles/{id}/settings` resolver feed (web `useVehicleSettings`). */
    fun settings(): Flow<Resource<VehicleSettingsResponse>>

    /**
     * `PUT /vehicles/{id}/settings/{key}` `{ value }` — creates or updates a single override (web
     * `useUpsertVehicleSetting`). [value] is forwarded verbatim (a `mute_until` value MUST already be an
     * RFC3339 string, the caller's responsibility exactly as in the web). Non-throwing [Result].
     */
    suspend fun upsert(
        key: String,
        value: JsonElement,
    ): Result<Unit>

    /**
     * `DELETE /vehicles/{id}/settings/{key}` — reverts a single setting to its inherited default (web
     * `useResetVehicleSetting`). Idempotent on the backend. Non-throwing [Result].
     */
    suspend fun reset(key: String): Result<Unit>
}

/**
 * Binds the section to the shared **S8** [VehicleSettingsStore] for [vehicleId] — the memoized,
 * multi-observer feed every VehicleSettings surface shares. Both mutations route through the store so a
 * success refreshes that vehicle's settings feed (and fires the store's cross-domain vehicle-refresh hook),
 * which re-emits into the section automatically — the holder-side analogue of the web
 * `invalidateQueries(vehicleSettingsKeys.detail(id))`. No HTTP touches the view.
 */
fun VehicleSettingsStore.asVehicleSettingsTabSource(vehicleId: String): VehicleSettingsTabSource {
    val store = this
    return object : VehicleSettingsTabSource {
        override fun settings(): Flow<Resource<VehicleSettingsResponse>> = store.vehicleSettings(vehicleId)

        override suspend fun upsert(
            key: String,
            value: JsonElement,
        ): Result<Unit> = store.upsertVehicleSetting(vehicleId, key, value)

        override suspend fun reset(key: String): Result<Unit> = store.resetVehicleSetting(vehicleId, key)
    }
}
