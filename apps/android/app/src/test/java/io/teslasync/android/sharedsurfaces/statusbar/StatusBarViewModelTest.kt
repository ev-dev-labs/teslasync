package io.teslasync.android.sharedsurfaces.statusbar

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
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
 * Drives [StatusBarViewModel] over a controllable fake [StatusBarSource], covering the full lifecycle the
 * web container's persisted preferences render: a first hydrate → loading, resolved prefs → content, a
 * disabled bar → the empty phase, a hard read failure → error, cached prefs after a failed read → the
 * offline (stale + cached) surface, the show/hide + icon-only writes delegating to the store, a retry
 * re-hydrating the source, and the PII-safe `view.opened` + `statusBar.refresh` diagnostics — end to end
 * through the real `toUiState` projection. The VM's feed is `WhileSubscribed`, so each case keeps an active
 * collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StatusBarViewModelTest {
    private class FakeStatusBarSource(
        initial: Resource<StatusBarPreferences> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : StatusBarSource {
        val feed = MutableStateFlow(initial)
        var hydrateCalls: Int = 0
        var lastEnabled: Boolean? = null
        var lastIconOnly: Boolean? = null

        override fun preferences(): Flow<Resource<StatusBarPreferences>> = feed

        override fun hydrate() {
            hydrateCalls++
        }

        override fun setEnabled(enabled: Boolean) {
            lastEnabled = enabled
        }

        override fun setIconOnly(iconOnly: Boolean) {
            lastIconOnly = iconOnly
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
    fun loadingResolvesToContentWhenPrefsArrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStatusBarSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.feed.value = Resource.Success(prefs(enabled = true), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()
            val resolved = vm.state.value
            assertEquals(UiPhase.Content, resolved.phase)
            assertEquals(true, resolved.data?.enabled)
        }

    @Test
    fun disabledBarMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStatusBarSource(Resource.Success(prefs(enabled = false), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeStatusBarSource(
                    Resource.Error(cached = null, fetchedAt = null, stale = false, error = IllegalStateException("x")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCachedPrefsKeepsThemAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeStatusBarSource(
                    Resource.Error(
                        cached = prefs(enabled = true),
                        fetchedAt = STAMP,
                        stale = true,
                        error = IllegalStateException("read"),
                    ),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(StatusBarFreshness.Offline, StatusBarProjection.freshness(state))
        }

    @Test
    fun setEnabledAndSetIconOnlyDelegateToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStatusBarSource(Resource.Success(prefs(enabled = true), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)

            vm.setEnabled(false)
            vm.setIconOnly(true)

            assertEquals(false, source.lastEnabled)
            assertEquals(true, source.lastIconOnly)
        }

    @Test
    fun retryReHydratesTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeStatusBarSource(Resource.Success(prefs(enabled = true), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            // The VM hydrates once on construction.
            assertEquals(1, source.hydrateCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.hydrateCalls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                viewModel(
                    FakeStatusBarSource(Resource.Success(prefs(enabled = true), fetchedAt = STAMP, stale = false)),
                    logger,
                )
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "statusBar.refresh" }
            assertEquals(mapOf("surface" to "StatusBar"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                viewModel(
                    FakeStatusBarSource(Resource.Success(prefs(enabled = true), fetchedAt = STAMP, stale = false)),
                    logger,
                )

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "StatusBar"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: StatusBarSource,
        logger: Logger = NoopLogger,
    ): StatusBarViewModel = StatusBarViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: StatusBarViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private fun prefs(
        enabled: Boolean,
        iconOnly: Boolean = false,
    ): StatusBarPreferences = StatusBarPreferences(enabled = enabled, iconOnly = iconOnly)

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
