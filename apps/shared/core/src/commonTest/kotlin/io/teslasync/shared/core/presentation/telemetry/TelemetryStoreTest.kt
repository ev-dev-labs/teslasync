package io.teslasync.shared.core.presentation.telemetry

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TELEMETRY_ERROR_VINS_KEY
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.data.repo.telemetryErrorsKey
import io.teslasync.shared.core.data.repo.telemetrySignalsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [TelemetryStore] folds the S7 [TelemetryRepository] into shared, refreshable feeds,
 * and routes each error-refresh mutation to the right repository call + a family-scoped invalidation
 * — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per feed key (so a refresh is observable) and
     * emits Loading→Success with a deterministic payload; every mutation records its call and succeeds.
     */
    private class FakeTelemetryRepository : TelemetryRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        var refreshVinsCalls: Int = 0
        var refreshErrorsCalls: Int = 0

        private fun <T> counted(
            key: String,
            value: (Int) -> T,
        ): Flow<Resource<T>> =
            flow {
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value(n), fetchedAt = 1L, stale = false))
            }

        override fun signals(vehicleId: Long): Flow<Resource<List<String>>> =
            counted(telemetrySignalsKey(vehicleId)) { n -> listOf("VehicleSpeed-$n") }

        override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> =
            counted("live:$vehicleId") { VehicleLiveSignalsResponse(vehicleId = vehicleId) }

        override fun signalStats(vehicleId: Long): Flow<Resource<SignalStats>> =
            counted("stats:$vehicleId") { n -> SignalStats(vehicleId = vehicleId, count = n.toLong()) }

        override fun signalHistory(
            vehicleId: Long,
            signal: String,
            hours: Int,
        ): Flow<Resource<SignalHistoryResponse>> = counted("hist:$vehicleId:$signal:$hours") { SignalHistoryResponse(signal = signal) }

        override fun signalLog(
            vehicleId: Long,
            signal: String,
            hours: Int,
            page: Int,
            pageSize: Int,
        ): Flow<Resource<SignalHistoryResponse>> = counted("log:$vehicleId:$signal:$hours:$page") { SignalHistoryResponse(signal = signal) }

        override fun signalDiff(
            vehicleId: Long,
            signal: String,
            from: String,
            to: String,
        ): Flow<Resource<SignalHistoryResponse>> = counted("diff:$vehicleId:$signal:$from:$to") { SignalHistoryResponse(signal = signal) }

        override fun signalSnapshot(
            vehicleId: Long,
            at: String,
            signalsCsv: String,
        ): Flow<Resource<SignalSnapshotResponse>> =
            counted("snap:$vehicleId:$at:$signalsCsv") { SignalSnapshotResponse(vehicleId = vehicleId) }

        override fun signalDiffServer(
            vehicleId: Long,
            atA: String,
            atB: String,
            signalsCsv: String,
        ): Flow<Resource<SignalDiffServerResponse>> =
            counted("diffsrv:$vehicleId:$atA:$atB:$signalsCsv") { SignalDiffServerResponse(vehicleId = vehicleId) }

        override fun signalGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>> = counted("gaps:$vehicleId") { emptyMap() }

        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> =
            counted(
                "mqtt",
            ) { TelemetryStatus(connected = true, broker = null, uptimeSeconds = null, vehicles = emptyList(), topics = emptyList()) }

        override fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>> = counted("catalog") { emptyList() }

        override fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>> =
            counted("obs:${params.vehicleId}:${params.signalName}") { emptyList() }

        override fun fleetTelemetryErrorVINs(): Flow<Resource<List<FleetTelemetryErrorVIN>>> =
            counted(TELEMETRY_ERROR_VINS_KEY) { emptyList() }

        override fun fleetTelemetryErrors(vin: String?): Flow<Resource<List<FleetTelemetryError>>> =
            counted(telemetryErrorsKey(vin)) {
                emptyList()
            }

        override suspend fun refreshFleetTelemetryErrorVINs(): Result<Unit> {
            refreshVinsCalls += 1
            return Result.success(Unit)
        }

        override suspend fun refreshFleetTelemetryErrors(): Result<Unit> {
            refreshErrorsCalls += 1
            return Result.success(Unit)
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = TelemetryStore(FakeTelemetryRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<String>>>()
            backgroundScope.launch { store.signals(7).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("VehicleSpeed-1", last.data.first())
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = TelemetryStore(FakeTelemetryRepository(), backgroundScope)
            assertSame(store.signals(7), store.signals(7))
            assertTrue(store.signals(7) !== store.signals(9))
            assertTrue(store.signalStats(7) !== store.signals(7))
        }

    @Test
    fun observersOfOneFeedFoldIntoASingleUpstreamCollection() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.mqttStatus().collect {} }
            backgroundScope.launch { store.mqttStatus().collect {} }
            runCurrent()

            assertEquals(1, repo.collections["mqtt"])
        }

    @Test
    fun perFeedRefreshReCollectsOnlyThatFeed() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.signals(7).collect {} }
            backgroundScope.launch { store.signalStats(7).collect {} }
            runCurrent()
            assertEquals(1, repo.collections[telemetrySignalsKey(7)])
            assertEquals(1, repo.collections["stats:7"])

            store.refreshSignals(7)
            runCurrent()

            assertEquals(2, repo.collections[telemetrySignalsKey(7)], "the signals feed re-collected")
            assertEquals(1, repo.collections["stats:7"], "an unrelated feed is untouched")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)

            store.refreshSignals(7)
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no observer ⇒ no upstream restart")
        }

    @Test
    fun refreshErrorVINsMutationDelegatesAndInvalidatesOnlyTheVinsFamily() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.fleetTelemetryErrorVINs().collect {} }
            backgroundScope.launch { store.fleetTelemetryErrors().collect {} }
            backgroundScope.launch { store.fleetTelemetryErrors("5YJ3").collect {} }
            runCurrent()
            assertEquals(1, repo.collections[TELEMETRY_ERROR_VINS_KEY])
            assertEquals(1, repo.collections[telemetryErrorsKey(null)])
            assertEquals(1, repo.collections[telemetryErrorsKey("5YJ3")])

            val result = store.refreshFleetTelemetryErrorVINs()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.refreshVinsCalls)
            assertEquals(2, repo.collections[TELEMETRY_ERROR_VINS_KEY], "error-vins re-collected")
            assertEquals(1, repo.collections[telemetryErrorsKey(null)], "errors family untouched")
            assertEquals(1, repo.collections[telemetryErrorsKey("5YJ3")], "errors family untouched")
        }

    @Test
    fun refreshErrorsMutationDelegatesAndInvalidatesEveryErrorsFeed() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.fleetTelemetryErrorVINs().collect {} }
            backgroundScope.launch { store.fleetTelemetryErrors().collect {} }
            backgroundScope.launch { store.fleetTelemetryErrors("5YJ3").collect {} }
            runCurrent()

            val result = store.refreshFleetTelemetryErrors()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.refreshErrorsCalls)
            // Both vin variants of the errors family re-collect…
            assertEquals(2, repo.collections[telemetryErrorsKey(null)])
            assertEquals(2, repo.collections[telemetryErrorsKey("5YJ3")])
            // …while the disjoint error-vins family is left alone.
            assertEquals(1, repo.collections[TELEMETRY_ERROR_VINS_KEY])
        }

    @Test
    fun signalObservationsAdaptedFeedFlowsThrough() =
        runTest {
            val repo = FakeTelemetryRepository()
            val store = TelemetryStore(repo, backgroundScope)
            val params = SignalObservationsParams(vehicleId = 7, signalName = "VehicleSpeed")
            val seen = mutableListOf<Resource<List<SignalObservation>>>()
            backgroundScope.launch { store.signalObservations(params).collect { seen += it } }
            runCurrent()

            assertTrue(seen.last() is Resource.Success)
            assertEquals(1, repo.collections["obs:7:VehicleSpeed"])
        }
}
