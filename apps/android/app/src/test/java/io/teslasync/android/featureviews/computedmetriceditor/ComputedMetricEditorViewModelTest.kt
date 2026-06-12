package io.teslasync.android.featureviews.computedmetriceditor

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreviewInput
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
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
 * Drives [ComputedMetricEditorViewModel] over a controllable fake [ComputedMetricEditorSource], covering the
 * two hooks the web component owns (web/src/features/notifications/components/ComputedMetricEditor.tsx +
 * web/src/api/hooks/useNotifications.ts): the `useAlertMetrics` registry feed (→ a [io.teslasync.android.data.UiState]),
 * the `handleMetric` window/operator reset, and the `usePreviewComputedMetric` mutation fired by the readiness
 * `useEffect`. The view never performs HTTP — every fetch flows through the fake source.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComputedMetricEditorViewModelTest {
    private class FakeSource : ComputedMetricEditorSource {
        var metricsEmissions: List<Resource<List<ComputedMetricSummary>>> = listOf(loading())
        val previewCalls = mutableListOf<ComputedMetricPreviewInput>()
        var previewResult: Result<ComputedMetricPreview> = Result.success(ComputedMetricPreview(value = 1.0))

        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> = flow { metricsEmissions.forEach { emit(it) } }

        override suspend fun previewComputedMetric(input: ComputedMetricPreviewInput): Result<ComputedMetricPreview> {
            previewCalls += input
            return previewResult
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
    fun metricsFeedProjectsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Success(listOf(metric("cost")), fetchedAt = 100L, stale = false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            advanceUntilIdle()

            assertTrue(vm.metricsState.value.isContent)
            assertEquals(listOf(metric("cost")), vm.metricsState.value.data)
        }

    @Test
    fun emptyMetricsFeedProjectsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Success(emptyList(), fetchedAt = 100L, stale = false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            advanceUntilIdle()

            assertTrue(vm.metricsState.value.isEmpty)
        }

    @Test
    fun hardErrorWithNoCacheProjectsError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            advanceUntilIdle()

            assertTrue(vm.metricsState.value.isError)
        }

    @Test
    fun selectingMetricResetsWindowAndOperatorFromRegistry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions =
                listOf(Resource.Success(listOf(metric("cost", windows = listOf("7d", "30d"), ops = listOf(">=", "<"))), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            advanceUntilIdle()

            vm.selectMetric("cost")

            assertEquals("cost", vm.value.value.metricId)
            assertEquals("7d", vm.value.value.metricWindow)
            assertEquals(">=", vm.value.value.metricOp)
        }

    @Test
    fun previewStaysIdleUntilReady() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.previewState.collect {} }
            advanceUntilIdle()

            assertEquals(PreviewUiState.Idle, vm.previewState.value)
            assertTrue(src.previewCalls.isEmpty())
        }

    @Test
    fun preparingEveryOperandFiresThePreviewAndResolvesAValue() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Success(listOf(metric("cost", windows = listOf("30d"), ops = listOf(">"))), 100L, false))
            src.previewResult = Result.success(ComputedMetricPreview(value = 214.3, threshold = 200.0, wouldTrigger = true))
            val vm = viewModel(src, vehicleId = 9L)
            backgroundScope.launch { vm.metricsState.collect {} }
            backgroundScope.launch { vm.previewState.collect {} }
            advanceUntilIdle()

            vm.selectMetric("cost")
            vm.setThreshold("200")
            advanceUntilIdle()

            val request = src.previewCalls.last()
            assertEquals("cost", request.metricId)
            assertEquals("30d", request.metricWindow)
            assertEquals(">", request.metricOp)
            assertEquals(200.0, request.metricThreshold, 0.0)
            assertEquals(9L, request.vehicleId)
            assertTrue(vm.previewState.value is PreviewUiState.Value)
            assertEquals(214.3, (vm.previewState.value as PreviewUiState.Value).preview.value, 0.0)
        }

    @Test
    fun previewFailureSurfacesFailureState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Success(listOf(metric("cost", windows = listOf("30d"), ops = listOf(">"))), 100L, false))
            src.previewResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            backgroundScope.launch { vm.previewState.collect {} }
            advanceUntilIdle()

            vm.selectMetric("cost")
            vm.setThreshold("200")
            advanceUntilIdle()

            assertEquals(PreviewUiState.Failure, vm.previewState.value)
        }

    @Test
    fun refreshReFetchesTheRegistry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.metricsEmissions = listOf(Resource.Success(listOf(metric("cost")), fetchedAt = 100L, stale = false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.metricsState.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.metricsState.value.fetchedAt)

            src.metricsEmissions = listOf(Resource.Success(listOf(metric("cost")), fetchedAt = 200L, stale = false))
            vm.refreshMetrics()
            advanceUntilIdle()

            assertEquals(200L, vm.metricsState.value.fetchedAt)
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
            assertEquals(mapOf("surface" to "ComputedMetricEditor"), opened.single().second)
        }

    @Test
    fun diagnosticsNeverLeakOperandValues() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.selectMetric("cost")
            vm.setThreshold("200")
            vm.recordViewOpened()

            assertFalse(logger.events.any { it.second.containsKey("metric_id") })
            assertFalse(logger.events.any { it.second.containsKey("threshold") })
            assertFalse(logger.events.any { it.second.values.contains("200") })
        }

    private fun TestScope.viewModel(
        source: ComputedMetricEditorSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): ComputedMetricEditorViewModel = ComputedMetricEditorViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loading(): Resource<List<ComputedMetricSummary>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun metric(
            id: String,
            windows: List<String> = listOf("30d"),
            ops: List<String> = listOf(">"),
        ): ComputedMetricSummary = ComputedMetricSummary(id = id, label = id, unit = "count", windows = windows, ops = ops)
    }
}
