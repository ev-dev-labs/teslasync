package io.teslasync.shared.core.presentation.signals

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalsRepository
import io.teslasync.shared.core.data.repo.signalsAvailableKey
import io.teslasync.shared.core.data.repo.signalsHistoryKey
import io.teslasync.shared.core.data.repo.signalsLiveKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SignalsStore] folds the S7 [SignalsRepository] into shared, refreshable feeds and
 * routes each read to the right repository call + per-feed refresh — using a fake repository, so no
 * network or cache is involved. The cache→network emission order, the per-`(vehicle/signal/range)`
 * feed identity, and the targeted-refresh granularity are the behaviours under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalsStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections per key (so a refresh is observable) and
     * emits Loading→Success with a deterministic payload that encodes the collection count.
     */
    private class FakeSignalsRepository : SignalsRepository {
        val availableCollections: MutableMap<String, Int> = mutableMapOf()
        val liveCollections: MutableMap<String, Int> = mutableMapOf()
        val historyCollections: MutableMap<String, Int> = mutableMapOf()

        override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> =
            flow {
                val key = signalsAvailableKey(vehicleId)
                val n = (availableCollections[key] ?: 0) + 1
                availableCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            AvailableSignalsResponse(
                                vehicleId = vehicleId,
                                count = n,
                                source = "fake",
                                signals = listOf(descriptorRow(n)),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>> =
            flow {
                val key = signalsLiveKey(vehicleId)
                val n = (liveCollections[key] ?: 0) + 1
                liveCollections[key] = n
                val speed = n.toDouble() // parity:allow stdlib numeric coercion
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            LiveSignalsResponse(
                                vehicleId = vehicleId,
                                count = n,
                                at = "2026-01-01T00:00:00Z",
                                signals = mapOf("VehicleSpeed" to SignalEnvelope(SignalKind.Float, SignalValue.Num(speed), "")),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
            range: SignalHistoryRange,
        ): Flow<Resource<SignalHistoryResponse>> =
            flow {
                val key = signalsHistoryKey(vehicleId, signalName, range)
                val n = (historyCollections[key] ?: 0) + 1
                historyCollections[key] = n
                val speed = n.toDouble() // parity:allow stdlib numeric coercion
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            SignalHistoryResponse(
                                vehicleId = vehicleId,
                                signal = signalName,
                                expectedKind = "ValueKindFloat",
                                from = "2026-01-01T00:00:00Z",
                                to = "2026-01-02T00:00:00Z",
                                count = n,
                                data = listOf(SignalEnvelope(SignalKind.Float, SignalValue.Num(speed), "")),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        companion object {
            fun descriptorRow(n: Int): SignalDescriptor =
                SignalDescriptor(
                    name = "Signal$n",
                    category = "telemetry",
                    valueKind = SignalKind.Float,
                    unitKind = SignalUnitKind.Distance,
                    isCompound = false,
                    isSettingUnit = false,
                )
        }
    }

    @Test
    fun availableSignalsReadEmitsCacheThenNetwork() =
        runTest {
            val store = SignalsStore(FakeSignalsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<AvailableSignalsResponse>>()
            backgroundScope.launch { store.availableSignals(7).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals(7L, last.data.vehicleId)
            assertEquals(1, last.data.signals.size)
        }

    @Test
    fun liveSignalsReadEmitsCacheThenNetwork() =
        runTest {
            val store = SignalsStore(FakeSignalsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<LiveSignalsResponse>>()
            backgroundScope.launch { store.liveSignals(7).collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals(
                SignalKind.Float,
                last.data.signals
                    .getValue("VehicleSpeed")
                    .kind,
            )
        }

    @Test
    fun signalHistoryReadEmitsCacheThenNetwork() =
        runTest {
            val store = SignalsStore(FakeSignalsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<SignalHistoryResponse>>()
            backgroundScope.launch { store.signalHistory(7, "VehicleSpeed").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals("VehicleSpeed", last.data.signal)
            assertEquals(1, last.data.data.size)
        }

    @Test
    fun sameParamsShareUpstreamAndDistinctParamsAreDistinctFeeds() =
        runTest {
            val store = SignalsStore(FakeSignalsRepository(), backgroundScope)
            assertSame(store.availableSignals(7), store.availableSignals(7))
            assertNotSame(store.availableSignals(7), store.availableSignals(8))
            assertSame(store.liveSignals(7), store.liveSignals(7))
            assertNotSame<Any?>(store.availableSignals(7), store.liveSignals(7))
            assertSame(
                store.signalHistory(7, "VehicleSpeed", SignalHistoryRange(hours = 24)),
                store.signalHistory(7, "VehicleSpeed", SignalHistoryRange(hours = 24)),
            )
            assertNotSame(
                store.signalHistory(7, "VehicleSpeed", SignalHistoryRange(hours = 24)),
                store.signalHistory(7, "VehicleSpeed", SignalHistoryRange(hours = 48)),
            )
        }

    @Test
    fun refreshReFetchesOnlyTheObservedFeed() =
        runTest {
            val repo = FakeSignalsRepository()
            val store = SignalsStore(repo, backgroundScope)
            backgroundScope.launch { store.availableSignals(7).collect {} }
            backgroundScope.launch { store.availableSignals(8).collect {} }
            runCurrent()
            assertEquals(1, repo.availableCollections[signalsAvailableKey(7)])
            assertEquals(1, repo.availableCollections[signalsAvailableKey(8)])

            store.refreshAvailableSignals(7)
            runCurrent()

            // Only vehicle 7's feed re-collected; vehicle 8 is untouched.
            assertEquals(2, repo.availableCollections[signalsAvailableKey(7)])
            assertEquals(1, repo.availableCollections[signalsAvailableKey(8)])
        }

    @Test
    fun refreshHistoryReFetchesOnlyThatRangeFeed() =
        runTest {
            val repo = FakeSignalsRepository()
            val store = SignalsStore(repo, backgroundScope)
            val r24 = SignalHistoryRange(hours = 24)
            val r48 = SignalHistoryRange(hours = 48)
            backgroundScope.launch { store.signalHistory(7, "VehicleSpeed", r24).collect {} }
            backgroundScope.launch { store.signalHistory(7, "VehicleSpeed", r48).collect {} }
            runCurrent()
            assertEquals(1, repo.historyCollections[signalsHistoryKey(7, "VehicleSpeed", r24)])
            assertEquals(1, repo.historyCollections[signalsHistoryKey(7, "VehicleSpeed", r48)])

            store.refreshSignalHistory(7, "VehicleSpeed", r24)
            runCurrent()

            assertEquals(2, repo.historyCollections[signalsHistoryKey(7, "VehicleSpeed", r24)])
            assertEquals(1, repo.historyCollections[signalsHistoryKey(7, "VehicleSpeed", r48)])
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeSignalsRepository()
            val store = SignalsStore(repo, backgroundScope)

            store.refreshLiveSignals(7)
            runCurrent()

            assertTrue(repo.liveCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
