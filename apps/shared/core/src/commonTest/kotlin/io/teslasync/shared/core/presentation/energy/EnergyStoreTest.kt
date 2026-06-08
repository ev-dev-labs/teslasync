package io.teslasync.shared.core.presentation.energy

import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.batteryCellsKey
import io.teslasync.shared.core.data.repo.batteryHealthKey
import io.teslasync.shared.core.data.repo.energyStatsKey
import io.teslasync.shared.core.data.repo.sleepEfficiencyKey
import io.teslasync.shared.core.data.repo.teslaBackupHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergyHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergySitesKey
import io.teslasync.shared.core.data.repo.teslaLiveStatusHistoryKey
import io.teslasync.shared.core.data.repo.teslaLiveStatusKey
import io.teslasync.shared.core.data.repo.teslaSiteInfoKey
import io.teslasync.shared.core.data.repo.teslaWcChargingHistoryKey
import io.teslasync.shared.core.data.repo.vampireDrainStatsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [EnergyStore] folds the S7 [EnergyRepository] into shared, refreshable feeds and
 * routes each mutation to the right repository call + the EXACT web `invalidateQueries` family —
 * using a fake repository, so no network or cache is involved. Each fake read counts its
 * collections under the same cache key the store observes (computed via the shared key builders),
 * so a refresh is directly observable per feed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyStoreTest {
    private class FakeEnergyRepository : EnergyRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val sitesRefreshes: Int get() = sitesRefreshCount
        var sitesRefreshCount: Int = 0
        val siteInfoRefreshes: MutableList<Long> = mutableListOf()
        val touUpdates: MutableList<Pair<Long, JsonObject>> = mutableListOf()
        val energyHistoryRefreshes: MutableList<Long> = mutableListOf()
        val backupHistoryRefreshes: MutableList<Long> = mutableListOf()
        val wcChargingRefreshes: MutableList<Long> = mutableListOf()
        val liveStatusRefreshes: MutableList<Long> = mutableListOf()

        private fun counting(key: String): Flow<Resource<JsonElement>> =
            flow {
                collections[key] = (collections[key] ?: 0) + 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonObject(emptyMap()), fetchedAt = 1L, stale = false))
            }

        override fun energyStats(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = counting(energyStatsKey(vehicleId, days))

        override fun batteryHealth(
            vehicleId: String,
            asOf: String?,
        ): Flow<Resource<JsonElement>> = counting(batteryHealthKey(vehicleId, asOf))

        override fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> = counting(batteryCellsKey(vehicleId))

        override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .batteryHealthAnalyticsKey(vehicleId),
            )

        override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .batteryDegradationKey(vehicleId),
            )

        override fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .energyFlowKey(vehicleId),
            )

        override fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>> = counting(vampireDrainStatsKey(vehicleId))

        override fun vampireDrainEvents(
            vehicleId: String,
            limit: Int,
        ): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .vampireDrainEventsKey(vehicleId, limit),
            )

        override fun projectedRange(vehicleId: String): Flow<Resource<JsonElement>> =
            counting(
                io.teslasync.shared.core.data.repo
                    .projectedRangeKey(vehicleId),
            )

        override fun sleepEfficiency(
            vehicleId: String,
            days: Int,
            startDate: String?,
            endDate: String?,
        ): Flow<Resource<JsonElement>> = counting(sleepEfficiencyKey(vehicleId, days, startDate, endDate))

        override fun teslaEnergySites(): Flow<Resource<JsonElement>> = counting(teslaEnergySitesKey())

        override fun teslaEnergySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = counting(teslaSiteInfoKey(siteId))

        override fun teslaEnergyHistory(
            siteId: Long,
            period: String,
            since: String?,
            until: String?,
        ): Flow<Resource<JsonElement>> = counting(teslaEnergyHistoryKey(siteId, period, since, until))

        override fun teslaBackupHistory(
            siteId: Long,
            since: String?,
            until: String?,
        ): Flow<Resource<JsonElement>> = counting(teslaBackupHistoryKey(siteId, since, until))

        override fun teslaWcChargingHistory(
            siteId: Long,
            since: String?,
            until: String?,
        ): Flow<Resource<JsonElement>> = counting(teslaWcChargingHistoryKey(siteId, since, until))

        override fun teslaEnergyLiveStatus(siteId: Long): Flow<Resource<JsonElement>> = counting(teslaLiveStatusKey(siteId))

        override fun teslaEnergyLiveStatusHistory(
            siteId: Long,
            since: String?,
            until: String?,
            limit: Int?,
        ): Flow<Resource<JsonElement>> = counting(teslaLiveStatusHistoryKey(siteId, since, until, limit))

        override suspend fun refreshTeslaEnergySites(): Result<JsonElement> {
            sitesRefreshCount += 1
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement> {
            siteInfoRefreshes += siteId
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun updateTouSettings(
            siteId: Long,
            settings: JsonObject,
        ): Result<JsonElement> {
            touUpdates += siteId to settings
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaEnergyHistory(
            siteId: Long,
            period: String,
            startDate: String?,
            endDate: String?,
            timeZone: String?,
        ): Result<JsonElement> {
            energyHistoryRefreshes += siteId
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaBackupHistory(
            siteId: Long,
            period: String,
            startDate: String?,
            endDate: String?,
            timeZone: String?,
        ): Result<JsonElement> {
            backupHistoryRefreshes += siteId
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaWcChargingHistory(
            siteId: Long,
            startDate: String?,
            endDate: String?,
            timeZone: String?,
        ): Result<JsonElement> {
            wcChargingRefreshes += siteId
            return Result.success(JsonObject(emptyMap()))
        }

        override suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement> {
            liveStatusRefreshes += siteId
            return Result.success(JsonObject(emptyMap()))
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = EnergyStore(FakeEnergyRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.energyStats("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            assertTrue(seen.last() is Resource.Success, "terminal emission is the network Success")
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = EnergyStore(FakeEnergyRepository(), backgroundScope)
            assertSame(store.energyStats("7"), store.energyStats("7"))
            assertTrue(store.energyStats("7") !== store.energyStats("7", days = 7))
            assertTrue(store.energyStats("7") !== store.energyStats("8"))
            // The as-of historical read is a distinct feed from the live battery-health read.
            assertTrue(store.batteryHealth("7") !== store.batteryHealth("7", asOf = "2026-01-01T00:00:00Z"))
        }

    @Test
    fun refreshSitesFansAcrossSitesFamilyOnly() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaEnergySites().collect {} }
            backgroundScope.launch { store.teslaEnergySiteInfo(5).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[teslaEnergySitesKey()])
            assertEquals(1, repo.collections[teslaSiteInfoKey(5)])

            val result = store.refreshTeslaEnergySites()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.sitesRefreshes)
            assertEquals(2, repo.collections[teslaEnergySitesKey()])
            // Site-info is a sibling, not a descendant of ['tesla-energy-sites'] → untouched.
            assertEquals(1, repo.collections[teslaSiteInfoKey(5)])
        }

    @Test
    fun refreshSiteInfoRefreshesOnlyThatSite() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaEnergySiteInfo(5).collect {} }
            backgroundScope.launch { store.teslaEnergySiteInfo(9).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[teslaSiteInfoKey(5)])
            assertEquals(1, repo.collections[teslaSiteInfoKey(9)])

            val result = store.refreshTeslaEnergySiteInfo(5)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L), repo.siteInfoRefreshes)
            // Only site 5 re-fetches; the web invalidates ['tesla-site-info', 5], not site 9.
            assertEquals(2, repo.collections[teslaSiteInfoKey(5)])
            assertEquals(1, repo.collections[teslaSiteInfoKey(9)])
        }

    @Test
    fun updateTouSettingsRefreshesThatSiteInfo() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaEnergySiteInfo(5).collect {} }
            runCurrent()

            val settings = JsonObject(emptyMap())
            val result = store.updateTouSettings(5, settings)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L to settings), repo.touUpdates)
            assertEquals(2, repo.collections[teslaSiteInfoKey(5)])
        }

    @Test
    fun refreshEnergyHistoryFansAcrossHistoryFamilyOnly() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaEnergyHistory(5).collect {} }
            backgroundScope.launch { store.teslaEnergyHistory(5, since = "2026-01-01").collect {} }
            backgroundScope.launch { store.teslaBackupHistory(5).collect {} }
            runCurrent()

            val result = store.refreshTeslaEnergyHistory(5)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L), repo.energyHistoryRefreshes)
            // Both energy-history variations re-fetch …
            assertEquals(2, repo.collections[teslaEnergyHistoryKey(5, "day", null, null)])
            assertEquals(2, repo.collections[teslaEnergyHistoryKey(5, "day", "2026-01-01", null)])
            // … the sibling backup-history family is left alone.
            assertEquals(1, repo.collections[teslaBackupHistoryKey(5, null, null)])
        }

    @Test
    fun refreshBackupAndWcChargingFanAcrossOwnFamiliesOnly() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaBackupHistory(5).collect {} }
            backgroundScope.launch { store.teslaWcChargingHistory(5).collect {} }
            runCurrent()

            assertTrue(store.refreshTeslaBackupHistory(5).isSuccess)
            runCurrent()
            assertEquals(2, repo.collections[teslaBackupHistoryKey(5, null, null)])
            assertEquals(1, repo.collections[teslaWcChargingHistoryKey(5, null, null)])

            assertTrue(store.refreshTeslaWcChargingHistory(5).isSuccess)
            runCurrent()
            assertEquals(2, repo.collections[teslaWcChargingHistoryKey(5, null, null)])
            assertEquals(2, repo.collections[teslaBackupHistoryKey(5, null, null)])

            assertEquals(listOf(5L), repo.backupHistoryRefreshes)
            assertEquals(listOf(5L), repo.wcChargingRefreshes)
        }

    @Test
    fun refreshLiveStatusFansAcrossBothLiveStatusFamilies() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaEnergyLiveStatus(5).collect {} }
            backgroundScope.launch { store.teslaEnergyLiveStatusHistory(5).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[teslaLiveStatusKey(5)])
            assertEquals(1, repo.collections[teslaLiveStatusHistoryKey(5, null, null, null)])

            val result = store.refreshTeslaEnergyLiveStatus(5)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L), repo.liveStatusRefreshes)
            // The web invalidates BOTH ['tesla-live-status'] and ['tesla-live-status-history'];
            // the '-history' feed is NOT a descendant of the plain live-status family, so both
            // families must be refreshed explicitly.
            assertEquals(2, repo.collections[teslaLiveStatusKey(5)])
            assertEquals(2, repo.collections[teslaLiveStatusHistoryKey(5, null, null, null)])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeEnergyRepository()
            val store = EnergyStore(repo, backgroundScope)

            val result = store.refreshTeslaEnergyLiveStatus(5)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(5L), repo.liveStatusRefreshes)
            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
            assertNull(repo.collections[teslaLiveStatusKey(5)])
        }
}
