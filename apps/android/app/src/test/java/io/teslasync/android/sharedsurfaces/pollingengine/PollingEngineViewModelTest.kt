package io.teslasync.android.sharedsurfaces.pollingengine

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
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
 * Drives [PollingEngineViewModel] over a controllable fake [PollingEngineSource], covering the two feeds'
 * cache-then-network lifecycle the surface renders — loading → content, the hard error, the stale/offline
 * envelope projected through [PollingProjection] — plus retry re-fetching both feeds, and the PII-safe
 * `view.opened` / `pollingEngine.refresh` diagnostics (P1/S11 — surface slug only, never a VIN or cost). The
 * view never performs HTTP; every read flows through the fake source. Runs in the offline
 * `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PollingEngineViewModelTest {
    @Test
    fun feedsSuccessExposeContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(status = success(enabledWithVehicle()), savings = success(savingsData())))
            collect(vm)
            advanceUntilIdle()

            assertTrue(vm.status.value.isContent)
            assertTrue(vm.status.value.hasData)
            assertTrue(vm.savings.value.hasData)
        }

    @Test
    fun firstLoadWithNoCacheExposesLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        status = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        savings = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                    ),
                )
            collect(vm)
            advanceUntilIdle()

            assertTrue(vm.status.value.isLoading)
        }

    @Test
    fun hardErrorWithNoCacheExposesError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        status = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                        savings = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                    ),
                )
            collect(vm)
            advanceUntilIdle()

            assertTrue(vm.status.value.isError)
            assertEquals(ErrorKind.Network, vm.status.value.errorKind)
        }

    @Test
    fun cachedErrorProjectsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        status =
                            Resource.Error(
                                cached = enabledWithVehicle(),
                                fetchedAt = 5L,
                                stale = true,
                                error = ApiError.Timeout(),
                            ),
                        savings = success(savingsData()),
                    ),
                )
            collect(vm)
            advanceUntilIdle()

            val display = PollingProjection.project(vm.status.value, vm.savings.value, NOW)
            assertEquals(PollingPhase.Content, display.phase)
            assertTrue(display.offline)
            assertFalse(display.stale)
        }

    @Test
    fun retryReFetchesAndEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeSource(
                    status = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                    savings = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
            val vm = viewModel(source, logger)
            collect(vm)
            advanceUntilIdle()
            assertTrue(vm.status.value.isError)
            val callsBefore = source.statusCalls

            source.status = success(enabledWithVehicle())
            vm.retry()
            advanceUntilIdle()

            assertTrue(source.statusCalls > callsBefore)
            assertTrue(vm.status.value.isContent)
            val refresh = logger.events.single { it.first == "pollingEngine.refresh" }
            assertEquals(mapOf("surface" to "PollingEngine"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnceWithNoPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(enabledWithVehicle()), success(savingsData())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "PollingEngine"), opened.single().second)
        }

    private class FakeSource(
        var status: Resource<PollingStatusData>,
        var savings: Resource<PollingSavingsData>,
    ) : PollingEngineSource {
        var statusCalls: Int = 0
        var savingsCalls: Int = 0

        override fun status(): Flow<Resource<PollingStatusData>> =
            flow {
                statusCalls++
                emit(status)
            }

        override fun savings(): Flow<Resource<PollingSavingsData>> =
            flow {
                savingsCalls++
                emit(savings)
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

    private fun TestScope.viewModel(
        source: PollingEngineSource,
        logger: Logger = RecordingLogger(),
    ): PollingEngineViewModel = PollingEngineViewModel(source, logger, backgroundScope)

    private fun TestScope.collect(vm: PollingEngineViewModel) {
        backgroundScope.launch { vm.status.collect {} }
        backgroundScope.launch { vm.savings.collect {} }
    }

    private companion object {
        const val NOW = 1_000_000_000_000L
        const val NEXT_POLL_OFFSET_MS = 5_000L

        fun enabledWithVehicle(): PollingStatusData =
            PollingStatusData(
                enabled = true,
                vehicles =
                    listOf(
                        VehiclePollingStatus(
                            vin = "5YJ3E1EA7KF000001",
                            activity = "active",
                            profile = "driving",
                            nextPollAfterEpochMs = NOW + NEXT_POLL_OFFSET_MS,
                        ),
                    ),
            )

        fun savingsData(): PollingSavingsData =
            PollingSavingsData(
                savingsPercent = 42.5,
                estimatedSavings = 12.3,
                pollsMade = 1840.0,
                remainingCredit = 5.0,
                breakdown = PollingBreakdown(fleetTelemetry = 50.0, idleDetection = 30.0, prediction = 15.0, sleep = 5.0),
            )

        fun success(data: PollingStatusData): Resource<PollingStatusData> = Resource.Success(data, fetchedAt = 1L, stale = false)

        fun success(data: PollingSavingsData): Resource<PollingSavingsData> = Resource.Success(data, fetchedAt = 1L, stale = false)
    }
}
