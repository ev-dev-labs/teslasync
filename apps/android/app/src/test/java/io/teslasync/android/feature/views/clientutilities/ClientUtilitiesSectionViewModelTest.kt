package io.teslasync.android.feature.views.clientutilities

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
 * Drives [ClientUtilitiesSectionViewModel] over a controllable fake [ClientUtilitiesSource], covering every
 * state the surface renders (loading / content / data-empty / hard error + retry / stale-offline + retry),
 * the refresh + retry re-collection, and the PII-safe `view.opened` + refresh diagnostics (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClientUtilitiesSectionViewModelTest {
    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenCatalogResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(success(ClientUtilitiesCatalog.tools))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(15, ui.data?.tools?.size)
        }

    @Test
    fun emptyWhenNoTools() =
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
    fun offlineKeepsCachedRegistryWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(ClientUtilitiesCatalog.tools, fetchedAt = 100L, stale = true, error = ApiError.Timeout())),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(15, ui.data?.tools?.size)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(ErrorKind.Timeout, ui.errorKind)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(listOf(success(ClientUtilitiesCatalog.tools))), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ClientUtilitiesSection"), opened.single().second)
        }

    @Test
    fun refreshLogsAndReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(success(ClientUtilitiesCatalog.tools)))
            val vm = ClientUtilitiesSectionViewModel(source, logger, backgroundScope)

            vm.refresh()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "clientUtilities.refresh" })
            assertEquals(1, source.refreshCount)
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(ClientUtilitiesCatalog.tools)))
            val vm = ClientUtilitiesSectionViewModel(source, NoopLogger, backgroundScope)

            vm.retry()
            advanceUntilIdle()

            assertEquals(1, source.refreshCount)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: ClientUtilitiesSource,
        logger: Logger = NoopLogger,
    ): ClientUtilitiesSectionViewModel = ClientUtilitiesSectionViewModel(source, logger, backgroundScope)

    private fun success(tools: List<ClientUtilityTool>): Resource<List<ClientUtilityTool>> =
        Resource.Success(tools, fetchedAt = 100L, stale = false)

    private class FakeSource(
        private val emissions: List<Resource<List<ClientUtilityTool>>>,
    ) : ClientUtilitiesSource {
        var refreshCount = 0
            private set

        override fun tools(): Flow<Resource<List<ClientUtilityTool>>> = emissions.asFlow()

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
