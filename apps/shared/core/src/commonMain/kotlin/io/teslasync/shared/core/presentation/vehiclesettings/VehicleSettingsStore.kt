package io.teslasync.shared.core.presentation.vehiclesettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSettingsRepository
import io.teslasync.shared.core.data.repo.vehicleSettingsCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the per-vehicle settings surface — the cross-platform port of the
 * web `useVehicleSettings` hook domain (web/src/api/hooks/useVehicleSettings.ts). Every native
 * VehicleSettings screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing the endpoint, the cache key, the upsert body shape, or the
 * per-vehicle invalidation rules.
 *
 * The one read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013), scoped
 * to one vehicle and lazily created on first access, then shared so every observer of the same
 * vehicle folds into one upstream collection:
 *  - [vehicleSettings] mirrors the web `useVehicleSettings(vehicleId)` — the resolver payload.
 *
 * The two mutations are non-throwing suspend [Result]s, mirroring the web mutations exactly:
 *  - [upsertVehicleSetting] mirrors `useUpsertVehicleSetting`: it forwards the typed [value] verbatim
 *    (the caller pre-formats a `mute_until` value as RFC3339, as in the web). On success it refreshes
 *    that vehicle's settings feed AND fires [onVehicleChanged] — the holder-side analogue of the web
 *    pairing `invalidateQueries(vehicleSettingsKeys.detail(id))` with
 *    `invalidateQueries(vehicleKeys.detail(id))` (the latter exists because a nickname override feeds
 *    the vehicle's display name across the app).
 *  - [resetVehicleSetting] mirrors `useResetVehicleSetting`: on success it refreshes that vehicle's
 *    settings feed AND fires [onVehicleChanged] (the web pairs the same two invalidations).
 *
 * A failed mutation refreshes nothing and fires nothing (the web `onSuccess` never runs on error).
 * The repository (S7) evicts the same key on the same success, so each refresh re-fetches rather than
 * replaying a stale entry. The cross-domain `vehicleKeys.detail(id)` invalidation is delegated to
 * [onVehicleChanged] (default no-op) so the settings holder stays decoupled from the vehicle-list
 * domain; the platform wires it to that feed's refresh. Toasts are a render-layer concern (web
 * `useMutationToast`) and are intentionally NOT reproduced here. The holder makes no network calls
 * itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed and both mutations are routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 * @property onVehicleChanged the holder-side analogue of the web `invalidateQueries(vehicleKeys
 *   .detail(id))` — invoked with the affected `vehicleId` after a successful upsert/reset so the
 *   platform can refresh that vehicle's own feed (its display name tracks the nickname override).
 *   Defaults to a no-op.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class VehicleSettingsStore(
    private val repo: VehicleSettingsRepository,
    private val scope: CoroutineScope,
    private val onVehicleChanged: (vehicleId: String) -> Unit = {},
) {
    private val settingsTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val settingsFeeds = mutableMapOf<String, StateFlow<Resource<VehicleSettingsResponse>>>()

    // ---- Read ---------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/settings` feed for [vehicleId] (web
     * `useVehicleSettings`). The same `vehicleId` always returns the same feed; bumping its trigger
     * (via [refreshSettingsFeed]) restarts its cache-then-network collection.
     */
    public fun vehicleSettings(vehicleId: String): StateFlow<Resource<VehicleSettingsResponse>> {
        val key = vehicleSettingsCacheKey(vehicleId)
        return settingsFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.vehicleSettings(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = SETTINGS_INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Creates or updates the override for [key] on [vehicleId], forwarding the typed [value] verbatim
     * (web `useUpsertVehicleSetting`). On success that vehicle's settings feed is refreshed and
     * [onVehicleChanged] fires; a failed upsert does neither.
     */
    public suspend fun upsertVehicleSetting(
        vehicleId: String,
        key: String,
        value: JsonElement,
    ): Result<Unit> =
        repo
            .upsertVehicleSetting(vehicleId, key, value)
            .onSuccess {
                refreshSettingsFeed(vehicleId)
                onVehicleChanged(vehicleId)
            }

    /**
     * Reverts [key] on [vehicleId] to its inherited default (web `useResetVehicleSetting`). On
     * success that vehicle's settings feed is refreshed and [onVehicleChanged] fires; a failed reset
     * does neither. Idempotent on the backend, so it is safe to call without pre-checking the
     * override's existence.
     */
    public suspend fun resetVehicleSetting(
        vehicleId: String,
        key: String,
    ): Result<Unit> =
        repo
            .resetVehicleSetting(vehicleId, key)
            .onSuccess {
                refreshSettingsFeed(vehicleId)
                onVehicleChanged(vehicleId)
            }

    // ---- Refresh (invalidation analogue) ------------------------------------------

    /**
     * Re-fetches the settings feed for [vehicleId] — the holder-side analogue of invalidating
     * `vehicleSettingsKeys.detail(id)`. Bumping the vehicle's trigger restarts its
     * cache-then-network collection. A vehicle nobody is observing is a no-op.
     */
    public fun refreshSettingsFeed(vehicleId: String) {
        settingsTriggers[vehicleSettingsCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = settingsTriggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val SETTINGS_INITIAL: Resource<VehicleSettingsResponse> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
