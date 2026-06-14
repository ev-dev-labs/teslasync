// Tests [NotionSidebarViewModel] against the [NotionSidebarSource] seam — the state-holder binding the P3
// contract mandates: the current-route feed routed from the bound source while observed (normalized so a query
// string / trailing slash never flips an entry's active state), the root fallback before the feed emits, the
// router-Destination adapter, and the one-shot PII-safe `view.opened` diagnostic (slug only, never the route).
// The framework-free projection is covered by NotionSidebarModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotionSidebarViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    @Test
    fun currentPathResolvesAndNormalizesTheBoundRouteWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                NotionSidebarViewModel(
                    source = notionSidebarSource { flowOf("/charging/123?tab=1") },
                    logger = RecordingLogger(),
                    scope = backgroundScope,
                )
            observe(vm)

            assertEquals("/charging/123", vm.currentPath.value)
        }

    @Test
    fun currentPathFallsBackToRootBeforeTheFeedEmits() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                NotionSidebarViewModel(
                    source = notionSidebarSource { emptyFlow() },
                    logger = RecordingLogger(),
                    scope = backgroundScope,
                )

            assertEquals(NotionSidebarProjection.ROOT_PATH, vm.currentPath.value)
        }

    @Test
    fun routerDestinationAdapterTracksTheDestinationWebPath() =
        runTest(UnconfinedTestDispatcher()) {
            val destination = Destinations.require("charging")
            val vm =
                NotionSidebarViewModel(
                    source = flowOf(destination).asNotionSidebarSource(),
                    logger = RecordingLogger(),
                    scope = backgroundScope,
                )
            observe(vm)

            assertEquals(destination.webPath, vm.currentPath.value)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                NotionSidebarViewModel(
                    source = notionSidebarSource { flowOf("/") },
                    logger = logger,
                    scope = backgroundScope,
                )

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("NotionSidebar", opened.single().fields["surface"])
        }

    private fun TestScope.observe(vm: NotionSidebarViewModel) {
        backgroundScope.launch { vm.currentPath.collect {} }
        advanceUntilIdle()
    }
}
