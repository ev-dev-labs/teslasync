package io.teslasync.android.dashboard.widgets.telemetryerrors

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
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
 * Drives [TelemetryErrorsWidgetViewModel] over a controllable fake [TelemetryErrorsSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content / empty with
 * no data / hard error + retry / stale-offline + retry / refresh re-fetch) and the PII-safe
 * `view.opened` + refresh diagnostics.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryErrorsWidgetViewModelTest {
    private val withErrors =
        TelemetryErrorsData(
            errorVins = listOf(FleetTelemetryErrorVIN(vin = "5YJ3E1EA1KF000001", active = true)),
            errors =
                listOf(
                    FleetTelemetryError(
                        vin = "5YJ3E1EA1KF000001",
                        errorCode = "STREAM_DISCONNECTED",
                        reportedAt = "2026-06-11T12:00:00Z",
                        fetchedAt = "2026-06-11T12:00:00Z",
                    ),
                ),
        )

    private class FakeSource(
        var emissions: List<Resource<TelemetryErrorsData>>,
    ) : TelemetryErrorsSource {
        override fun stream(): Flow<Resource<TelemetryErrorsData>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenErrorsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(withErrors, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withErrors, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoData() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(TelemetryErrorsData.EMPTY, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
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
            val src = FakeSource(listOf(Resource.Success(withErrors, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withErrors, vm.state.value.data)

            src.emissions = listOf(Resource.Error(withErrors, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withErrors, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedData() =
        runTest(UnconfinedTestDispatcher()) {
            val updated =
                withErrors.copy(
                    errors =
                        withErrors.errors +
                            FleetTelemetryError(
                                vin = "5YJ3E1EA1KF000001",
                                errorCode = "GATEWAY_TIMEOUT",
                                reportedAt = null,
                                fetchedAt = "2026-06-11T13:00:00Z",
                            ),
                )
            val src = FakeSource(listOf(Resource.Success(withErrors, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withErrors, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TelemetryErrorsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "telemetryErrors.refresh" })
        }

    private fun TestScope.viewModel(
        source: TelemetryErrorsSource,
        logger: Logger = NoopLogger,
    ): TelemetryErrorsWidgetViewModel = TelemetryErrorsWidgetViewModel(source, logger, backgroundScope)
}
