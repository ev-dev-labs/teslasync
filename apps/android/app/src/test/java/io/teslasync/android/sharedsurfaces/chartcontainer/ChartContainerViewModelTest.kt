package io.teslasync.android.sharedsurfaces.chartcontainer

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.ChartAnnotationRow
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ChartContainerViewModel] over a fake [ChartContainerSource] + an in-memory [ChartHiddenPrefs],
 * covering every state the web annotation host resolves (loading / content / empty / hard error / offline-
 * cached), the hide-toggle persistence (web `readHiddenPref` / `writeHiddenPref`), the popover flow, the
 * `useCreateAnnotation` / `useDeleteAnnotation` mutations (with the web `vehicle_id` + `[scope]` body + the
 * `Number(id) > 0` delete guard), the refresh/retry re-fetch, and the one-shot `view.opened` diagnostic. Run
 * by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChartContainerViewModelTest {
    private val config = ChartAnnotationsConfig(scope = "cost", vehicleId = 7L, chartId = "monthly-cost")

    private fun newVm(
        source: ChartContainerSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
        prefs: ChartHiddenPrefs = InMemoryChartHiddenPrefs(),
    ): ChartContainerViewModel = ChartContainerViewModel(source, config, HIDDEN_KEY, logger, prefs, scope)

    // ── feed state projection ──────────────────────────────────────────────────────
    @Test
    fun projectsContentFromFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(annotations = listOf(success(listOf(annotation("1")))))
            val vm = newVm(source, backgroundScope)
            backgroundScope.launch { vm.annotations.collect {} }
            advanceUntilIdle()

            val ui = vm.annotations.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.size)
        }

    @Test
    fun emptyFeedIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newVm(FakeSource(annotations = listOf(success(emptyList()))), backgroundScope)
            backgroundScope.launch { vm.annotations.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.annotations.value.phase)
        }

    @Test
    fun hardErrorIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    annotations = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = newVm(source, backgroundScope)
            backgroundScope.launch { vm.annotations.collect {} }
            advanceUntilIdle()

            val ui = vm.annotations.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedRowsStaleAndRetryable() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    annotations =
                        listOf(
                            Resource.Error(
                                cached = listOf(annotation("1"), annotation("2")),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = newVm(source, backgroundScope)
            backgroundScope.launch { vm.annotations.collect {} }
            advanceUntilIdle()

            val ui = vm.annotations.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(2, ui.data?.size)
        }

    @Test
    fun opensTheConfiguredVehicleAndScope() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(annotations = listOf(success(emptyList())))
            val vm = newVm(source, backgroundScope)
            backgroundScope.launch { vm.annotations.collect {} }
            advanceUntilIdle()

            assertEquals(7L, source.lastParams?.vehicleId)
            assertEquals("cost", source.lastParams?.scope)
        }

    // ── hide toggle persistence ────────────────────────────────────────────────────
    @Test
    fun hiddenSeedsFromPrefsAndTogglePersists() =
        runTest(UnconfinedTestDispatcher()) {
            val prefs = InMemoryChartHiddenPrefs().apply { setHidden(HIDDEN_KEY, true) }
            val vm = newVm(FakeSource(emptyList()), backgroundScope, prefs = prefs)

            assertTrue(vm.hidden.value)
            vm.toggleHidden()
            assertFalse(vm.hidden.value)
            assertFalse(prefs.isHidden(HIDDEN_KEY))
            vm.toggleHidden()
            assertTrue(vm.hidden.value)
            assertTrue(prefs.isHidden(HIDDEN_KEY))
        }

    // ── popover flow ───────────────────────────────────────────────────────────────
    @Test
    fun popoverOpensAndCloses() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newVm(FakeSource(emptyList()), backgroundScope)
            assertFalse(vm.popoverOpen.value)
            vm.openPopover()
            assertTrue(vm.popoverOpen.value)
            vm.closePopover()
            assertFalse(vm.popoverOpen.value)
        }

    // ── hidden series ──────────────────────────────────────────────────────────────
    @Test
    fun toggleSeriesUpdatesHiddenSeries() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = newVm(FakeSource(emptyList()), backgroundScope)
            assertFalse(vm.hiddenSeries.value.isHidden("cost"))
            vm.toggleSeries("cost")
            assertTrue(vm.hiddenSeries.value.isHidden("cost"))
        }

    // ── mutations ──────────────────────────────────────────────────────────────────
    @Test
    fun addAnnotationBuildsWebCreateBodyAndClosesPopover() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = newVm(source, backgroundScope)
            vm.openPopover()

            vm.addAnnotation(occurredAt = "2026-05-01T00:00:00Z", categoryWire = "trip", title = "Road trip", description = "to the coast")
            advanceUntilIdle()

            assertFalse(vm.popoverOpen.value)
            val created = source.lastCreate
            assertEquals("2026-05-01T00:00:00Z", created?.occurredAt)
            assertEquals("trip", created?.category)
            assertEquals("Road trip", created?.title)
            assertEquals("to the coast", created?.description)
            assertEquals(7L, created?.vehicleId)
            assertEquals(listOf("cost"), created?.scope)
        }

    @Test
    fun addAnnotationWithBlankOccurredAtIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = newVm(source, backgroundScope)

            vm.addAnnotation(occurredAt = "", categoryWire = "trip", title = "x", description = null)
            advanceUntilIdle()

            assertEquals(0, source.createCalls)
        }

    @Test
    fun removeAnnotationParsesNumericIdAndGuards() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = newVm(source, backgroundScope)

            vm.removeAnnotation("42")
            advanceUntilIdle()
            assertEquals(42L, source.lastDelete)

            // Non-numeric and non-positive ids are no-ops (web `Number.isFinite && > 0`).
            vm.removeAnnotation("nope")
            vm.removeAnnotation("0")
            vm.removeAnnotation("-3")
            advanceUntilIdle()
            assertEquals(1, source.deleteCalls)
        }

    // ── refresh / retry / telemetry ────────────────────────────────────────────────
    @Test
    fun refreshAndRetryReFetch() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(annotations = listOf(success(emptyList())))
            val logger = RecordingLogger()
            val vm = newVm(source, backgroundScope, logger = logger)

            vm.refresh()
            vm.retry()

            assertEquals(2, source.refreshCalls)
            assertTrue(logger.records.any { it.event == "chartContainer.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = newVm(FakeSource(emptyList()), backgroundScope, logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChartContainer", opened.first().fields["slug"])
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────
    private class FakeSource(
        private val annotations: List<Resource<List<DataAnnotation>>>,
    ) : ChartContainerSource {
        var lastParams: AnnotationListParams? = null
            private set
        var refreshCalls = 0
            private set
        var createCalls = 0
            private set
        var deleteCalls = 0
            private set
        var lastCreate: CreateAnnotationInput? = null
            private set
        var lastDelete: Long? = null
            private set

        override fun annotations(params: AnnotationListParams): Flow<Resource<List<DataAnnotation>>> {
            lastParams = params
            return annotations.asFlow()
        }

        override fun refresh() {
            refreshCalls++
        }

        override suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow> {
            createCalls++
            lastCreate = input
            return Result.success(row(input))
        }

        override suspend fun deleteAnnotation(id: Long): Result<Unit> {
            deleteCalls++
            lastDelete = id
            return Result.success(Unit)
        }

        private fun row(input: CreateAnnotationInput): ChartAnnotationRow =
            ChartAnnotationRow(
                id = 1L,
                occurredAt = input.occurredAt,
                category = input.category,
                title = input.title,
                createdAt = "2026-05-01T00:00:00Z",
                updatedAt = "2026-05-01T00:00:00Z",
            )
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private fun success(rows: List<DataAnnotation>): Resource<List<DataAnnotation>> =
        Resource.Success(rows, fetchedAt = 100L, stale = false)

    private fun annotation(id: String): DataAnnotation =
        DataAnnotation(
            id = id,
            timestamp = "2026-05-01T00:00:00Z",
            label = "Annotation $id",
            description = null,
            category = "milestone",
            context = "cost",
            vehicleId = 1L,
            createdAt = "2026-05-01T00:00:00Z",
        )

    private companion object {
        const val HIDDEN_KEY = "monthly-cost"
    }
}
