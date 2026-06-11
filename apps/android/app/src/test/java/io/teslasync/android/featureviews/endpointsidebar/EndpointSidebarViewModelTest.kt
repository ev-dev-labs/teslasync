package io.teslasync.android.featureviews.endpointsidebar

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [EndpointSidebarViewModel] over a controllable fake [EndpointSidebarSource], covering every state
 * the surface renders (loading / content / data-empty / hard error + retry / stale-offline + retry), the
 * refresh + retry re-collection, and the PII-safe `view.opened` + refresh diagnostics (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EndpointSidebarViewModelTest {
    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenOperationsResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(success(sampleEndpoints()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(3, ui.data?.endpoints?.size)
        }

    @Test
    fun emptyWhenNoOperations() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(success(emptyList()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Error(null, null, false, ApiError.Network()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertEquals(ErrorKind.Network, ui.errorKind)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedOperationsWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(sampleEndpoints(), fetchedAt = 100L, stale = true, error = ApiError.Timeout())),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(3, ui.data?.endpoints?.size)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(ErrorKind.Timeout, ui.errorKind)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(listOf(success(sampleEndpoints()))), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "EndpointSidebar"), opened.single().second)
        }

    @Test
    fun refreshLogsAndReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(success(sampleEndpoints())))
            val vm = EndpointSidebarViewModel(source, logger, backgroundScope)

            vm.refresh()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "endpointSidebar.refresh" })
            assertEquals(1, source.refreshCount)
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(sampleEndpoints())))
            val vm = EndpointSidebarViewModel(source, NoopLogger, backgroundScope)

            vm.retry()
            advanceUntilIdle()

            assertEquals(1, source.refreshCount)
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: EndpointSidebarSource,
        logger: Logger = NoopLogger,
    ): EndpointSidebarViewModel = EndpointSidebarViewModel(source, logger, backgroundScope)

    private fun success(endpoints: List<ParsedEndpoint>): Resource<List<ParsedEndpoint>> =
        Resource.Success(endpoints, fetchedAt = 100L, stale = false)

    private fun sampleEndpoints(): List<ParsedEndpoint> =
        listOf(
            ParsedEndpoint(HttpMethod.Get, "/vehicles", "Vehicles", "List vehicles", operationId = "listVehicles"),
            ParsedEndpoint(HttpMethod.Get, "/charging", "Charging", "List charging sessions", operationId = "listCharging"),
            ParsedEndpoint(HttpMethod.Delete, "/alerts/rules/{ruleID}", "Alerts", "Delete rule", operationId = "deleteRule"),
        )

    private class FakeSource(
        private val emissions: List<Resource<List<ParsedEndpoint>>>,
    ) : EndpointSidebarSource {
        var refreshCount = 0
            private set

        override fun endpoints(): Flow<Resource<List<ParsedEndpoint>>> = emissions.asFlow()

        override suspend fun refresh() {
            refreshCount++
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
}
