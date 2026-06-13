package io.teslasync.android.sharedsurfaces.usercell

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.User
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [UserCellViewModel] over a controllable fake [UserCellSource], covering the full lifecycle the web
 * component + the bound current-user feed render: a first load → loading, a resolved user → content, an
 * unattributable user → the em-dash empty phase, a hard error → error, a cached value after a failed refresh
 * → the offline (stale + cached) surface, retry re-collecting the source, and the PII-safe `view.opened` +
 * `userCell.refresh` diagnostics — end to end through the real `toUiState` projection. The VM's `state` is a
 * `WhileSubscribed` feed, so each case keeps an active collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UserCellViewModelTest {
    private class FakeSource(
        initial: Resource<User>,
    ) : UserCellSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun currentUser(): Flow<Resource<User>> {
            calls++
            return flow
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingResolvesToContentWhenTheUserArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.flow.value = Resource.Success(User(id = "u1", email = "ada@x.io", displayName = "Ada"), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("Ada", state.data?.displayName)
        }

    @Test
    fun unattributableUserMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(User(), fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCacheKeepsIdentityAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = User(id = "u1", displayName = "Ada")
            val source = FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals("Ada", state.data?.displayName)
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(User(displayName = "Ada"), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.calls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.calls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(User(displayName = "Ada"), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "userCell.refresh" }
            assertEquals(mapOf("surface" to "UserCell"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(User(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "UserCell"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: UserCellSource,
        logger: Logger = NoopLogger,
    ): UserCellViewModel = UserCellViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: UserCellViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
