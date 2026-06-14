package io.teslasync.android.featureviews.fleettelemetryhealth

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [FleetTelemetryHealthViewModel] over a controllable fake [FleetTelemetryHealthSource], covering
 * the full cache-then-network state matrix each card renders (loading / content / empty / hard error +
 * retry / stale-offline + retry), the VIN filter that scopes the errors feed (web `selectedVin`,
 * including toggle-off and clear), the two "Refresh from Tesla" mutations (pending flag + re-fetch on
 * success, pending-cleared on failure), and the PII-safe `view.opened` + refresh diagnostics.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetTelemetryHealthViewModelTest {
    private val withVins =
        listOf(
            FleetTelemetryErrorVIN(
                id = 1,
                vin = "5YJ3E1EA1KF000001",
                active = true,
                firstSeenAt = "2026-06-01T00:00:00Z",
                lastSeenAt = "2026-06-11T00:00:00Z",
            ),
        )

    private val allErrors =
        listOf(
            FleetTelemetryError(id = 1, vin = "5YJ3E1EA1KF000001", errorCode = "STREAM_DISCONNECTED", reportedAt = "2026-06-11T12:00:00Z"),
            FleetTelemetryError(id = 2, vin = "5YJ3E1EA1KF000002", errorCode = "GATEWAY_TIMEOUT", reportedAt = "2026-06-11T11:00:00Z"),
        )

    private val filteredErrors = listOf(allErrors[0])

    private class FakeSource : FleetTelemetryHealthSource {
        @Volatile var vinsEmissions: List<Resource<List<FleetTelemetryErrorVIN>>> = listOf(Resource.Loading(null, null, false))

        @Volatile var errorsFor: (String?) -> List<Resource<List<FleetTelemetryError>>> = { listOf(Resource.Loading(null, null, false)) }

        @Volatile var refreshVinsResult: Result<Unit> = Result.success(Unit)

        @Volatile var refreshErrorsResult: Result<Unit> = Result.success(Unit)

        var refreshVinsCalls = 0
        var refreshErrorsCalls = 0
        val errorsVinsRequested = mutableListOf<String?>()

        override fun errorVins(): Flow<Resource<List<FleetTelemetryErrorVIN>>> = flow { vinsEmissions.forEach { emit(it) } }

        override fun errors(vin: String?): Flow<Resource<List<FleetTelemetryError>>> =
            flow {
                errorsVinsRequested += vin
                errorsFor(vin).forEach { emit(it) }
            }

        override suspend fun refreshErrorVins(): Result<Unit> {
            refreshVinsCalls++
            return refreshVinsResult
        }

        override suspend fun refreshErrors(): Result<Unit> {
            refreshErrorsCalls++
            return refreshErrorsResult
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

    // ── VIN feed state matrix ─────────────────────────────────────────────────────────────────────────

    @Test
    fun vinsLoadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource().apply { vinsEmissions = listOf(Resource.Loading(null, null, false)) })
            collect(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.vinsState.value.phase)
        }

    @Test
    fun vinsContentWhenPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Loading(null, null, false), Resource.Success(withVins, 100L, false))
                }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.vinsState.value.phase)
            assertEquals(withVins, vm.vinsState.value.data)
            assertEquals(100L, vm.vinsState.value.fetchedAt)
        }

    @Test
    fun vinsEmptyWhenNoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource().apply { vinsEmissions = listOf(Resource.Success(emptyList(), 100L, false)) })
            collect(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.vinsState.value.phase)
        }

    @Test
    fun vinsHardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))
                }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.vinsState.value.phase)
            assertEquals(ErrorKind.Network, vm.vinsState.value.errorKind)
            assertTrue(vm.vinsState.value.canRetry)
        }

    @Test
    fun vinsStaleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource().apply { vinsEmissions = listOf(Resource.Success(withVins, 100L, false)) }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()
            assertEquals(withVins, vm.vinsState.value.data)

            src.vinsEmissions = listOf(Resource.Error(withVins, 100L, true, ApiError.Timeout()))
            vm.retryVins()
            advanceUntilIdle()

            val state = vm.vinsState.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withVins, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    // ── Errors feed + VIN filter (web selectedVin) ────────────────────────────────────────────────────

    @Test
    fun errorsFeedFiltersBySelectedVinAndTogglesOff() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Success(withVins, 100L, false))
                    errorsFor = { vin ->
                        when (vin) {
                            "5YJ3E1EA1KF000001" -> listOf(Resource.Success(filteredErrors, 100L, false))
                            else -> listOf(Resource.Success(allErrors, 100L, false))
                        }
                    }
                }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()
            assertEquals(allErrors, vm.errorsState.value.data)

            vm.selectVin("5YJ3E1EA1KF000001")
            advanceUntilIdle()
            assertEquals("5YJ3E1EA1KF000001", vm.selectedVin.value)
            assertEquals(filteredErrors, vm.errorsState.value.data)
            assertTrue(src.errorsVinsRequested.contains("5YJ3E1EA1KF000001"))

            vm.selectVin("5YJ3E1EA1KF000001")
            advanceUntilIdle()
            assertEquals("", vm.selectedVin.value)
            assertEquals(allErrors, vm.errorsState.value.data)
        }

    @Test
    fun clearVinResetsFilterToAll() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Success(withVins, 100L, false))
                    errorsFor = { vin ->
                        if (vin == null) {
                            listOf(Resource.Success(allErrors, 100L, false))
                        } else {
                            listOf(Resource.Success(filteredErrors, 100L, false))
                        }
                    }
                }
            val vm = viewModel(src)
            collect(vm)
            vm.selectVin("5YJ3E1EA1KF000001")
            advanceUntilIdle()
            assertEquals("5YJ3E1EA1KF000001", vm.selectedVin.value)

            vm.clearVin()
            advanceUntilIdle()
            assertEquals("", vm.selectedVin.value)
            assertEquals(allErrors, vm.errorsState.value.data)
        }

    // ── "Refresh from Tesla" mutations ────────────────────────────────────────────────────────────────

    @Test
    fun refreshVinsRunsMutationAndRefetches() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = withVins + FleetTelemetryErrorVIN(id = 2, vin = "5YJ3E1EA1KF000002", active = true)
            val src = FakeSource().apply { vinsEmissions = listOf(Resource.Success(withVins, 100L, false)) }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()
            assertEquals(withVins, vm.vinsState.value.data)

            src.vinsEmissions = listOf(Resource.Success(updated, 200L, false))
            vm.refreshVins()
            advanceUntilIdle()

            assertEquals(1, src.refreshVinsCalls)
            assertFalse(vm.vinsRefreshing.value)
            assertEquals(updated, vm.vinsState.value.data)
        }

    @Test
    fun refreshVinsClearsPendingAndDoesNotRefetchOnFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Success(withVins, 100L, false))
                    refreshVinsResult = Result.failure(RuntimeException("boom"))
                }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()

            src.vinsEmissions = listOf(Resource.Success(emptyList(), 200L, false))
            vm.refreshVins()
            advanceUntilIdle()

            assertEquals(1, src.refreshVinsCalls)
            assertFalse(vm.vinsRefreshing.value)
            // The trigger is not bumped on failure, so the cached rows stay visible (no re-fetch).
            assertEquals(withVins, vm.vinsState.value.data)
        }

    @Test
    fun refreshErrorsRunsMutationAndRefetches() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vinsEmissions = listOf(Resource.Success(withVins, 100L, false))
                    errorsFor = { listOf(Resource.Success(allErrors, 100L, false)) }
                }
            val vm = viewModel(src)
            collect(vm)
            advanceUntilIdle()

            src.errorsFor = { listOf(Resource.Success(filteredErrors, 200L, false)) }
            vm.refreshErrors()
            advanceUntilIdle()

            assertEquals(1, src.refreshErrorsCalls)
            assertFalse(vm.errorsRefreshing.value)
            assertEquals(filteredErrors, vm.errorsState.value.data)
        }

    // ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "FleetTelemetryHealth"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvents() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.refreshVins()
            vm.refreshErrors()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "fleetTelemetryHealth.refreshVins" })
            assertTrue(logger.events.any { it.first == "fleetTelemetryHealth.refreshErrors" })
        }

    private fun TestScope.collect(vm: FleetTelemetryHealthViewModel) {
        backgroundScope.launch { vm.vinsState.collect {} }
        backgroundScope.launch { vm.errorsState.collect {} }
    }

    private fun TestScope.viewModel(
        source: FleetTelemetryHealthSource,
        logger: Logger = NoopLogger,
    ): FleetTelemetryHealthViewModel = FleetTelemetryHealthViewModel(source, logger, backgroundScope)
}
