package io.teslasync.shared.core.presentation.settings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SETTINGS_AUTH_STATUS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_CAPTURE_STATS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_DASHBOARD_LAYOUTS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_DOCUMENT_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_GAS_PRICE_STATUS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_POLLING_CONFIG_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_VEHICLES_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_VERSION_KEY
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.settingsCarPrefsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the Settings page — the cross-platform port of the web
 * `useSettings` hook domain (web/src/api/hooks/useSettings.ts). Every native Settings screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, or invalidation rules.
 *
 * The nine reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * is lazily created on first access, shared so every observer of the same `(feed[, vehicleId])` folds
 * into one upstream collection, and refreshable. The eleven mutations are non-throwing suspend
 * [Result]s; on success each refreshes EXACTLY the feeds the matching web hook invalidates via
 * `invalidateAndBroadcast`/`invalidateQueries`:
 *  - saveSettings / toggleApiSuspend       → the settings document feed;
 *  - refreshAuth / disconnectAuth          → the auth-status feed;
 *  - syncVehicles                          → the vehicles feed;
 *  - toggleGasPrice / updateGasPriceConfig → the gas-price-status feed;
 *  - updatePollingConfig                   → the polling-config feed + the capture-stats feed;
 *  - authUrl / pollGasPrice / saveDashboardLayouts → invalidate NOTHING (the web mutations do too).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached value first (the web behaviour of keeping prior data during a refetch). A feed nobody
 * is observing is a no-op to refresh. The holder makes no network calls itself — it delegates
 * entirely to the injected [SettingsRepository] (S7).
 *
 * Optimistic UI, the web `staleTime`/`refetchInterval` poll cadence, `retry` counts, the
 * `enabled: vehicleId !== null` lazy gate on car-preferences, and toasts are render-layer concerns
 * and are intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage
 * and is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SettingsStore(
    private val repo: SettingsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /settings` document feed (web `useSettings`). */
    public fun settings(): StateFlow<Resource<JsonElement>> = feed(SETTINGS_DOCUMENT_KEY) { repo.settings() }

    /** Shared, refreshable `GET /auth/status` feed (web `useAuthStatus`). */
    public fun authStatus(): StateFlow<Resource<AuthStatus>> = feed(SETTINGS_AUTH_STATUS_KEY) { repo.authStatus() }

    /** Shared, refreshable `GET /vehicles` feed (web `useVehicles`). */
    public fun vehicles(): StateFlow<Resource<List<Vehicle>>> = feed(SETTINGS_VEHICLES_KEY) { repo.vehicles() }

    /** Shared, refreshable per-vehicle `GET /user-preferences/latest` feed (web `useCarPreferences`). */
    public fun carPreferences(vehicleId: Long): StateFlow<Resource<CarPreferences>> =
        feed(settingsCarPrefsKey(vehicleId)) { repo.carPreferences(vehicleId) }

    /** Shared, refreshable `GET /gas-price/status` feed (web `useGasPriceStatus`). */
    public fun gasPriceStatus(): StateFlow<Resource<GasPriceStatus>> = feed(SETTINGS_GAS_PRICE_STATUS_KEY) { repo.gasPriceStatus() }

    /** Shared, refreshable `GET /settings/dashboard-layouts` feed (web `useDashboardLayouts`). */
    public fun dashboardLayouts(): StateFlow<Resource<DashboardLayoutsPayload>> =
        feed(SETTINGS_DASHBOARD_LAYOUTS_KEY) { repo.dashboardLayouts() }

    /** Shared, refreshable `GET /settings/polling-config` feed (web `usePollingConfig`). */
    public fun pollingConfig(): StateFlow<Resource<PollingConfig>> = feed(SETTINGS_POLLING_CONFIG_KEY) { repo.pollingConfig() }

    /** Shared, refreshable `GET /dev-tools/telemetry-capture/stats` feed (web `useCaptureStats`). */
    public fun captureStats(): StateFlow<Resource<CaptureStats>> = feed(SETTINGS_CAPTURE_STATS_KEY) { repo.captureStats() }

    /** Shared, refreshable `GET /system/version` feed (web `useVersionInfo`). */
    public fun versionInfo(): StateFlow<Resource<VersionInfo>> = feed(SETTINGS_VERSION_KEY) { repo.versionInfo() }

    // ---- Mutations ----------------------------------------------------------------

    /** Saves the full settings document, then refreshes the settings feed (web `useSaveSettings`). */
    public suspend fun saveSettings(document: JsonElement): Result<JsonElement> =
        repo.saveSettings(document).onSuccess { refresh(SETTINGS_DOCUMENT_KEY) }

    /** Requests a Tesla OAuth URL (web `useAuthURL`). Invalidates nothing. */
    public suspend fun authUrl(): Result<AuthUrlResult> = repo.authUrl()

    /** Refreshes the Fleet token, then refreshes the auth-status feed (web `useRefreshAuth`). */
    public suspend fun refreshAuth(): Result<Unit> = repo.refreshAuth().onSuccess { refresh(SETTINGS_AUTH_STATUS_KEY) }

    /** Disconnects the Tesla account, then refreshes the auth-status feed (web `useDisconnectAuth`). */
    public suspend fun disconnectAuth(): Result<Unit> = repo.disconnectAuth().onSuccess { refresh(SETTINGS_AUTH_STATUS_KEY) }

    /** Re-syncs vehicles, then refreshes the vehicles feed (web `useSyncVehicles`). */
    public suspend fun syncVehicles(): Result<SyncVehiclesResult> = repo.syncVehicles().onSuccess { refresh(SETTINGS_VEHICLES_KEY) }

    /** Triggers a gas-price poll (web `usePollGasPrice`). Invalidates nothing. */
    public suspend fun pollGasPrice(): Result<GasPricePollResult> = repo.pollGasPrice()

    /** Toggles gas-price tracking, then refreshes the gas-price-status feed (web `useToggleGasPrice`). */
    public suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> =
        repo.toggleGasPrice(enabled).onSuccess { refresh(SETTINGS_GAS_PRICE_STATUS_KEY) }

    /**
     * Updates the gas-price poll interval, then refreshes the gas-price-status feed (web
     * `useUpdateGasPriceConfig`).
     */
    public suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> =
        repo.updateGasPriceConfig(pollInterval).onSuccess { refresh(SETTINGS_GAS_PRICE_STATUS_KEY) }

    /** Saves the dashboard-layouts payload (web `useSaveDashboardLayouts`). Invalidates nothing. */
    public suspend fun saveDashboardLayouts(payload: DashboardLayoutsPayload): Result<DashboardLayoutsPayload> =
        repo.saveDashboardLayouts(payload)

    /** Toggles Fleet-API suspension, then refreshes the settings feed (web `useToggleAPISuspend`). */
    public suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult> =
        repo.toggleApiSuspend(suspended).onSuccess { refresh(SETTINGS_DOCUMENT_KEY) }

    /**
     * Saves the polling config, then refreshes the polling-config AND capture-stats feeds (web
     * `useUpdatePollingConfig`, which invalidates both `['polling-config']` and `['capture-stats']`).
     */
    public suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig> =
        repo.updatePollingConfig(config).onSuccess {
            refresh(SETTINGS_POLLING_CONFIG_KEY)
            refresh(SETTINGS_CAPTURE_STATS_KEY)
        }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active. The per-key
     * value type is invariant for a given [key] (each key has exactly one source shape), so the
     * unchecked cast on return is safe.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        } as StateFlow<Resource<T>>

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
