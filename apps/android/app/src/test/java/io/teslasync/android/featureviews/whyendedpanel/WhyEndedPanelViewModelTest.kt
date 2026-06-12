package io.teslasync.android.featureviews.whyendedpanel

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [WhyEndedPanelViewModel] over a controllable fake [WhyEndedPanelSource], covering the lazy
 * collapsed/expanded gate the web component owns (web/src/features/.../WhyEndedPanel.tsx +
 * web/src/api/hooks/useDriving.ts `enabled: expanded && id !== '' && id !== '0'`), the window-switch
 * re-subscription, the refresh re-fetch, and the PII-safe `view.opened` / toggle / window diagnostics. The
 * view never performs HTTP — every fetch flows through the fake source.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WhyEndedPanelViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : WhyEndedPanelSource {
        val calls = mutableListOf<Pair<String, String>>()
        val emissions = mutableMapOf<String, List<Resource<JsonElement>>>()

        override fun driveWhyEnded(
            driveId: String,
            window: String,
        ): Flow<Resource<JsonElement>> {
            calls += driveId to window
            return flow { (emissions[window] ?: listOf(loading())).forEach { emit(it) } }
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
    fun collapsedByDefaultOpensNoFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src, driveId = "42")
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertFalse(vm.state.value.expanded)
            assertNull(vm.state.value.resource)
            assertTrue("collapsed must not query the source", src.calls.isEmpty())
        }

    @Test
    fun expandingFiresTheLazyFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions["60s"] = listOf(Resource.Success(payload(), 100L, false))
            val vm = viewModel(src, driveId = "42")
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.toggleExpanded()
            advanceUntilIdle()

            assertTrue(vm.state.value.expanded)
            assertNotNull(vm.state.value.resource)
            assertTrue(src.calls.contains("42" to "60s"))
        }

    @Test
    fun invalidDriveIdNeverOpensFeedEvenWhenExpanded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions["60s"] = listOf(Resource.Success(payload(), 100L, false))
            val vm = viewModel(src, driveId = "0")
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.toggleExpanded()
            advanceUntilIdle()

            assertTrue(vm.state.value.expanded)
            assertNull("the web `id !== '0'` gate keeps the feed closed", vm.state.value.resource)
            assertTrue(src.calls.isEmpty())
        }

    @Test
    fun selectingWindowReSubscribesForTheNewWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions["60s"] = listOf(Resource.Success(payload(), 100L, false))
            src.emissions["5m"] = listOf(Resource.Success(payload(), 200L, false))
            val vm = viewModel(src, driveId = "42")
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.toggleExpanded()
            advanceUntilIdle()
            vm.selectWindow(WhyEndedWindow.Min5)
            advanceUntilIdle()

            assertEquals(WhyEndedWindow.Min5, vm.state.value.window)
            assertTrue(src.calls.contains("42" to "5m"))
            assertEquals(200L, fetchedAt(vm.state.value.resource))
        }

    @Test
    fun refreshReFetchesTheCurrentWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions["60s"] = listOf(Resource.Success(payload(), 100L, false))
            val vm = viewModel(src, driveId = "42")
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            vm.toggleExpanded()
            advanceUntilIdle()
            assertEquals(100L, fetchedAt(vm.state.value.resource))

            src.emissions["60s"] = listOf(Resource.Success(payload(), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(200L, fetchedAt(vm.state.value.resource))
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger, driveId = "42")

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "WhyEndedPanel"), opened.single().second)
        }

    @Test
    fun toggleAndWindowEmitPiiSafeDiagnostics() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger, driveId = "42")

            vm.toggleExpanded()
            vm.selectWindow(WhyEndedWindow.Min15)
            vm.refresh()

            assertTrue(logger.events.any { it.first == "whyEndedPanel.toggle" })
            assertTrue(logger.events.any { it.first == "whyEndedPanel.window" })
            assertTrue(logger.events.any { it.first == "whyEndedPanel.refresh" })
            // The window token is locale-invariant config, never PII; no value/trigger may ever be logged.
            assertFalse(logger.events.any { it.second.containsKey("value") })
            assertFalse(logger.events.any { it.second.containsKey("trigger") })
        }

    private fun TestScope.viewModel(
        source: WhyEndedPanelSource,
        logger: Logger = NoopLogger,
        driveId: String = "42",
    ): WhyEndedPanelViewModel = WhyEndedPanelViewModel(source, logger, driveId, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun fetchedAt(resource: Resource<JsonElement>?): Long? = (resource as? Resource.Success)?.fetchedAt

        fun payload(): JsonElement =
            Json.parseToJsonElement(
                """{ "fsm_transitions": [], "signal_window": [] }""",
            )
    }
}
