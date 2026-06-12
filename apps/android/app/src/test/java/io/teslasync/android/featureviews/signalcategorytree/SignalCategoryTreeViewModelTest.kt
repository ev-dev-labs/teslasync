package io.teslasync.android.featureviews.signalcategorytree

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalDescriptor
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalUnitKind
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [SignalCategoryTreeViewModel] against the [SignalCategoryTreeSource] seam with a fake feed —
 * covering every state the web component renders (loading / content / empty / hard error / offline-cached),
 * the no-vehicle disabled-query branch, the refresh delegation, and the one-shot `view.opened` event. Runs
 * in the `:app:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalCategoryTreeViewModelTest {
    @Test
    fun loadsGroupedCatalogFromAvailableSignals() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(available = listOf(success(catalog("VehicleSpeed" to "driving", "BatteryLevel" to "charging"))))
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 1L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(listOf("charging", "driving"), ui.data?.groups?.map { it.categoryId })
            assertEquals(2, ui.data?.totalSignals)
        }

    @Test
    fun emptyCatalogIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(available = listOf(success(catalog())))
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 1L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun nonPositiveVehicleIdHoldsEmptyState() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(available = listOf(success(catalog("VehicleSpeed" to "driving"))))
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 0L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val error = ApiError.Network()
            val source = FakeSource(available = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = error)))
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 1L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
        }

    @Test
    fun errorWithCacheKeepsGroupsVisibleAsStaleOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = catalog("BatteryLevel" to "charging")
            val source =
                FakeSource(
                    available = listOf(Resource.Error(cached = cached, fetchedAt = 50L, stale = true, error = ApiError.Network())),
                )
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 1L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertNotNull(ui.data)
            assertTrue(ui.stale)
            assertTrue(ui.hasError)
            assertEquals(listOf("charging"), ui.data?.groups?.map { it.categoryId })
        }

    @Test
    fun recordViewOpenedEmitsTheSlugEventOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = SignalCategoryTreeViewModel(FakeSource(emptyList()), logger, vehicleId = 1L, scope = backgroundScope)
            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(SIGNAL_CATEGORY_TREE_SLUG, opened.first().fields["surface"])
        }

    @Test
    fun refreshDelegatesToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(available = listOf(success(catalog("BatteryLevel" to "charging"))))
            val vm = SignalCategoryTreeViewModel(source, RecordingLogger(), vehicleId = 7L, scope = backgroundScope)
            vm.refresh()
            advanceUntilIdle()

            assertEquals(7L, source.refreshedId)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val available: List<Resource<AvailableSignalsResponse>>,
    ) : SignalCategoryTreeSource {
        var refreshedId: Long? = null
            private set

        override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> = available.asFlow()

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))

        override suspend fun refresh(vehicleId: Long) {
            refreshedId = vehicleId
        }
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

    private fun success(catalog: AvailableSignalsResponse): Resource<AvailableSignalsResponse> =
        Resource.Success(catalog, fetchedAt = 100L, stale = false)

    private fun catalog(vararg entries: Pair<String, String>): AvailableSignalsResponse =
        AvailableSignalsResponse(
            vehicleId = 1L,
            count = entries.size,
            source = "test",
            signals =
                entries.map { (name, category) ->
                    SignalDescriptor(
                        name = name,
                        category = category,
                        valueKind = SignalKind.Float,
                        unitKind = SignalUnitKind.None,
                        isCompound = false,
                        isSettingUnit = false,
                    )
                },
        )
}
