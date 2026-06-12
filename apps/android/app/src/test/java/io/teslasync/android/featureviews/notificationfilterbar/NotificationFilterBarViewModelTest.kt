package io.teslasync.android.featureviews.notificationfilterbar

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.AlertRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [NotificationFilterBarViewModel] over a controllable fake [NotificationFilterBarSource], covering
 * the full cache-then-network state matrix the surface renders (loading / content with rules / content with
 * NO rules / hard error + retry / stale-offline + retry / refresh re-fetch) and the PII-safe `view.opened` +
 * refresh diagnostics. An empty rule list maps to content (not empty) — the bar's own empty state is the
 * caller-owned active filters, so the rule payload is never "empty" here.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationFilterBarViewModelTest {
    private fun rule(
        id: Long,
        name: String,
    ): AlertRule = AlertRule(id = id, name = name)

    private val rules = listOf(rule(7, "Low Battery"), rule(9, "Sentry Triggered"))

    private class FakeSource(
        var emissions: List<Resource<List<AlertRule>>>,
    ) : NotificationFilterBarSource {
        override fun streamRules(): Flow<Resource<List<AlertRule>>> = flow { emissions.forEach { emit(it) } }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenRulesPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(rules, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(rules, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyRuleListIsStillContentNotEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // The bar must stay usable with no rules (web `rules ?? []`), so it is Content.
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(emptyList<AlertRule>(), vm.state.value.data)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(rules, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(rules, vm.state.value.data)

            src.emissions = listOf(Resource.Error(rules, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(rules, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedRules() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = rules + rule(11, "Tire Pressure Low")
            val src = FakeSource(listOf(Resource.Success(rules, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(rules, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "NotificationFilterBar"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "notificationFilterBar.refresh" })
        }

    private fun TestScope.viewModel(
        source: NotificationFilterBarSource,
        logger: Logger = NoopLogger,
    ): NotificationFilterBarViewModel = NotificationFilterBarViewModel(source, logger, backgroundScope)
}
