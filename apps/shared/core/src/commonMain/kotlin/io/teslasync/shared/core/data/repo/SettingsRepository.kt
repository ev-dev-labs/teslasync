package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.settings.ApiSuspendResult
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.AuthUrlResult
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.CarPreferences
import io.teslasync.shared.core.presentation.settings.DashboardLayoutsPayload
import io.teslasync.shared.core.presentation.settings.GasPriceConfigResult
import io.teslasync.shared.core.presentation.settings.GasPricePollResult
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import io.teslasync.shared.core.presentation.settings.GasPriceToggleResult
import io.teslasync.shared.core.presentation.settings.PollingConfig
import io.teslasync.shared.core.presentation.settings.SyncVehiclesResult
import io.teslasync.shared.core.presentation.settings.Vehicle
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The S7 data port for the Settings page — the cross-platform analogue of the web `useSettings`
 * hook domain (web/src/api/hooks/useSettings.ts). Every native Settings surface (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The nine reads each stream a cache-then-network [Resource] (ADR-013): the cached value first for
 * an instant cold start, then the refreshed value, cached under a per-feed key that mirrors the web
 * TanStack query key. They share the single [io.teslasync.shared.core.cache.CacheDomain.Settings]
 * partition (so logout clears all of them in one call) but each flags staleness on its OWN
 * web-faithful threshold via the per-read TTL — the web hooks declare a spread of `staleTime`s
 * (default-0, `STALE_TIMES.FAST`/`STANDARD`/`SLOW`), and a single domain window cannot honour them
 * all. The settings document shares the `settings` key with the AiSettings save path (the web
 * `settingsKeys.settings`).
 *
 * The eleven mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache (the cache-then-network operator re-fetches when the S8 store bumps the
 * affected feed's trigger — the `invalidateQueries` analogue — so prior rows stay visible during the
 * reload, exactly the web behaviour of keeping previous data while a refetch is in flight, and no
 * stale value is ever served as fresh). Which feeds each mutation refreshes is an S8 concern that
 * mirrors the web hook's `invalidateAndBroadcast`/`invalidateQueries` calls.
 *
 * The web hooks' `staleTime`/`refetchInterval` poll cadence, `retry` counts, and the
 * `enabled: vehicleId !== null` lazy gate on car-preferences are render-layer concerns and are
 * intentionally NOT reproduced at this layer; a platform pull-to-refresh / live-poll cadence drives
 * re-collection. Values are SI/raw on the wire and round-trip verbatim (no unit-bearing telemetry
 * fields here); display formatting is the render boundary's job (S5).
 */
public interface SettingsRepository {
    // ---- Reads --------------------------------------------------------------------

    /** `GET /settings` — the full app-settings document, raw [JsonElement] (web `useSettings`). */
    public fun settings(): Flow<Resource<JsonElement>>

    /** `GET /auth/status` → [AuthStatus] (web `useAuthStatus`). */
    public fun authStatus(): Flow<Resource<AuthStatus>>

    /** `GET /vehicles` → [Vehicle] list, `safeArray`-guarded (web `useVehicles`). */
    public fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * `GET /user-preferences/latest?vehicle_id={vehicleId}` → [CarPreferences] (web
     * `useCarPreferences`). The web hook is `enabled` only when the vehicle id is non-null; that
     * lazy gate is a render-layer concern, so this port takes a concrete [vehicleId].
     */
    public fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>>

    /** `GET /gas-price/status` → [GasPriceStatus] (web `useGasPriceStatus`). */
    public fun gasPriceStatus(): Flow<Resource<GasPriceStatus>>

    /** `GET /settings/dashboard-layouts` → [DashboardLayoutsPayload] (web `useDashboardLayouts`). */
    public fun dashboardLayouts(): Flow<Resource<DashboardLayoutsPayload>>

    /** `GET /settings/polling-config` → [PollingConfig] (web `usePollingConfig`). */
    public fun pollingConfig(): Flow<Resource<PollingConfig>>

    /** `GET /dev-tools/telemetry-capture/stats` → [CaptureStats] (web `useCaptureStats`). */
    public fun captureStats(): Flow<Resource<CaptureStats>>

    /** `GET /system/version` → [VersionInfo] (web `useVersionInfo`). */
    public fun versionInfo(): Flow<Resource<VersionInfo>>

    // ---- Mutations ----------------------------------------------------------------

    /**
     * `PUT /settings` with the full settings [document] (web `useSaveSettings`). `/settings` is
     * full-replace, so the verbatim document bytes are submitted unchanged. The S8 store refreshes
     * the `settings` feed on success (the web `invalidateAndBroadcast(settingsKeys.settings)`).
     */
    public suspend fun saveSettings(document: JsonElement): Result<JsonElement>

    /** `POST /auth/url` → [AuthUrlResult] (web `useAuthURL`). Invalidates nothing. */
    public suspend fun authUrl(): Result<AuthUrlResult>

    /** `POST /auth/refresh` (web `useRefreshAuth`). The S8 store refreshes `auth-status` on success. */
    public suspend fun refreshAuth(): Result<Unit>

    /** `POST /auth/disconnect` (web `useDisconnectAuth`). The S8 store refreshes `auth-status` on success. */
    public suspend fun disconnectAuth(): Result<Unit>

    /** `POST /vehicles/sync` → [SyncVehiclesResult] (web `useSyncVehicles`). Store refreshes `vehicles`. */
    public suspend fun syncVehicles(): Result<SyncVehiclesResult>

    /** `POST /gas-price/poll` → [GasPricePollResult] (web `usePollGasPrice`). Invalidates nothing. */
    public suspend fun pollGasPrice(): Result<GasPricePollResult>

    /**
     * `POST /gas-price/toggle` with `{ enabled }` → [GasPriceToggleResult] (web `useToggleGasPrice`).
     * The S8 store refreshes `gas-price-status` on success.
     */
    public suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult>

    /**
     * `PUT /gas-price/config` with `{ poll_interval }` → [GasPriceConfigResult] (web
     * `useUpdateGasPriceConfig`). The S8 store refreshes `gas-price-status` on success.
     */
    public suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult>

    /**
     * `PUT /settings/dashboard-layouts` with the full [payload] → [DashboardLayoutsPayload] (web
     * `useSaveDashboardLayouts`). Invalidates nothing (the web mutation invalidates no keys).
     */
    public suspend fun saveDashboardLayouts(payload: DashboardLayoutsPayload): Result<DashboardLayoutsPayload>

    /**
     * `POST /settings/suspend-api` with `{ suspended }` → [ApiSuspendResult] (web `useToggleAPISuspend`).
     * The S8 store refreshes `settings` on success (the web `invalidateAndBroadcast(settingsKeys.settings)`).
     */
    public suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult>

    /**
     * `PUT /settings/polling-config` with the full [config] → [PollingConfig] (web
     * `useUpdatePollingConfig`). The S8 store refreshes `polling-config` AND `capture-stats` on
     * success (the web mutation invalidates both `['polling-config']` and `['capture-stats']`).
     */
    public suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig>
}

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** Cache/feed key for the app-settings document — web `settingsKeys.settings` (`['settings']`). */
public const val SETTINGS_DOCUMENT_KEY: String = "settings"

/** Cache/feed key for `GET /auth/status` — web `settingsKeys.authStatus` (`['auth-status']`). */
public const val SETTINGS_AUTH_STATUS_KEY: String = "auth-status"

/** Cache/feed key for `GET /vehicles` — web `settingsKeys.vehicles` (`['vehicles']`). */
public const val SETTINGS_VEHICLES_KEY: String = "vehicles"

/** Cache/feed key for `GET /gas-price/status` — web `settingsKeys.gasPriceStatus` (`['gas-price-status']`). */
public const val SETTINGS_GAS_PRICE_STATUS_KEY: String = "gas-price-status"

/** Cache/feed key for `GET /settings/dashboard-layouts` — web `settingsKeys.dashboardLayouts`. */
public const val SETTINGS_DASHBOARD_LAYOUTS_KEY: String = "dashboard-layouts"

/** Cache/feed key for `GET /settings/polling-config` — web `['polling-config']`. */
public const val SETTINGS_POLLING_CONFIG_KEY: String = "polling-config"

/** Cache/feed key for `GET /dev-tools/telemetry-capture/stats` — web `['capture-stats']`. */
public const val SETTINGS_CAPTURE_STATS_KEY: String = "capture-stats"

/** Cache/feed key for `GET /system/version` — web `['version']`. */
public const val SETTINGS_VERSION_KEY: String = "version"

/**
 * Cache/feed key for `GET /user-preferences/latest` — the port of the web
 * `settingsKeys.carPrefs(vehicleId)` (`['car-prefs', vehicleId]`). Per-vehicle so each car's
 * preferences cache independently.
 */
public fun settingsCarPrefsKey(vehicleId: Long): String = "car-prefs:$vehicleId"

// ---- Request builders (web param/body semantics; golden-pinned) --------------------

/**
 * The `/user-preferences/latest` query — the port of the web hook's template
 * `?vehicle_id=${vehicleId}`. A single unconditional snake_case `vehicle_id` param. A pure function
 * of its input, locked by golden vectors so the C# and KMP ports cannot drift (ADR-004).
 */
public fun carPreferencesQuery(vehicleId: Long): Map<String, String> = linkedMapOf("vehicle_id" to vehicleId.toString())

/**
 * The `POST /gas-price/toggle` body — the port of the web `JSON.stringify({ enabled })`. A pure
 * function of its input, locked by golden vectors (ADR-004).
 */
public fun gasPriceToggleBody(enabled: Boolean): JsonObject = JsonObject(mapOf("enabled" to JsonPrimitive(enabled)))

/**
 * The `PUT /gas-price/config` body — the port of the web `JSON.stringify({ poll_interval })`
 * (snake_case wire key). A pure function of its input, locked by golden vectors (ADR-004).
 */
public fun gasPriceConfigBody(pollInterval: String): JsonObject = JsonObject(mapOf("poll_interval" to JsonPrimitive(pollInterval)))

/**
 * The `POST /settings/suspend-api` body — the port of the web `JSON.stringify({ suspended })`. A
 * pure function of its input, locked by golden vectors (ADR-004).
 */
public fun apiSuspendBody(suspended: Boolean): JsonObject = JsonObject(mapOf("suspended" to JsonPrimitive(suspended)))
