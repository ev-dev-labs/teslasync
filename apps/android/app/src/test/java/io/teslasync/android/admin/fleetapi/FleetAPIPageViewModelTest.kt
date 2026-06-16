package io.teslasync.android.admin.fleetapi

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.ApiSuspendResult
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.PollingConfig
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [FleetAPIPageViewModel] over a controllable fake source, covering the four feeds' state matrix
 * (settings / polling-config / version loading → content / empty / error), the two mutations with their toast
 * outcomes (suspend/resume, save polling config), the no-op guard when the config has not loaded, the retry
 * re-subscribe, and the one-shot `view.opened` diagnostic. Runs in the offline unit-test gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetAPIPageViewModelTest {
    private class FakeFleetApiSource : FleetApiSource {
        var settingsFlow: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(buildJsonObject { put("api_suspended", false) }, 1L, false))
        var pollingFlow: Flow<Resource<PollingConfig>> = flowOf(Resource.Success(PollingConfig(), 1L, false))
        var captureFlow: Flow<Resource<CaptureStats>> = flowOf(Resource.Success(CaptureStats(), 1L, false))
        var versionFlow: Flow<Resource<VersionInfo>> = flowOf(Resource.Success(VersionInfo(), 1L, false))
        var suspendResult: Result<ApiSuspendResult> = Result.success(ApiSuspendResult(true))
        var pollingResult: Result<PollingConfig> = Result.success(PollingConfig())

        var settingsCalls = 0
        val suspendCalls = mutableListOf<Boolean>()
        val pollingSaves = mutableListOf<PollingConfig>()

        override fun settings(): Flow<Resource<JsonElement>> = settingsFlow.also { settingsCalls++ }

        override fun pollingConfig(): Flow<Resource<PollingConfig>> = pollingFlow

        override fun captureStats(): Flow<Resource<CaptureStats>> = captureFlow

        override fun versionInfo(): Flow<Resource<VersionInfo>> = versionFlow

        override suspend fun toggleApiSuspend(suspended: Boolean): Result<ApiSuspendResult> =
            suspendResult.also { suspendCalls += suspended }

        override suspend fun updatePollingConfig(config: PollingConfig): Result<PollingConfig> =
            pollingResult.also { pollingSaves += config }
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
        source: FleetApiSource = FakeFleetApiSource(),
        logger: Logger = RecordingLogger(),
    ): FleetAPIPageViewModel = FleetAPIPageViewModel(source, logger, scope = backgroundScope)

    @Test
    fun settingsLoadsContentWithParsedSuspendFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource().apply {
                settingsFlow = flowOf(Resource.Success(buildJsonObject { put("api_suspended", true) }, 1L, false))
            }
            val vm = viewModel(source = source)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.settings.value.phase)
            assertTrue(vm.settings.value.data?.apiSuspended == true)
        }

    @Test
    fun versionWithEndpointsIsContentAndEmptyWhenNone() =
        runTest(UnconfinedTestDispatcher()) {
            val withEndpoints = FakeFleetApiSource().apply {
                versionFlow = flowOf(Resource.Success(VersionInfo(endpoints = mapOf("api" to "https://api")), 1L, false))
            }
            val vmContent = viewModel(source = withEndpoints)
            backgroundScope.launch { vmContent.version.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vmContent.version.value.phase)

            val vmEmpty = viewModel(source = FakeFleetApiSource())
            backgroundScope.launch { vmEmpty.version.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vmEmpty.version.value.phase)
        }

    @Test
    fun versionHardErrorSurfacesErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource().apply {
                versionFlow = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            }
            val vm = viewModel(source = source)
            backgroundScope.launch { vm.version.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.version.value.phase)
            assertTrue(vm.version.value.hasError)
        }

    @Test
    fun setSuspendedTrueCallsSourceAndRaisesSuspendedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource()
            val vm = viewModel(source = source)
            val toasts = mutableListOf<FleetApiToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            vm.setSuspended(true)
            advanceUntilIdle()
            assertEquals(listOf(true), source.suspendCalls)
            assertTrue(toasts.contains(FleetApiToast.ApiSuspended))
        }

    @Test
    fun setSuspendedFalseRaisesResumedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource().apply { suspendResult = Result.success(ApiSuspendResult(false)) }
            val vm = viewModel(source = source)
            val toasts = mutableListOf<FleetApiToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            vm.setSuspended(false)
            advanceUntilIdle()
            assertTrue(toasts.contains(FleetApiToast.ApiResumed))
        }

    @Test
    fun setSuspendedFailureRaisesSuspendFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource().apply { suspendResult = Result.failure(RuntimeException("nope")) }
            val vm = viewModel(source = source)
            val toasts = mutableListOf<FleetApiToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            vm.setSuspended(true)
            advanceUntilIdle()
            assertTrue(toasts.contains(FleetApiToast.SuspendFailed))
        }

    @Test
    fun toggleEndpointSavesFlippedConfigAndRaisesUpdatedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource()
            val vm = viewModel(source = source)
            backgroundScope.launch { vm.pollingConfig.collect {} }
            val toasts = mutableListOf<FleetApiToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            advanceUntilIdle()
            vm.toggleEndpoint(KEY_CHARGE_STATE)
            advanceUntilIdle()
            assertEquals(1, source.pollingSaves.size)
            assertTrue(source.pollingSaves.single().chargeState)
            assertTrue(toasts.contains(FleetApiToast.PollingUpdated))
            assertFalse(vm.updating.value)
        }

    @Test
    fun toggleEndpointIsNoOpWhenConfigNotLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource()
            val vm = viewModel(source = source)
            // No collector on pollingConfig -> .value stays loading (data == null), so the toggle is ignored.
            vm.toggleEndpoint(KEY_CHARGE_STATE)
            advanceUntilIdle()
            assertTrue(source.pollingSaves.isEmpty())
        }

    @Test
    fun setRetentionDaysSavesConfigWithNewRetention() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource()
            val vm = viewModel(source = source)
            backgroundScope.launch { vm.pollingConfig.collect {} }
            advanceUntilIdle()
            vm.setRetentionDays(30)
            advanceUntilIdle()
            assertEquals(30, source.pollingSaves.single().telemetryCaptureRetentionDays)
        }

    @Test
    fun retryReSubscribesTheReadFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeFleetApiSource()
            val vm = viewModel(source = source)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            val before = source.settingsCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.settingsCalls > before)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)
            vm.recordViewOpened()
            vm.recordViewOpened()
            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "FleetAPIPage"), opened.single().second)
        }
}
