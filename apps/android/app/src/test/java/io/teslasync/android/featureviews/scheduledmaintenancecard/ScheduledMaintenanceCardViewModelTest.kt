package io.teslasync.android.featureviews.scheduledmaintenancecard

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Drives [ScheduledMaintenanceCardViewModel] over a controllable fake [ScheduledMaintenanceSource], covering
 * the cache-then-network state matrix the maintenance read can be in (loading / content / hard error + retry /
 * stale-offline + retry), both mutations' typed [MaintenanceToast] + the exact [MaintenanceUpdateInput] they
 * write (schedule → `mode=maintenance` + computed `until`; clear → `mode=ok` + null `until`), the in-flight
 * flags, and the PII-safe `view.opened` + refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/system/components/status/ScheduledMaintenanceCard.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduledMaintenanceCardViewModelTest {
    private val now: Long = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()

    private fun maintenanceJson(mode: String): JsonObject = JsonObject(mapOf("mode" to JsonPrimitive(mode)))

    // ── maintenance-state matrix ─────────────────────────────────────────────────────

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.maintenanceState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.maintenanceState.value.phase)
        }

    @Test
    fun contentWhenStatePresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(maintenanceJson("maintenance"), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.maintenanceState.collect {} }
            advanceUntilIdle()

            val state = vm.maintenanceState.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("maintenance", state.data?.mode)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun okStateStillResolvesToContentNeverEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            // Web parity: the panel always renders (the scheduler IS the friendly not-active content).
            val vm = viewModel(FakeSource(listOf(Resource.Success(maintenanceJson("ok"), 100L, false))))
            backgroundScope.launch { vm.maintenanceState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.maintenanceState.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.maintenanceState.collect {} }
            advanceUntilIdle()

            val state = vm.maintenanceState.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.canRetry)
            assertFalse(state.hasData)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(maintenanceJson("maintenance"), 100L, true, ApiError.Timeout())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.maintenanceState.collect {} }
            advanceUntilIdle()

            val state = vm.maintenanceState.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("maintenance", state.data?.mode)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    // ── schedule ─────────────────────────────────────────────────────────────────────

    @Test
    fun scheduleWritesMaintenanceModeWithComputedUntilAndRaisesSavedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("ok"), 1L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.schedule(durationMinutes = 60, message = "DB upgrade")
            advanceUntilIdle()

            assertEquals(1, src.updateCount)
            val input = src.lastInput
            assertEquals("maintenance", input?.mode)
            assertEquals("DB upgrade", input?.message)
            assertEquals(Instant.ofEpochMilli(now + 60L * 60_000L).toString(), input?.until)
            assertEquals(listOf<MaintenanceToast>(MaintenanceToast.Saved), received)
            assertFalse(vm.actions.value.scheduling)
        }

    @Test
    fun scheduleFloorsDurationToTheMinimum() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("ok"), 1L, false)))
            val vm = viewModel(src)

            vm.schedule(durationMinutes = 2, message = "")
            advanceUntilIdle()

            // 2 min is below the 5-min floor (web `Math.max(5, …)`); the write must reflect 5 min.
            val expected = Instant.ofEpochMilli(now + ScheduledMaintenanceCardViewModel.MIN_DURATION_MINUTES * 60_000L).toString()
            assertEquals(expected, src.lastInput?.until)
        }

    @Test
    fun scheduleWithBlankMessageOmitsIt() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("ok"), 1L, false)))
            val vm = viewModel(src)

            vm.schedule(durationMinutes = 30, message = "   ")
            advanceUntilIdle()

            assertNull(src.lastInput?.message)
        }

    @Test
    fun scheduleFailureRaisesFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("ok"), 1L, false)))
            src.updateResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.schedule(durationMinutes = 60, message = "x")
            advanceUntilIdle()

            assertEquals(listOf<MaintenanceToast>(MaintenanceToast.Failed), received)
            assertFalse(vm.actions.value.scheduling)
        }

    // ── clear ──────────────────────────────────────────────────────────────────────

    @Test
    fun clearWritesOkModeWithNullUntilAndRaisesSavedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("maintenance"), 1L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.clear()
            advanceUntilIdle()

            assertEquals(1, src.updateCount)
            assertEquals("ok", src.lastInput?.mode)
            assertEquals("", src.lastInput?.message)
            assertNull(src.lastInput?.until)
            assertEquals(listOf<MaintenanceToast>(MaintenanceToast.Saved), received)
            assertFalse(vm.actions.value.clearing)
        }

    @Test
    fun clearFailureRaisesFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(maintenanceJson("maintenance"), 1L, false)))
            src.updateResult = Result.failure(ApiError.Timeout())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.clear()
            advanceUntilIdle()

            assertEquals(listOf<MaintenanceToast>(MaintenanceToast.Failed), received)
        }

    // ── diagnostics ──────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ScheduledMaintenanceCard"), opened.single().second)
        }

    @Test
    fun retryEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "scheduledMaintenance.refresh" })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.collectToasts(vm: ScheduledMaintenanceCardViewModel): List<MaintenanceToast> {
        val received = mutableListOf<MaintenanceToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: ScheduledMaintenanceSource,
        logger: Logger = NoopLogger,
    ): ScheduledMaintenanceCardViewModel = ScheduledMaintenanceCardViewModel(source, logger, { now }, backgroundScope)

    private class FakeSource(
        private val emissions: List<Resource<JsonElement>>,
    ) : ScheduledMaintenanceSource {
        var updateResult: Result<Unit> = Result.success(Unit)
        var updateCount = 0
            private set
        var lastInput: MaintenanceUpdateInput? = null
            private set

        override fun maintenanceState(): Flow<Resource<JsonElement>> = flow { emissions.forEach { emit(it) } }

        override suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<Unit> {
            updateCount++
            lastInput = input
            return updateResult
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
