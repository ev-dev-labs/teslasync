package io.teslasync.android.sharedsurfaces.bottomtabbar

import io.teslasync.android.data.NoopLogger
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
import org.junit.Test

/**
 * Drives [BottomTabBarViewModel] over a controllable fake [BottomTabBarSource], covering the route feed the web
 * component reads via `useLocation()`: the current path is re-shared (and normalized) as a lifecycle-aware
 * flow, route changes flow through, and the PII-safe `view.opened` diagnostic is emitted exactly once with the
 * surface slug. The VM's `currentPath` is a `WhileSubscribed` feed, so each case keeps an active collector
 * alive on the background scope. Runs in the :app:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BottomTabBarViewModelTest {
    private class FakeSource(
        initial: String,
    ) : BottomTabBarSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun currentPath(): Flow<String> {
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
    fun currentPathReflectsTheSourceRoute() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource("/charging"))
            observe(vm)
            advanceUntilIdle()
            assertEquals("/charging", vm.currentPath.value)
        }

    @Test
    fun currentPathNormalizesTrailingSlashAndQuery() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource("/charging/?tab=sessions"))
            observe(vm)
            advanceUntilIdle()
            assertEquals("/charging", vm.currentPath.value)
        }

    @Test
    fun currentPathUpdatesWhenTheRouteChanges() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource("/")
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals("/", vm.currentPath.value)

            source.flow.value = "/drives/42"
            advanceUntilIdle()
            assertEquals("/drives/42", vm.currentPath.value)
        }

    @Test
    fun boundSourceProjectsToTheExpectedActiveTab() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource("/battery"))
            observe(vm)
            advanceUntilIdle()

            val display = BottomTabBarProjection.project(vm.currentPath.value, strings())
            assertEquals(BottomTab.Battery, display.activeTab)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource("/"), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "BottomTabBar"), opened.single().second)
        }

    private fun strings(): BottomTabBarStrings =
        BottomTabBarStrings(
            navLabel = "Quick navigation",
            dashboard = "Dashboard",
            drives = "Drives",
            charging = "Charging",
            battery = "Battery Health",
            liveMap = "Live Map",
        )

    private fun TestScope.viewModel(
        source: BottomTabBarSource,
        logger: Logger = NoopLogger,
    ): BottomTabBarViewModel = BottomTabBarViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: BottomTabBarViewModel) {
        backgroundScope.launch { vm.currentPath.collect {} }
    }
}
