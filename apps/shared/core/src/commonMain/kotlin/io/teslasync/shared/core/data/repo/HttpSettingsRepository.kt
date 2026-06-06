package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
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
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [SettingsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Settings] partition, keyed by a stable
 * per-feed string ([SETTINGS_DOCUMENT_KEY] etc.) that mirrors the web TanStack query keys.
 *
 * Because the domain has nine distinct read shapes with a SPREAD of web `staleTime`s, the cache
 * layer stores each feed's raw [JsonElement] (the same verbatim-SI strategy as the Admin/Automations
 * ports) via [CachingRepository] of [JsonElement], and each read decodes that element to its typed
 * model on every emission through [decode] (the settings document is itself a [JsonElement], so it is
 * served undecoded). Each read overrides the domain-default TTL with its own web-faithful
 * [entryTtlMillis] so a feed flags staleness exactly when the web hook would. A typed decode failure
 * on the fresh value surfaces as [Resource.Error] (never a thrown exception that would cancel the
 * flow before the next refresh); a failure decoding a cached value degrades that slot to `null` so a
 * schema-drifted cache can never brick the network reload.
 *
 * The eleven mutations call the API directly and return a non-throwing [Result]. They do NOT evict
 * the durable cache: the cache-then-network operator re-fetches when the S8 store bumps the affected
 * feed's trigger (the `invalidateQueries` analogue), so the previous rows stay visible during the
 * reload — exactly the web behaviour of keeping prior data while a refetch is in flight — and no
 * stale value is ever served as fresh. Bodies are serialized to exact JSON bytes via [TextContent]
 * for byte-for-byte parity with the web `JSON.stringify` payloads; the full-replace `/settings`,
 * `/settings/dashboard-layouts`, and `/settings/polling-config` PUTs submit the whole document.
 */
public class HttpSettingsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    SettingsRepository {
    override val domain: CacheDomain = CacheDomain.Settings

    // ---- Reads --------------------------------------------------------------------

    override fun settings(): Flow<Resource<JsonElement>> =
        observe(SETTINGS_DOCUMENT_KEY, STALE_DEFAULT_MILLIS) { api.request<JsonElement>(path = "/settings") }

    override fun authStatus(): Flow<Resource<AuthStatus>> =
        observe(SETTINGS_AUTH_STATUS_KEY, STALE_DEFAULT_MILLIS) { api.request<JsonElement>(path = "/auth/status") }
            .decode(AuthStatus.serializer())

    override fun vehicles(): Flow<Resource<List<Vehicle>>> =
        observe(SETTINGS_VEHICLES_KEY, STALE_DEFAULT_MILLIS) { safeArray(api.request<JsonElement>(path = "/vehicles")) }
            .decode(ListSerializer(Vehicle.serializer()))

    override fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>> =
        observe(settingsCarPrefsKey(vehicleId), STALE_DEFAULT_MILLIS) {
            api.request<JsonElement>(path = "/user-preferences/latest", query = carPreferencesQuery(vehicleId))
        }.decode(CarPreferences.serializer())

    override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> =
        observe(SETTINGS_GAS_PRICE_STATUS_KEY, STALE_DEFAULT_MILLIS) { api.request<JsonElement>(path = "/gas-price/status") }
            .decode(GasPriceStatus.serializer())

    override fun dashboardLayouts(): Flow<Resource<DashboardLayoutsPayload>> =
        observe(SETTINGS_DASHBOARD_LAYOUTS_KEY, STALE_SLOW_MILLIS) {
            api.request<JsonElement>(path = "/settings/dashboard-layouts")
        }.decode(DashboardLayoutsPayload.serializer())

    override fun pollingConfig(): Flow<Resource<PollingConfig>> =
        observe(SETTINGS_POLLING_CONFIG_KEY, STALE_SLOW_MILLIS) {
            api.request<JsonElement>(path = "/settings/polling-config")
        }.decode(PollingConfig.serializer())

