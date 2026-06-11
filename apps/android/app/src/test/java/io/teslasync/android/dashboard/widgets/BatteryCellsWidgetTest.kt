package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No-device verification of the BatteryCellsWidget's UI-thread-free logic — the JSON parse adapter
 * (summary + per-cell), the cell-status thresholds, the heatmap/stat projection across the
 * compact / standard / wide footprints, the registry footprint bounds, the cache-then-network
 * `Resource` mapper, and the view-model's per-state transitions (loading / content / empty / error /
 * stale-offline) plus the `view.opened` diagnostics. Mirrors the web spec
 * (web/src/features/dashboard/widgets/BatteryCellsWidget.tsx) and the Windows parity tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryCellsWidgetTest {
    private val labels =
        BatteryCellsLabels(
            cell = "Cell",
            minV = "Min V",
            maxV = "Max V",
            avgV = "Avg V",
            spread = "Spread",
            minTemp = "Min Temp",
            avgTemp = "Avg Temp",
            maxTemp = "Max Temp",
        )

    private fun summary(
        cells: List<BatteryCell> =
            listOf(BatteryCell(1, 0, 3.700, 25.0), BatteryCell(2, 1, 3.710, 26.0)),
    ): BatteryCellSummary =
        BatteryCellSummary(
            avgVoltage = 3.700,
            minVoltage = 3.650,
            maxVoltage = 3.750,
            voltageSpread = 0.012,
            avgTemperature = 25.0,
            minTemperature = 22.0,
            maxTemperature = 28.0,
            tempSpread = 6.0,
            totalCells = cells.size,
            cells = cells,
        )

    // ---- Parse adapter -------------------------------------------------------------

    @Test
    fun summaryFromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """
                {"total_cells":96,"avg_voltage":3.7,"min_voltage":3.65,"max_voltage":3.75,
                 "voltage_spread":0.012,"avg_temperature":25.5,"min_temperature":22.1,
                 "max_temperature":28.9,"temp_spread":6.8,
                 "cells":[{"cell_id":1,"module":0,"voltage":3.70,"temperature":25.0}]}
                """.trimIndent(),
            )

        val s = requireNotNull(BatteryCellSummary.fromJson(json))

        assertEquals(96, s.totalCells)
        assertEquals(3.7, s.avgVoltage, EPS)
        assertEquals(3.65, s.minVoltage, EPS)
        assertEquals(3.75, s.maxVoltage, EPS)
        assertEquals(0.012, s.voltageSpread, EPS)
        assertEquals(25.5, s.avgTemperature, EPS)
        assertEquals(22.1, s.minTemperature, EPS)
        assertEquals(28.9, s.maxTemperature, EPS)
        assertEquals(6.8, s.tempSpread, EPS)

        assertEquals(1, s.cells.size)
        assertEquals(1, s.cells[0].cellId)
        assertEquals(0, s.cells[0].module)
        assertEquals(3.70, requireNotNull(s.cells[0].voltage), EPS)
        assertEquals(25.0, requireNotNull(s.cells[0].temperature), EPS)
    }

    @Test
    fun summaryFromJson_isTolerantOfMissingFields() {
        val s = requireNotNull(BatteryCellSummary.fromJson(Json.parseToJsonElement("""{"avg_voltage":3.7}""")))

        assertEquals(3.7, s.avgVoltage, EPS)
        assertEquals(0.0, s.minVoltage, EPS)
        assertEquals(0, s.totalCells)
        assertTrue(s.cells.isEmpty())
    }

    @Test
    fun summaryFromJson_returnsNullForNonObjectBody() {
        assertNull(BatteryCellSummary.fromJson(Json.parseToJsonElement("[]")))
        assertNull(BatteryCellSummary.fromJson(Json.parseToJsonElement("null")))
    }

    @Test
    fun summaryFromJson_emptyObjectIsNonNullAllZero() {
        // Web parity: a present object keeps `data` truthy → content path (heatmap shows its own
        // "No cell data"), distinct from a missing body which is the outer empty.
        val s = requireNotNull(BatteryCellSummary.fromJson(Json.parseToJsonElement("{}")))
        assertEquals(0.0, s.avgVoltage, EPS)
        assertTrue(s.cells.isEmpty())
    }

    @Test
    fun cellFromJson_leavesMissingVoltageNull() {
        val c = BatteryCell.fromJson(Json.parseToJsonElement("""{"cell_id":4,"module":2}"""))

        assertEquals(4, c.cellId)
        assertEquals(2, c.module)
        assertNull(c.voltage)
        assertNull(c.temperature)
    }

    // ---- Cell status thresholds (web cellStatus) -----------------------------------

    @Test
    fun severityFor_classifiesByDeviation() {
        assertEquals(BatteryCellSeverity.Ok, BatteryCellsProjection.severityFor(3.000, 3.000)) // 0 mV
        assertEquals(BatteryCellSeverity.Ok, BatteryCellsProjection.severityFor(3.004, 3.000)) // 4 mV
        assertEquals(BatteryCellSeverity.Warning, BatteryCellsProjection.severityFor(3.010, 3.000)) // 10 mV
        assertEquals(BatteryCellSeverity.Error, BatteryCellsProjection.severityFor(3.020, 3.000)) // 20 mV
        assertEquals(BatteryCellSeverity.Unknown, BatteryCellsProjection.severityFor(null, 3.000))
    }

    // ---- Footprint flags + registry bounds (web isCompact / isWide / cols) ---------

    @Test
    fun sizeFlags_matchWeb() {
        assertSize(BatteryCellsSize(1, 4), compact = true, wide = false, gridCols = 2)
        assertSize(BatteryCellsSize(2, 4), compact = false, wide = false, gridCols = 3)
        assertSize(BatteryCellsSize(3, 4), compact = false, wide = true, gridCols = 4)
        assertSize(BatteryCellsSize(4, 40), compact = false, wide = true, gridCols = 4)
    }

    @Test
    fun registry_metadataAndBounds() {
        assertEquals("battery-cells", BatteryCellsRegistration.ID)
        assertEquals("battery", BatteryCellsRegistration.CATEGORY)
        assertEquals("BatteryCellsWidget", BatteryCellsRegistration.SLUG)
        assertEquals(BatteryCellsSize(2, 4), BatteryCellsRegistration.defaultSize)
        assertTrue(BatteryCellsRegistration.withinBounds(BatteryCellsSize(2, 4)))
        assertFalse(BatteryCellsRegistration.withinBounds(BatteryCellsSize(1, 4)))
        assertEquals(BatteryCellsSize(2, 4), BatteryCellsRegistration.clamp(BatteryCellsSize(1, 2)))
        assertEquals(BatteryCellsSize(4, 40), BatteryCellsRegistration.clamp(BatteryCellsSize(9, 99)))
    }

    // ---- Projection ----------------------------------------------------------------

    @Test
    fun project_standardFormatsCellsAndVoltageStats() {
        val view = BatteryCellsProjection.project(summary(), BatteryCellsSize(2, 4), labels)

        assertFalse(view.isWide)
        assertEquals(3, view.gridColumns)
        assertFalse(view.showTemperature)
        assertTrue(view.temperatureStats.isEmpty())

        assertEquals(2, view.cells.size)
        assertEquals("C1", view.cells[0].label)
        assertEquals("3.700 V", view.cells[0].value)
        assertEquals(BatteryCellSeverity.Ok, view.cells[0].severity)
        assertEquals("C2", view.cells[1].label)
        assertEquals(BatteryCellSeverity.Warning, view.cells[1].severity) // 3.710 → 10 mV

        assertEquals(4, view.voltageStats.size)
        assertEquals("Min V", view.voltageStats[0].label)
        assertEquals("3.650 V", view.voltageStats[0].value)
        assertEquals("Max V", view.voltageStats[1].label)
        assertEquals("3.750 V", view.voltageStats[1].value)
        assertEquals("Avg V", view.voltageStats[2].label)
        assertEquals("3.700 V", view.voltageStats[2].value)
        assertEquals("Spread", view.voltageStats[3].label)
        assertEquals("12.0 mV", view.voltageStats[3].value) // 0.012 * 1000
    }

    @Test
    fun project_wideAddsModuleLabelsTemperatureAndTempStats() {
        val view = BatteryCellsProjection.project(summary(), BatteryCellsSize(3, 4), labels)

        assertTrue(view.isWide)
        assertEquals(4, view.gridColumns)
        assertTrue(view.showTemperature)

        assertEquals("Cell 1 \u00B7 M0", view.cells[0].label)
        assertEquals("3.700 V / 25.0\u00B0", view.cells[0].value)
        assertEquals("Cell 2 \u00B7 M1", view.cells[1].label)
        assertEquals("3.710 V / 26.0\u00B0", view.cells[1].value)

        assertEquals(3, view.temperatureStats.size)
        assertEquals("Min Temp", view.temperatureStats[0].label)
        assertEquals("22.0\u00B0", view.temperatureStats[0].value)
        assertEquals("Avg Temp", view.temperatureStats[1].label)
        assertEquals("25.0\u00B0", view.temperatureStats[1].value)
        assertEquals("Max Temp", view.temperatureStats[2].label)
        assertEquals("28.0\u00B0", view.temperatureStats[2].value)
    }

    @Test
    fun project_compactTightensGridButKeepsStats() {
        val view = BatteryCellsProjection.project(summary(), BatteryCellsSize(1, 4), labels)

        assertTrue(view.isCompact)
        assertEquals(2, view.gridColumns)
        assertEquals("C1", view.cells[0].label)
        assertEquals(4, view.voltageStats.size)
    }

    @Test
    fun project_unknownVoltageRendersZeroValueAndUnknownStatus() {
        val view =
            BatteryCellsProjection.project(
                summary(cells = listOf(BatteryCell(7, 0, null, null))),
                BatteryCellsSize(2, 4),
                labels,
            )

        val cell = view.cells.single()
        assertEquals(BatteryCellSeverity.Unknown, cell.severity)
        assertEquals("0.000 V", cell.value) // web fmtNumber(undefined) → safeNumber 0
    }

    @Test
    fun project_emptySummaryHasNoCellsButKeepsStats() {
        val view = BatteryCellsProjection.project(BatteryCellSummary.EMPTY, BatteryCellsSize(2, 4), labels)

        assertFalse(view.hasCells)
        assertTrue(view.cells.isEmpty())
        assertEquals(4, view.voltageStats.size)
        assertEquals("0.000 V", view.voltageStats[2].value)
    }

    @Test
    fun project_cellsHaveNonEmptyContentDescriptions() {
        val view = BatteryCellsProjection.project(summary(), BatteryCellsSize(3, 4), labels)

        view.cells.forEach { cell ->
            assertTrue(cell.contentDescription.isNotBlank())
            assertTrue(cell.contentDescription.contains(cell.label))
            assertTrue(cell.contentDescription.contains(cell.value))
        }
    }

    // ---- Resource mapper (cache-then-network preservation) -------------------------

    @Test
    fun resourceMapper_parsesPayloadAndPreservesStatus() {
        val json = Json.parseToJsonElement("""{"avg_voltage":3.7,"min_voltage":3.6}""")

        val cached = Resource.Loading(cached = json, fetchedAt = NOW, stale = true).toBatteryCellsSummary()
        assertTrue(cached is Resource.Loading)
        assertTrue(cached.stale)
        assertEquals(3.7, requireNotNull(cached.cached).avgVoltage, EPS)

        val offline = Resource.Error(cached = json, fetchedAt = NOW, stale = true, error = ApiError.Network()).toBatteryCellsSummary()
        assertTrue(offline is Resource.Error)
        assertEquals(3.6, requireNotNull(offline.cached).minVoltage, EPS)
    }

    @Test
    fun resourceMapper_successWithNonObjectBecomesNullSummary() {
        val mapped = Resource.Success(data = Json.parseToJsonElement("null"), fetchedAt = NOW, stale = false).toBatteryCellsSummary()
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data)
    }

    // ---- View-model state matrix ---------------------------------------------------

    @Test
    fun viewModel_loadingOnlyStaysLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun viewModel_loadedExposesContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false), Resource.Success(summary(), NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, requireNotNull(state.data).cells.size)
            assertEquals(NOW, state.fetchedAt)
        }

    @Test
    fun viewModel_presentEmptyBodyStaysContentWithEmptyGrid() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Success(BatteryCellSummary.EMPTY, NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(requireNotNull(state.data).cells.isEmpty())
        }

    @Test
    fun viewModel_nullSummaryRendersOuterEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Success(null, NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun viewModel_hardErrorRendersErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun viewModel_errorWithCacheStaysStaleOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    Resource.Loading(null, null, false),
                    Resource.Error(summary(), NOW, true, ApiError.Timeout()),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun viewModel_onAppearEmitsViewOpenedOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BatteryCellsWidgetViewModel(source(Resource.Success(summary(), NOW, false)), logger, backgroundScope)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BatteryCellsWidget", opened.single().second["slug"])
        }

    // ---- Helpers -------------------------------------------------------------------

    private fun assertSize(
        size: BatteryCellsSize,
        compact: Boolean,
        wide: Boolean,
        gridCols: Int,
    ) {
        assertEquals(compact, size.isCompact)
        assertEquals(wide, size.isWide)
        assertEquals(gridCols, size.gridColumns)
    }

    private fun source(vararg emissions: Resource<BatteryCellSummary?>): BatteryCellsSource =
        BatteryCellsSource {
            flow { emissions.forEach { emit(it) } }
        }

    private fun viewModel(vararg emissions: Resource<BatteryCellSummary?>): BatteryCellsWidgetViewModel =
        BatteryCellsWidgetViewModel(source(*emissions), NoopLogger)

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

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
    }
}
