package io.teslasync.shared.core.presentation.fleettelemetry

import io.teslasync.shared.core.data.repo.FleetTelemetryRepository
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
 * Verifies the S8 [FleetTelemetryStore] folds the S7 [FleetTelemetryRepository] into a single
 * shared, refreshable feed — using a fake repository, so no network or cache is involved. Mirrors
 * the web `useFleetTelemetry` hook: one parameterless read, no mutations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetTelemetryStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success, stamping the emitted snapshot's first category name with the collection count.
     */
    private class FakeFleetTelemetryRepository : FleetTelemetryRepository {
        var collections: Int = 0

        override fun coverage(): Flow<Resource<FleetTelemetryCoverageResponse>> =
            flow {
                collections += 1
                val n = collections
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            FleetTelemetryCoverageResponse(
                                categories = listOf(FleetTelemetryCategoryCoverage(category = "drive#$n", totalFields = n)),
                                destinationTotals = mapOf("drives" to n),
                                orphanFields = emptyList(),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = FleetTelemetryStore(FakeFleetTelemetryRepository(), backgroundScope)
            val seen = mutableListOf<Resource<FleetTelemetryCoverageResponse>>()
            backgroundScope.launch { store.coverage().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val category = last.data.categories.single()
            assertEquals("drive#1", category.category)
            assertEquals(1, last.data.destinationTotals["drives"])
        }

    @Test
    fun coverageFeedIsSharedAcrossCallers() =
        runTest {
            val store = FleetTelemetryStore(FakeFleetTelemetryRepository(), backgroundScope)
            assertSame(store.coverage(), store.coverage())
        }

    @Test
    fun coverageCollectsExactlyOnceWhileObserved() =
        runTest {
            val repo = FakeFleetTelemetryRepository()
            val store = FleetTelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.coverage().collect {} }
            backgroundScope.launch { store.coverage().collect {} }
            runCurrent()

            // Two observers of the one shared feed fold into a single upstream collection.
            assertEquals(1, repo.collections)
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeFleetTelemetryRepository()
            val store = FleetTelemetryStore(repo, backgroundScope)
            backgroundScope.launch { store.coverage().collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.refreshCoverage()
            runCurrent()

            assertEquals(2, repo.collections, "refresh re-collects the coverage feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeFleetTelemetryRepository()
            val store = FleetTelemetryStore(repo, backgroundScope)

            store.refreshCoverage()
            runCurrent()

            assertEquals(0, repo.collections, "no observer ⇒ no upstream restart")
        }
}
