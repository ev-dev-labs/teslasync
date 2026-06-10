package io.teslasync.shared.core.presentation.guard

import io.teslasync.shared.core.data.repo.GuardRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [GuardStore] folds the S7 [GuardRepository] into shared, refreshable feeds,
 * unwraps the events envelope onto a plain list, honours the web `enabled: vehicleId > 0` gate, and
 * routes each mutation to the right repository call + the exact feeds the matching web hook
 * invalidates — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuardStoreTest {
    /**
     * Fake S7 port: each read re-counts its collections per vehicle (so a refresh is observable) and
     * emits Loading→Success; the events feed emits an envelope carrying `n` events so a refresh is
     * visible in the unwrapped list size. Every mutation records its argument and succeeds.
     */
    private class FakeGuardRepository : GuardRepository {
        val configCollections: MutableMap<String, Int> = mutableMapOf()
        val eventsCollections: MutableMap<String, Int> = mutableMapOf()
        val setConfigCalls: MutableList<SetGuardConfigInput> = mutableListOf()
        val panicCalls: MutableList<String> = mutableListOf()
        val acknowledgeCalls: MutableList<Pair<String, Long>> = mutableListOf()

        override fun guardConfig(vehicleId: String): Flow<Resource<GuardConfig>> =
            flow {
                val n = (configCollections[vehicleId] ?: 0) + 1
                configCollections[vehicleId] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = config(vehicleId, n), fetchedAt = 1L, stale = false))
            }

        override fun guardEvents(vehicleId: String): Flow<Resource<GuardEventsResponse>> =
            flow {
                val n = (eventsCollections[vehicleId] ?: 0) + 1
                eventsCollections[vehicleId] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                // n events so the unwrapped list size tracks the collection count.
                val events = (1..n).map { event(vehicleId.toLong(), it.toLong()) }
                emit(Resource.Success(data = GuardEventsResponse(vehicleId.toLong(), events), fetchedAt = 1L, stale = false))
            }

        override suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse> {
            setConfigCalls += input
            return Result.success(SetConfigResponse(config(input.vehicleId, 0)))
        }

        override suspend fun triggerPanic(vehicleId: String): Result<PanicResponse> {
            panicCalls += vehicleId
            return Result.success(PanicResponse(eventId = 1))
        }

        override suspend fun acknowledgeGuardEvent(
            vehicleId: String,
            eventId: Long,
        ): Result<AcknowledgeResponse> {
            acknowledgeCalls += vehicleId to eventId
            return Result.success(AcknowledgeResponse(status = "ok"))
        }

        companion object {
            fun config(
                vehicleId: String,
                rev: Int,
            ): GuardConfig =
                GuardConfig(
                    vehicleId = vehicleId.toLong(),
                    enabled = true,
                    homeGeofenceId = null,
                    sensitivity = "rev-$rev",
                    autoPanic = false,
                    createdAt = "2026-01-01T00:00:00Z",
                    updatedAt = "2026-01-01T00:00:00Z",
                )

            fun event(
                vehicleId: Long,
                id: Long,
            ): GuardEvent =
                GuardEvent(
                    id = id,
                    vehicleId = vehicleId,
                    ts = "2026-01-01T00:00:00Z",
                    eventType = "state_changed",
                )
        }
    }

    @Test
    fun configReadEmitsCacheThenNetwork() =
        runTest {
            val store = GuardStore(FakeGuardRepository(), backgroundScope)
            val seen = mutableListOf<Resource<GuardConfig>>()
            backgroundScope.launch { store.config("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("rev-1", last.data.sensitivity)
            assertEquals(7L, last.data.vehicleId)
        }

    @Test
    fun eventsReadUnwrapsEnvelopeToList() =
        runTest {
            val store = GuardStore(FakeGuardRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<GuardEvent>>>()
            backgroundScope.launch { store.events("7").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading)
            val last = seen.last() as Resource.Success
            // First collection emits exactly one event; the envelope was unwrapped to the list.
            assertEquals(1, last.data.size)
            assertEquals(7L, last.data.first().vehicleId)
        }

    @Test
    fun disabledVehicleNeverFetchesAndReturnsAStableInstance() =
        runTest {
            val repo = FakeGuardRepository()
            val store = GuardStore(repo, backgroundScope)

            // `enabled: vehicleId > 0` — every non-positive / non-numeric / null id is disabled.
            for (bad in listOf(null, "", "0", "-1", "abc")) {
                backgroundScope.launch { store.config(bad).collect {} }
                backgroundScope.launch { store.events(bad).collect {} }
            }
            runCurrent()

            assertTrue(repo.configCollections.isEmpty(), "disabled config feed must never fetch")
            assertTrue(repo.eventsCollections.isEmpty(), "disabled events feed must never fetch")
            // All disabled feeds collapse to one stable instance per read.
            assertSame(store.config("0"), store.config("-1"))
            assertSame(store.events(null), store.events(""))
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = GuardStore(FakeGuardRepository(), backgroundScope)
            assertSame(store.config("7"), store.config("7"))
            assertSame(store.events("7"), store.events("7"))
            assertTrue(store.config("7") !== store.config("8"))
            assertTrue(store.events("7") !== store.events("8"))
        }

    @Test
    fun setGuardConfigDelegatesAndRefreshesConfigAndEvents() =
        runTest {
            val repo = FakeGuardRepository()
            val store = GuardStore(repo, backgroundScope)
            backgroundScope.launch { store.config("7").collect {} }
            backgroundScope.launch { store.events("7").collect {} }
            runCurrent()
            assertEquals(1, repo.configCollections["7"])
            assertEquals(1, repo.eventsCollections["7"])

            val input =
                SetGuardConfigInput(
                    vehicleId = "7",
                    enabled = true,
                    homeGeofenceId = 3,
                    sensitivity = "high",
                    autoPanic = true,
                )
            val result = store.setGuardConfig(input)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(input), repo.setConfigCalls)
            // useSetGuardConfig invalidates BOTH config and events.
            assertEquals(2, repo.configCollections["7"])
            assertEquals(2, repo.eventsCollections["7"])
        }

    @Test
    fun triggerPanicDelegatesAndRefreshesEventsOnly() =
        runTest {
            val repo = FakeGuardRepository()
            val store = GuardStore(repo, backgroundScope)
            backgroundScope.launch { store.config("7").collect {} }
            backgroundScope.launch { store.events("7").collect {} }
            runCurrent()

            val result = store.triggerPanic("7")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("7"), repo.panicCalls)
            // useGuardPanic invalidates ONLY events; config is untouched.
            assertEquals(1, repo.configCollections["7"])
            assertEquals(2, repo.eventsCollections["7"])
        }

    @Test
    fun acknowledgeEventDelegatesAndRefreshesEventsOnly() =
        runTest {
            val repo = FakeGuardRepository()
            val store = GuardStore(repo, backgroundScope)
            backgroundScope.launch { store.config("7").collect {} }
            val seen = mutableListOf<Resource<List<GuardEvent>>>()
            backgroundScope.launch { store.events("7").collect { seen += it } }
            runCurrent()
            assertEquals(1, (seen.last() as Resource.Success).data.size)

            val result = store.acknowledgeEvent("7", 42)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("7" to 42L), repo.acknowledgeCalls)
            assertEquals(1, repo.configCollections["7"])
            // The events feed re-fetched: the unwrapped list grew to the 2nd collection's size.
            assertEquals(2, (seen.last() as Resource.Success).data.size)
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeGuardRepository()
            val store = GuardStore(repo, backgroundScope)

            val result = store.triggerPanic("7")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.panicCalls.size)
            assertTrue(repo.eventsCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
