package io.teslasync.android.data.dashboard

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.DashboardRepository
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.dashboard.DashboardStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [DashboardViewModel] against the real shared [DashboardStore] backed by a fake repository whose
 * emissions are hand-built `StateFlow` sequences — covering cache-then-network, refresh, empty, hard
 * error + retry, and stale/offline + retry end-to-end through the actual store.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardViewModelTest {
    private val statsA = DashboardStats(totalVehicles = 3, totalM = 1000.0)
    private val statsB = DashboardStats(totalVehicles = 4, totalM = 2000.0)

    private class FakeDashboardRepository : DashboardRepository {
        val emissions =
            MutableStateFlow<List<Resource<DashboardStats>>>(listOf(Resource.Loading(null, null, false)))

        override fun stats(): Flow<Resource<DashboardStats>> = flow { emissions.value.forEach { emit(it) } }
    }

    @Test
    fun cacheThenNetworkLoadsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeDashboardRepository()
            repo.emissions.value =
                listOf(Resource.Loading(null, null, false), Resource.Success(statsA, 100L, false))
            val viewModel = DashboardViewModel(DashboardStore(repo, backgroundScope), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.stats.collect {} }
            advanceUntilIdle()

            val state = viewModel.stats.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(statsA, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun refreshReFetchesUpdatedSummary() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeDashboardRepository()
            repo.emissions.value =
                listOf(Resource.Loading(null, null, false), Resource.Success(statsA, 100L, false))
            val viewModel = DashboardViewModel(DashboardStore(repo, backgroundScope), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.stats.collect {} }
            advanceUntilIdle()
            assertEquals(statsA, viewModel.stats.value.data)

            repo.emissions.value =
                listOf(Resource.Loading(statsA, 100L, false), Resource.Success(statsB, 200L, false))
            viewModel.refresh()
            advanceUntilIdle()

            assertEquals(statsB, viewModel.stats.value.data)
        }

    @Test
    fun allZeroSummaryIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeDashboardRepository()
            repo.emissions.value =
                listOf(Resource.Loading(null, null, false), Resource.Success(DashboardStats(), 100L, false))
            val viewModel = DashboardViewModel(DashboardStore(repo, backgroundScope), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.stats.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, viewModel.stats.value.phase)
        }

    @Test
    fun errorWithNoCacheIsHardErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeDashboardRepository()
            repo.emissions.value =
                listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))
            val viewModel = DashboardViewModel(DashboardStore(repo, backgroundScope), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.stats.collect {} }
            advanceUntilIdle()

            val state = viewModel.stats.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun errorWithCacheStaysStaleOfflineWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeDashboardRepository()
            repo.emissions.value =
                listOf(Resource.Loading(null, null, false), Resource.Success(statsA, 100L, false))
            val viewModel = DashboardViewModel(DashboardStore(repo, backgroundScope), NoopLogger, backgroundScope)
            backgroundScope.launch { viewModel.stats.collect {} }
            advanceUntilIdle()
            assertEquals(statsA, viewModel.stats.value.data)

            repo.emissions.value = listOf(Resource.Error(statsA, 100L, true, ApiError.Timeout()))
            viewModel.refresh()
            advanceUntilIdle()

            val state = viewModel.stats.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(statsA, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }
}
