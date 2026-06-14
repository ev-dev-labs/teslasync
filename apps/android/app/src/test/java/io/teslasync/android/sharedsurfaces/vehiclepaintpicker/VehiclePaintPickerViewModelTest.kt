// Tests [VehiclePaintPickerViewModel] against the [VehiclePaintSource] seam with a fake override feed, plus the
// production [ProcessVehiclePaintStore] keying/isolation — covering the states the surface renders
// (auto-detected vs overridden) and the behaviours the web `useVehiclePaint` hook guarantees: the initial
// projection of the persisted override layered over the Tesla exterior colour, the `setPaint` write (incl.
// the clear-on-inferred normalisation, web `setPaint`), the `reset` clear (web `reset`), live re-projection
// when the override changes underneath (web cross-tab / in-tab sync), per-vehicle isolation + the
// non-persistable-id no-op (web `storageKey` guard), and the one-shot `view.opened` diagnostic. The
// framework-free projection is covered by VehiclePaintPickerModelTest. Runs in :android:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VehiclePaintPickerViewModelTest {
    private class FakeSource(
        initial: PaintPaletteId? = null,
    ) : VehiclePaintSource {
        val flow = MutableStateFlow(initial)
        val setCalls = mutableListOf<Pair<Long?, PaintPaletteId?>>()

        override fun overrideFor(vehicleId: Long?): StateFlow<PaintPaletteId?> = flow

        override fun setOverride(
            vehicleId: Long?,
            id: PaintPaletteId?,
        ) {
            setCalls += vehicleId to id
            flow.value = id
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun vm(
        source: VehiclePaintSource,
        scope: CoroutineScope,
        exteriorColor: String? = "PearlWhite",
        vehicleId: Long = 1L,
        logger: Logger = RecordingLogger(),
    ): VehiclePaintPickerViewModel = VehiclePaintPickerViewModel(source, vehicleId, exteriorColor, logger, scope)

    @Test
    fun initialStateSelectsInferredPaintWhenNoOverride() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = null)
            val model = vm(source, backgroundScope, exteriorColor = "MidnightSilverMetallic")
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(PaintPaletteId.MidnightSilver, state.activeId)
            assertEquals(PaintPaletteId.MidnightSilver, state.inferredId)
            assertFalse(state.isOverridden)
        }

    @Test
    fun initialStateSelectsPersistedOverrideOverInferred() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = PaintPaletteId.DeepBlue)
            val model = vm(source, backgroundScope, exteriorColor = "PearlWhite")
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(PaintPaletteId.DeepBlue, state.activeId)
            assertEquals(PaintPaletteId.PearlWhite, state.inferredId)
            assertTrue(state.isOverridden)
        }

    @Test
    fun setPaintPersistsOverrideUpdatesStateAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = null)
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, exteriorColor = "PearlWhite", logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.setPaint(PaintPaletteId.RedMulticoat)
            advanceUntilIdle()

            // Inferred is Pearl, so picking Red is kept as an explicit override against vehicle 1.
            assertEquals(1L, source.setCalls.last().first)
            assertEquals(PaintPaletteId.RedMulticoat, source.setCalls.last().second)
            val state = model.state.value
            assertEquals(PaintPaletteId.RedMulticoat, state.activeId)
            assertTrue(state.isOverridden)
            assertTrue(logger.records.any { it.event == "vehiclePaintPicker.set" })
        }

    @Test
    fun setPaintToTheInferredColourClearsTheOverride() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = PaintPaletteId.RedMulticoat)
            val model = vm(source, backgroundScope, exteriorColor = "PearlWhite")
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            // Picking the auto-detected colour (Pearl) clears the override (web setPaint normalisation).
            model.setPaint(PaintPaletteId.PearlWhite)
            advanceUntilIdle()

            assertNull(source.setCalls.last().second)
            val state = model.state.value
            assertFalse(state.isOverridden)
            assertEquals(PaintPaletteId.PearlWhite, state.activeId)
        }

    @Test
    fun resetClearsOverrideUpdatesStateAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = PaintPaletteId.SolidBlack)
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, exteriorColor = "MidnightSilverMetallic", logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            assertTrue(model.state.value.isOverridden)

            model.reset()
            advanceUntilIdle()

            assertNull(source.setCalls.last().second)
            val state = model.state.value
            assertFalse(state.isOverridden)
            assertEquals(PaintPaletteId.MidnightSilver, state.activeId)
            assertTrue(logger.records.any { it.event == "vehiclePaintPicker.reset" })
        }

    @Test
    fun stateReProjectsWhenTheOverrideChangesUnderneath() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(initial = null)
            val model = vm(source, backgroundScope, exteriorColor = "PearlWhite")
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            assertFalse(model.state.value.isOverridden)

            // Another observer (e.g. a VehicleTwin) wrote a new override → the picker re-syncs live.
            source.flow.value = PaintPaletteId.DeepBlue
            advanceUntilIdle()

            assertEquals(PaintPaletteId.DeepBlue, model.state.value.activeId)
            assertTrue(model.state.value.isOverridden)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = vm(FakeSource(), backgroundScope, logger = logger)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VehiclePaintPicker", opened.first().fields["surface"])
        }

    // ── production store: per-vehicle isolation + non-persistable-id no-op (web storageKey) ──

    @Test
    fun processStoreSharesAndIsolatesOverridesPerVehicle() {
        val store = ProcessVehiclePaintStore()
        store.setOverride(7L, PaintPaletteId.RedMulticoat)

        assertEquals(PaintPaletteId.RedMulticoat, store.overrideFor(7L).value)
        // A different vehicle has its own independent slot.
        assertNull(store.overrideFor(8L).value)
        // Clearing reverts to null.
        store.setOverride(7L, null)
        assertNull(store.overrideFor(7L).value)
    }

    @Test
    fun processStoreIgnoresNonPersistableVehicleIds() {
        val store = ProcessVehiclePaintStore()
        store.setOverride(0L, PaintPaletteId.DeepBlue)
        store.setOverride(null, PaintPaletteId.DeepBlue)
        store.setOverride(-4L, PaintPaletteId.DeepBlue)

        assertNull(store.overrideFor(0L).value)
        assertNull(store.overrideFor(null).value)
        assertNull(store.overrideFor(-4L).value)
    }
}
