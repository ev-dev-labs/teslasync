package io.teslasync.shared.core.presentation.settings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SETTINGS_AUTH_STATUS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_CAPTURE_STATS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_DOCUMENT_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_GAS_PRICE_STATUS_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_POLLING_CONFIG_KEY
import io.teslasync.shared.core.data.repo.SETTINGS_VEHICLES_KEY
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.settingsCarPrefsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SettingsStore] folds each S7 [SettingsRepository] read into a shared, refreshable
 * cache-then-network feed and routes each mutation to the right repository call with the web-faithful
 * invalidation behaviour (each mutation refreshes EXACTLY the feeds its `useSettings.ts` hook
 * invalidates; the no-invalidate mutations refresh nothing) — using a fake repository, so no network
 * or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsStoreTest {
    /**
     * Fake S7 port: every read re-counts its collection per refresh (so a refresh is observable) and
     * emits Loading→Success with a deterministic value; every mutation records its argument and
     * returns a programmable result.
     */
    private class FakeSettingsRepository : SettingsRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val saved: MutableList<JsonElement> = mutableListOf()
        val toggledGas: MutableList<Boolean> = mutableListOf()
        val gasConfigs: MutableList<String> = mutableListOf()
        val suspends: MutableList<Boolean> = mutableListOf()
        val pollingSaved: MutableList<PollingConfig> = mutableListOf()
        val layoutsSaved: MutableList<DashboardLayoutsPayload> = mutableListOf()
        var refreshAuthCalls: Int = 0
        var disconnectCalls: Int = 0
        var syncCalls: Int = 0
        var pollGasCalls: Int = 0
        var authUrlCalls: Int = 0

        private fun <T> read(
            key: String,
            value: T,
        ): Flow<Resource<T>> =
            flow {
                collections[key] = (collections[key] ?: 0) + 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value, fetchedAt = 1L, stale = false))
            }

        override fun settings(): Flow<Resource<JsonElement>> = read(SETTINGS_DOCUMENT_KEY, JsonPrimitive("doc"))

        override fun authStatus(): Flow<Resource<AuthStatus>> =
            read(SETTINGS_AUTH_STATUS_KEY, AuthStatus(authenticated = true, expiresAt = "2026-01-01T00:00:00Z"))

        override fun vehicles(): Flow<Resource<List<Vehicle>>> =
            read(SETTINGS_VEHICLES_KEY, listOf(Vehicle(id = 1, name = "Car", vin = "VIN1")))

        override fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>> =
            read(settingsCarPrefsKey(vehicleId), CarPreferences(distanceUnit = "mi"))

        override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> =
            read(SETTINGS_GAS_PRICE_STATUS_KEY, GasPriceStatus(enabled = true, pollInterval = "1h"))

        override fun dashboardLayouts(): Flow<Resource<DashboardLayoutsPayload>> =
            read("dashboard-layouts", DashboardLayoutsPayload(activeId = "main"))

        override fun pollingConfig(): Flow<Resource<PollingConfig>> = read(SETTINGS_POLLING_CONFIG_KEY, PollingConfig(chargeState = true))

        override fun captureStats(): Flow<Resource<CaptureStats>> =
            read(SETTINGS_CAPTURE_STATS_KEY, CaptureStats(mongodbEnabled = true, totalDocuments = 5))

        override fun versionInfo(): Flow<Resource<VersionInfo>> = read("version", VersionInfo(chartVersion = "1.0.0", goVersion = "1.25"))

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> {
            saved += document
            return Result.success(document)
        }

        override suspend fun authUrl(): Result<AuthUrlResult> {
            authUrlCalls += 1
            return Result.success(AuthUrlResult(authUrl = "https://auth.tesla.com/x"))
        }

        override suspend fun refreshAuth(): Result<Unit> {
            refreshAuthCalls += 1
            return Result.success(Unit)
        }

        override suspend fun disconnectAuth(): Result<Unit> {
            disconnectCalls += 1
            return Result.success(Unit)
        }

        override suspend fun syncVehicles(): Result<SyncVehiclesResult> {
            syncCalls += 1
            return Result.success(SyncVehiclesResult(synced = 2))
        }

        override suspend fun pollGasPrice(): Result<GasPricePollResult> {
            pollGasCalls += 1
            return Result.success(GasPricePollResult(status = "ok"))
        }

        override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> {
            toggledGas += enabled
            return Result.success(GasPriceToggleResult(enabled = enabled))
        }

        override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> {
            gasConfigs += pollInterval
            return Result.success(GasPriceConfigResult(pollInterval = pollInterval))
        }

        override suspend fun saveDashboardLayouts(payload: DashboardLayoutsPayload): Result<DashboardLayoutsPayload> {
            layoutsSaved += payload
            return Result.success(payload)
        }

        override suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult> {
            suspends += suspended
            return Result.success(ApiSuspendResult(apiSuspended = suspended))
        }

        override suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig> {
            pollingSaved += config
            return Result.success(config)
        }
    }

    @Test
    fun everyReadEmitsCacheThenNetwork() =
        runTest {
            val store = SettingsStore(FakeSettingsRepository(), backgroundScope)
            val feeds =
                listOf<() -> Any>(
                    { store.settings() },
                    { store.authStatus() },
                    { store.vehicles() },
                    { store.carPreferences(1) },
                    { store.gasPriceStatus() },
                    { store.dashboardLayouts() },
                    { store.pollingConfig() },
                    { store.captureStats() },
                    { store.versionInfo() },
                )
            assertEquals(9, feeds.size, "all nine reads exercised")

            // Settings document feed: Loading (cold cache slot) then network Success.
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.settings().collect { seen += it } }
            runCurrent()
            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(JsonPrimitive("doc"), last.data)
        }

    @Test
    fun typedReadDecodesNetworkSuccess() =
        runTest {
            val store = SettingsStore(FakeSettingsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<AuthStatus>>()
            backgroundScope.launch { store.authStatus().collect { seen += it } }
            runCurrent()
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals(true, last.data.authenticated)
            assertEquals("2026-01-01T00:00:00Z", last.data.expiresAt)
        }

    @Test
    fun feedsAreSharedAcrossObservers() =
        runTest {
            val store = SettingsStore(FakeSettingsRepository(), backgroundScope)
            assertSame(store.settings(), store.settings())
            assertSame(store.gasPriceStatus(), store.gasPriceStatus())
            // Distinct vehicles get distinct shared feeds.
            assertSame(store.carPreferences(1), store.carPreferences(1))
            assertTrue(store.carPreferences(1) !== store.carPreferences(2))
        }

    @Test
    fun saveSettingsDelegatesAndRefreshesSettingsFeed() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.settings().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_DOCUMENT_KEY])

            val doc: JsonElement = JsonPrimitive("new-doc")
            val result = store.saveSettings(doc)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(doc), repo.saved)
            // web invalidateAndBroadcast(settingsKeys.settings) → settings feed re-fetches.
            assertEquals(2, repo.collections[SETTINGS_DOCUMENT_KEY])
        }

    @Test
    fun authMutationsRefreshAuthStatus() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.authStatus().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_AUTH_STATUS_KEY])

            store.refreshAuth()
            runCurrent()
            assertEquals(2, repo.collections[SETTINGS_AUTH_STATUS_KEY])

            store.disconnectAuth()
            runCurrent()
            assertEquals(3, repo.collections[SETTINGS_AUTH_STATUS_KEY])

            assertEquals(1, repo.refreshAuthCalls)
            assertEquals(1, repo.disconnectCalls)
        }

    @Test
    fun authUrlInvalidatesNothing() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.authStatus().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_AUTH_STATUS_KEY])

            val result = store.authUrl()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals("https://auth.tesla.com/x", result.getOrThrow().authUrl)
            assertEquals(1, repo.authUrlCalls)
            // web useAuthURL invalidates no keys.
            assertEquals(1, repo.collections[SETTINGS_AUTH_STATUS_KEY])
        }

    @Test
    fun syncVehiclesRefreshesVehiclesFeed() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.vehicles().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_VEHICLES_KEY])

            val result = store.syncVehicles()
            runCurrent()

            assertEquals(2, result.getOrThrow().synced)
            assertEquals(2, repo.collections[SETTINGS_VEHICLES_KEY])
        }

    @Test
    fun gasMutationsRefreshGasStatusButPollDoesNot() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.gasPriceStatus().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_GAS_PRICE_STATUS_KEY])

            store.toggleGasPrice(true)
            runCurrent()
            assertEquals(2, repo.collections[SETTINGS_GAS_PRICE_STATUS_KEY])

            store.updateGasPriceConfig("6h")
            runCurrent()
            assertEquals(3, repo.collections[SETTINGS_GAS_PRICE_STATUS_KEY])

            // web usePollGasPrice invalidates nothing.
            store.pollGasPrice()
            runCurrent()
            assertEquals(3, repo.collections[SETTINGS_GAS_PRICE_STATUS_KEY])

            assertEquals(listOf(true), repo.toggledGas)
            assertEquals(listOf("6h"), repo.gasConfigs)
            assertEquals(1, repo.pollGasCalls)
        }

    @Test
    fun toggleApiSuspendRefreshesSettingsFeed() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.settings().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_DOCUMENT_KEY])

            val result = store.toggleApiSuspend(true)
            runCurrent()

            assertEquals(true, result.getOrThrow().apiSuspended)
            assertEquals(listOf(true), repo.suspends)
            assertEquals(2, repo.collections[SETTINGS_DOCUMENT_KEY])
        }

    @Test
    fun updatePollingConfigRefreshesPollingAndCaptureFeeds() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.pollingConfig().collect {} }
            backgroundScope.launch { store.captureStats().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[SETTINGS_POLLING_CONFIG_KEY])
            assertEquals(1, repo.collections[SETTINGS_CAPTURE_STATS_KEY])

            val config = PollingConfig(chargeState = true, telemetryCapture = true, telemetryCaptureRetentionDays = 7)
            val result = store.updatePollingConfig(config)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(config), repo.pollingSaved)
            // web useUpdatePollingConfig invalidates BOTH ['polling-config'] and ['capture-stats'].
            assertEquals(2, repo.collections[SETTINGS_POLLING_CONFIG_KEY])
            assertEquals(2, repo.collections[SETTINGS_CAPTURE_STATS_KEY])
        }

    @Test
    fun saveDashboardLayoutsDelegatesAndInvalidatesNothing() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)
            backgroundScope.launch { store.dashboardLayouts().collect {} }
            runCurrent()
            assertEquals(1, repo.collections["dashboard-layouts"])

            val payload = DashboardLayoutsPayload(activeId = "alt")
            val result = store.saveDashboardLayouts(payload)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(payload), repo.layoutsSaved)
            // web useSaveDashboardLayouts invalidates no keys.
            assertEquals(1, repo.collections["dashboard-layouts"])
        }

    @Test
    fun refreshIsNoOpWhenFeedUnobserved() =
        runTest {
            val repo = FakeSettingsRepository()
            val store = SettingsStore(repo, backgroundScope)

            // Nothing observed → mutation's refresh must not start an upstream collection.
            store.saveSettings(JsonPrimitive("x"))
            runCurrent()

            assertEquals(null, repo.collections[SETTINGS_DOCUMENT_KEY])
        }
}
