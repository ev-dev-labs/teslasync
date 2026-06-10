package io.teslasync.shared.core.presentation.apihealth

import io.teslasync.shared.core.data.repo.ApiHealthProbe
import io.teslasync.shared.core.data.repo.ApiHealthRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Verifies the S8 [ApiHealthStore] folds the S7 [ApiHealthRepository] probe into a shared,
 * self-polling [ApiHealthState] flow — using a fake repository, so no network is involved.
 * Mirrors the web `useApiHealth` hook: start unknown, probe immediately, re-probe on the poll
 * interval, and bucket via the shared [ApiHealth] derivation.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApiHealthStoreTest {
    /** Fake S7 port returning queued probes (last repeats) and counting how often it is probed. */
    private class FakeApiHealthRepository(
        private val probes: List<ApiHealthProbe>,
    ) : ApiHealthRepository {
        var calls: Int = 0
            private set

        override suspend fun probe(): ApiHealthProbe {
            val index = if (calls < probes.size) calls else probes.size - 1
            calls += 1
            return probes[index]
        }
    }

    private fun probe(
        ok: Boolean,
        latencyMs: Long,
        checkedAt: String = "2026-06-05T09:00:00.000Z",
    ): ApiHealthProbe = ApiHealthProbe(ok = ok, latencyMs = latencyMs, checkedAt = checkedAt)

    @Test
    fun startsUnknownBeforeAnyProbe() =
        runTest {
            val store = ApiHealthStore(FakeApiHealthRepository(listOf(probe(true, 10))), backgroundScope, 1_000)
            // No subscriber yet: the StateFlow holds its unknown initial value.
            assertEquals(ApiHealth.UNKNOWN, store.state.value)
        }

    @Test
    fun probesImmediatelyAndDerivesState() =
        runTest {
            val repo = FakeApiHealthRepository(listOf(probe(true, 42, "2026-06-05T09:00:00.000Z")))
            val store = ApiHealthStore(repo, backgroundScope, 1_000)
            backgroundScope.launch { store.state.collect {} }
            runCurrent()

            assertEquals(1, repo.calls, "subscription triggers an immediate probe")
            assertEquals(
                ApiHealthState(ApiHealthStatus.OK, 42, "2026-06-05T09:00:00.000Z"),
                store.state.value,
            )
        }

    @Test
    fun reProbesOnEachPollInterval() =
        runTest {
            val repo = FakeApiHealthRepository(listOf(probe(true, 10)))
            val store = ApiHealthStore(repo, backgroundScope, 1_000)
            backgroundScope.launch { store.state.collect {} }
            runCurrent()
            assertEquals(1, repo.calls)

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(2, repo.calls, "the poll interval drives a second probe")

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(3, repo.calls, "polling continues on each interval")
        }

    @Test
    fun bucketsDegradedAndOfflineFromProbe() =
        runTest {
            val repo =
                FakeApiHealthRepository(
                    listOf(
                        probe(true, 750, "t-degraded"),
                        probe(false, 5, "t-offline"),
                    ),
                )
            val store = ApiHealthStore(repo, backgroundScope, 1_000)
            backgroundScope.launch { store.state.collect {} }
            runCurrent()
            assertEquals(
                ApiHealthState(ApiHealthStatus.DEGRADED, 750, "t-degraded"),
                store.state.value,
            )

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(
                ApiHealthState(ApiHealthStatus.OFFLINE, 5, "t-offline"),
                store.state.value,
            )
        }

    @Test
    fun doesNotProbeWithoutASubscriber() =
        runTest {
            val repo = FakeApiHealthRepository(listOf(probe(true, 10)))
            ApiHealthStore(repo, backgroundScope, 1_000)
            runCurrent()
            advanceTimeBy(10_000)
            runCurrent()
            assertEquals(0, repo.calls, "an unobserved health store never probes")
        }
}
