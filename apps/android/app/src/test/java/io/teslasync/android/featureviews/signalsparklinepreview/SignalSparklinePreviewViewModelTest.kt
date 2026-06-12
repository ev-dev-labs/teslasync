package io.teslasync.android.featureviews.signalsparklinepreview

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
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
 * Drives [SignalSparklinePreviewViewModel] over a controllable fake [SignalSparklinePreviewSource], covering
 * the cache-then-network state matrix the web component renders from its `useSignalHistory` feed: the gated
 * branches that fire no request (disabled / non-numeric / no vehicle — the web "don't fire 600+ requests"
 * intent), the loading / content / empty / hard-error / offline freshness, the refresh re-fetch, and the
 * PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalSparklinePreviewViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : SignalSparklinePreviewSource {
        var emissions: List<Resource<SignalHistoryResponse>> = listOf(loading())
        var openCount = 0

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> =
            flow {
                openCount++
                emissions.forEach { emit(it) }
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
    fun disabledNeverOpensFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src, previewArgs(enabled = false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.Disabled, vm.state.value.mode)
            assertEquals(0, src.openCount)
        }

    @Test
    fun nonNumericNeverOpensFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src, previewArgs(valueKind = SignalKind.String))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.NonNumeric, vm.state.value.mode)
            assertEquals(0, src.openCount)
        }

    @Test
    fun nonPositiveVehicleNeverOpensFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src, previewArgs(vehicleId = 0L))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.Empty, vm.state.value.mode)
            assertEquals(0, src.openCount)
        }

    @Test
    fun blankSignalNeverOpensFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src, previewArgs(signal = ""))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.Empty, vm.state.value.mode)
            assertEquals(0, src.openCount)
        }

    @Test
    fun loadingWhileFetching() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(loading())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.Loading, vm.state.value.mode)
            assertTrue(src.openCount >= 1)
        }

    @Test
    fun contentWhenFeedResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(historyResponse(4), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(SignalSparklineMode.Content, state.mode)
            assertEquals(SparklineFreshness.Fresh, state.freshness)
            assertEquals(4, state.series.size)
        }

    @Test
    fun emptyWhenResolvedWithTooFewPoints() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(historyResponse(1), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(SignalSparklineMode.Empty, vm.state.value.mode)
        }

    @Test
    fun errorWithNoCacheClassifiesKind() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Http(503)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(SignalSparklineMode.Error, state.mode)
            assertEquals(io.teslasync.android.components.feedback.QueryErrorKind.ServerError, state.errorKind)
        }

    @Test
    fun offlineKeepsCachedSeries() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Error(historyResponse(3), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(SignalSparklineMode.Content, state.mode)
            assertEquals(SparklineFreshness.Offline, state.freshness)
            assertEquals(3, state.series.size)
        }

    @Test
    fun refreshReFetchesFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(historyResponse(2), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(2, vm.state.value.series.size)

            src.emissions = listOf(Resource.Success(historyResponse(5), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(5, vm.state.value.series.size)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SignalSparklinePreview"), opened.single().second)
        }

    @Test
    fun refreshEmitsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "signalSparklinePreview.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("value") })
            assertFalse(logger.events.any { it.second.containsKey("signal") })
        }

    private fun previewArgs(
        vehicleId: Long = 5L,
        signal: String = "VehicleSpeed",
        valueKind: SignalKind = SignalKind.Float,
        enabled: Boolean = true,
    ): SignalSparklinePreviewArgs = SignalSparklinePreviewArgs(vehicleId, signal, valueKind, enabled)

    private fun TestScope.viewModel(
        source: SignalSparklinePreviewSource,
        args: SignalSparklinePreviewArgs = previewArgs(),
        logger: Logger = NoopLogger,
    ): SignalSparklinePreviewViewModel = SignalSparklinePreviewViewModel(source, args, logger, backgroundScope)

    private companion object {
        fun loading(cached: SignalHistoryResponse? = null): Resource<SignalHistoryResponse> =
            Resource.Loading(cached = cached, fetchedAt = if (cached == null) null else 1L, stale = false)

        fun historyResponse(points: Int): SignalHistoryResponse =
            SignalHistoryResponse(
                vehicleId = 5L,
                signal = "VehicleSpeed",
                expectedKind = "ValueKindFloat",
                from = "",
                to = "",
                count = points,
                data = (0 until points).map { SignalEnvelope(SignalKind.Float, SignalValue.Num(it.toDouble()), "") },
            )
    }
}