    override fun captureStats(): Flow<Resource<CaptureStats>> =
        observe(SETTINGS_CAPTURE_STATS_KEY, STALE_FAST_MILLIS) {
            api.request<JsonElement>(path = "/dev-tools/telemetry-capture/stats")
        }.decode(CaptureStats.serializer())

    override fun versionInfo(): Flow<Resource<VersionInfo>> =
        observe(SETTINGS_VERSION_KEY, STALE_STANDARD_MILLIS) { api.request<JsonElement>(path = "/system/version") }
            .decode(VersionInfo.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun saveSettings(document: JsonElement): Result<JsonElement> =
        api.safeRequest<JsonElement>(method = HttpMethodKind.PUT, path = "/settings", body = elementBody(document))

    override suspend fun authUrl(): Result<AuthUrlResult> = api.safeRequest<AuthUrlResult>(method = HttpMethodKind.POST, path = "/auth/url")

    override suspend fun refreshAuth(): Result<Unit> =
        // The server answers 2xx with an empty/irrelevant body; read it as raw text and discard so
        // an empty payload never triggers a spurious decode failure.
        api.safeRequest<String>(method = HttpMethodKind.POST, path = "/auth/refresh").map { }

    override suspend fun disconnectAuth(): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.POST, path = "/auth/disconnect").map { }

    override suspend fun syncVehicles(): Result<SyncVehiclesResult> =
        api.safeRequest<SyncVehiclesResult>(method = HttpMethodKind.POST, path = "/vehicles/sync")

    override suspend fun pollGasPrice(): Result<GasPricePollResult> =
        api.safeRequest<GasPricePollResult>(method = HttpMethodKind.POST, path = "/gas-price/poll")

    override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> =
        api.safeRequest<GasPriceToggleResult>(
            method = HttpMethodKind.POST,
            path = "/gas-price/toggle",
            body = jsonBody(gasPriceToggleBody(enabled)),
        )

    override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> =
        api.safeRequest<GasPriceConfigResult>(
            method = HttpMethodKind.PUT,
            path = "/gas-price/config",
            body = jsonBody(gasPriceConfigBody(pollInterval)),
        )

    override suspend fun saveDashboardLayouts(payload: DashboardLayoutsPayload): Result<DashboardLayoutsPayload> =
        api.safeRequest<DashboardLayoutsPayload>(
            method = HttpMethodKind.PUT,
            path = "/settings/dashboard-layouts",
            body =
                TextContent(
                    json.encodeToString(DashboardLayoutsPayload.serializer(), payload),
                    ContentType.Application.Json,
                ),
        )

    override suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult> =
        api.safeRequest<ApiSuspendResult>(
            method = HttpMethodKind.POST,
            path = "/settings/suspend-api",
            body = jsonBody(apiSuspendBody(suspended)),
        )

    override suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig> =
        api.safeRequest<PollingConfig>(
            method = HttpMethodKind.PUT,
            path = "/settings/polling-config",
            body = TextContent(json.encodeToString(PollingConfig.serializer(), config), ContentType.Application.Json),
        )

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    /**
     * Wraps a raw settings [JsonElement] document as its exact JSON bytes — the full-replace
     * `/settings` PUT submits the document verbatim, byte-for-byte with the web `JSON.stringify`.
     */
    private fun elementBody(element: JsonElement): TextContent = TextContent(element.toString(), ContentType.Application.Json)

    private companion object {
        // Web `staleTime` → per-read freshness threshold (web/src/lib/constants.ts STALE_TIMES).
        // The default-staleTime (0) reads flag their cached cold-start emission stale immediately,
        // exactly as the web treats a default query as stale on mount.
        const val STALE_DEFAULT_MILLIS = 0L

        // STALE_TIMES.FAST (30s) — capture-stats.
        const val STALE_FAST_MILLIS = 30_000L

        // STALE_TIMES.STANDARD (60s) — version info.
        const val STALE_STANDARD_MILLIS = 60_000L

        // STALE_TIMES.SLOW (5 min) — dashboard-layouts, polling-config.
        const val STALE_SLOW_MILLIS = 300_000L
    }
}
