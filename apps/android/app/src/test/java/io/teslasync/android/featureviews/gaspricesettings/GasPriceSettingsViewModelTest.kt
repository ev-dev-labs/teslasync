package io.teslasync.android.featureviews.gaspricesettings

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.settings.GasPriceConfigResult
import io.teslasync.shared.core.presentation.settings.GasPricePollResult
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import io.teslasync.shared.core.presentation.settings.GasPriceToggleResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
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
 * Drives [GasPriceSettingsViewModel] over a controllable fake [GasPriceSettingsSource], covering the full
 * cache-then-network state matrix the status feed can be in (loading / content / hard error + retry /
 * stale-offline + retry), the settings-document → [GasDisplayPrefs] derivation, every mutation's typed
 * [GasPriceToast] + delegation (toggle / interval / poll, including the web-faithful negate-on-toggle), the
 * in-flight poll flag, and the PII-safe `view.opened` + refresh diagnostics. Mirrors the web component's hook
 * behaviour (web/src/features/settings/components/GasPriceSettings.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GasPriceSettingsViewModelTest {
    private fun status(
        enabled: Boolean = true,
        interval: String = "7d",
        price: Double = 3.45,
    ): GasPriceStatus =
        GasPriceStatus(
            enabled = enabled,
            pollInterval = interval,
            lastPollTime = "2026-04-04T02:30:00Z",
            currentPrice = price,
            currentPriceKwhEq = 0.0,
        )

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.status.value.phase)
        }

    @Test
    fun contentWhenStatusPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            val state = vm.status.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(status(), state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun resolvedStatusNeverEmptyEvenWhenZeroValue() =
        runTest(UnconfinedTestDispatcher()) {
            // Web parity: the panel always renders its controls, so a zero-value status is Content, not Empty.
            val zero = GasPriceStatus(enabled = false, pollInterval = "", lastPollTime = "", currentPrice = 0.0, currentPriceKwhEq = 0.0)
            val vm = viewModel(FakeSource(listOf(Resource.Success(zero, 100L, false))))
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.status.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            val state = vm.status.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
            assertFalse(state.hasData)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(status(), vm.status.value.data)

            src.statusEmissions = listOf(Resource.Error(status(), 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.status.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(status(), state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun displayPrefsDerivedFromSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val doc =
                buildJsonObject {
                    put("currency_symbol", "€")
                    put("decimal_precision", 0)
                    put("gas_unit", "liter")
                }
            val src =
                FakeSource(
                    statusEmissions = listOf(Resource.Success(status(), 100L, false)),
                    settingsEmissions = listOf(Resource.Success(doc as JsonElement, 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()

            val prefs = vm.displayPrefs.value
            assertEquals("€", prefs.currencySymbol)
            assertEquals(0, prefs.resolvedPrecision)
            assertEquals("L", prefs.gasUnitLabel)
        }

    @Test
    fun displayPrefsDefaultWhileSettingsLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(status(), 100L, false))))
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals(GasDisplayPrefs.DEFAULT, vm.displayPrefs.value)
        }

    @Test
    fun toggleEnablesWhenCurrentlyDisabledAndRaisesEnabledToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(currentlyEnabled = false)
            advanceUntilIdle()

            assertEquals(listOf(true), src.toggled)
            assertEquals(listOf<GasPriceToast>(GasPriceToast.AutoPollEnabled), received)
        }

    @Test
    fun toggleDisablesWhenCurrentlyEnabledAndRaisesDisabledToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(currentlyEnabled = true)
            advanceUntilIdle()

            assertEquals(listOf(false), src.toggled)
            assertEquals(listOf<GasPriceToast>(GasPriceToast.AutoPollDisabled), received)
        }

    @Test
    fun toggleFailureRaisesToggleFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            src.toggleResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(currentlyEnabled = false)
            advanceUntilIdle()

            assertEquals(listOf<GasPriceToast>(GasPriceToast.ToggleFailed), received)
        }

    @Test
    fun updateIntervalSuccessRaisesIntervalUpdatedAndDelegates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.updateInterval("30d")
            advanceUntilIdle()

            assertEquals(listOf("30d"), src.configured)
            assertEquals(listOf<GasPriceToast>(GasPriceToast.IntervalUpdated), received)
        }

    @Test
    fun updateIntervalFailureRaisesIntervalFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            src.configResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.updateInterval("daily")
            advanceUntilIdle()

            assertEquals(listOf<GasPriceToast>(GasPriceToast.IntervalFailed), received)
        }

    @Test
    fun pollNowSuccessRaisesPolledTracksFlagAndDelegates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.pollNow()
            advanceUntilIdle()

            assertEquals(1, src.pollCount)
            assertEquals(listOf<GasPriceToast>(GasPriceToast.Polled), received)
            assertFalse(vm.polling.value)
        }

    @Test
    fun pollNowFailureRaisesPollFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(status(), 100L, false)))
            src.pollResult = Result.failure(ApiError.Timeout())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.pollNow()
            advanceUntilIdle()

            assertEquals(listOf<GasPriceToast>(GasPriceToast.PollFailed), received)
            assertFalse(vm.polling.value)
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
            assertEquals(mapOf("surface" to "GasPriceSettings"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "gasPriceSettings.refresh" })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.collectToasts(vm: GasPriceSettingsViewModel): List<GasPriceToast> {
        val received = mutableListOf<GasPriceToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: GasPriceSettingsSource,
        logger: Logger = NoopLogger,
    ): GasPriceSettingsViewModel = GasPriceSettingsViewModel(source, logger, backgroundScope)

    private class FakeSource(
        var statusEmissions: List<Resource<GasPriceStatus>>,
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Loading(null, null, false)),
    ) : GasPriceSettingsSource {
        var toggleResult: Result<GasPriceToggleResult> = Result.success(GasPriceToggleResult(enabled = true))
        var configResult: Result<GasPriceConfigResult> = Result.success(GasPriceConfigResult(pollInterval = "7d"))
        var pollResult: Result<GasPricePollResult> = Result.success(GasPricePollResult(status = "ok"))
        val toggled = mutableListOf<Boolean>()
        val configured = mutableListOf<String>()
        var pollCount = 0
            private set

        override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> = flow { statusEmissions.forEach { emit(it) } }

        override fun settings(): Flow<Resource<JsonElement>> = flow { settingsEmissions.forEach { emit(it) } }

        override suspend fun pollGasPrice(): Result<GasPricePollResult> {
            pollCount++
            return pollResult
        }

        override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> {
            toggled += enabled
            return toggleResult
        }

        override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> {
            configured += pollInterval
            return configResult
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
