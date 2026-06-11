package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * No-device verification of the ChargeSessionChartWidget's UI-thread-free logic — the charger-type
 * classification, the SI→kWh energy conversion, the reversed/labelled chart projection + Total/Avg/
 * Sessions stat rollup, the footprint flags, the registry bounds, and the view-model's per-state
 * transitions (loading / content / empty / error / stale-offline) plus the `view.opened` diagnostics.
 * Mirrors the web spec (web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeSessionChartWidgetTest {
    private val strings =
        ChargeSessionChartStrings(
            title = "Charge Sessions",
            total = "Total",
            avg = "Avg",
            sessions = "Sessions",
            empty = "No charge sessions yet",
            typeHome = "Home / AC",
            typeSupercharger = "Supercharger",
            typeDc = "DC Fast",
        )

    private fun session(
        id: Long,
        startedAt: String,
        chargerType: String?,
        energyWh: Double?,
    ): ChargingSession =
        ChargingSession(
            id = id,
            startedAt = Instant.parse(startedAt),
            vehicleId = VEHICLE_ID,
            chargerType = chargerType,
            totalEnergyAddedWh = energyWh,
        )

    private fun project(
        sessions: List<ChargingSession>,
        size: ChargeSessionChartSize = ChargeSessionChartSize(2, 4),
    ) = ChargeSessionChartProjection.project(sessions, size, strings, ZoneId.of("UTC"), Locale.US)

    // ---- Charger-type classification (web classifyChargerType) ---------------------

    @Test
    fun classify_matchesWebBuckets() {
        assertEquals(ChargerKind.Supercharger, classifyChargerKind("Supercharger"))
        assertEquals(ChargerKind.Supercharger, classifyChargerKind("TESLA Wall Connector"))
        assertEquals(ChargerKind.Dc, classifyChargerKind("CCS"))
        assertEquals(ChargerKind.Dc, classifyChargerKind("J1772"))
        assertEquals(ChargerKind.Home, classifyChargerKind(""))
        assertEquals(ChargerKind.Home, classifyChargerKind(null))
        assertEquals(ChargerKind.Home, classifyChargerKind("<invalid>"))
    }

    // ---- Energy conversion (web convertEnergyFromSI(wh, 'kWh')) ---------------------

    @Test
    fun energyKwh_convertsWattHoursAndCoercesNull() {
        assertEquals(30.0, ChargeSessionChartProjection.energyKwh(30_000.0), EPS)
        assertEquals(0.0, ChargeSessionChartProjection.energyKwh(null), EPS)
    }

    // ---- Projection (chartData map+reverse + stats useMemo) ------------------------

    @Test
    fun project_reversesLabelsConvertsEnergyAndClassifies() {
        val view =
            project(
                listOf(
                    session(1, "2024-06-11T10:00:00Z", "Tesla Supercharger", 30_000.0),
                    session(2, "2024-06-12T10:00:00Z", "CCS", 20_000.0),
                    session(3, "2024-06-13T10:00:00Z", null, 10_000.0),
                ),
            )

        assertTrue(view.hasData)
        assertEquals(3, view.bars.size)
        // Reversed: oldest-fetched row reads left-to-right (web `.reverse()`).
        assertEquals("Jun 13", view.bars[0].label)
        assertEquals(ChargerKind.Home, view.bars[0].kind)
        assertEquals(10.0, view.bars[0].energyKwh, EPS)
        assertEquals("Jun 12", view.bars[1].label)
        assertEquals(ChargerKind.Dc, view.bars[1].kind)
        assertEquals("Jun 11", view.bars[2].label)
        assertEquals(ChargerKind.Supercharger, view.bars[2].kind)
        assertEquals(30.0, view.bars[2].energyKwh, EPS)
    }

    @Test
    fun project_computesTotalAvgSessionsStats() {
        val view =
            project(
                listOf(
                    session(1, "2024-06-11T10:00:00Z", "Supercharger", 30_000.0),
                    session(2, "2024-06-12T10:00:00Z", "CCS", 20_000.0),
                    session(3, "2024-06-13T10:00:00Z", null, 10_000.0),
                ),
            )

        assertEquals(3, view.stats.size)
        assertEquals(ChargeSummaryStat("Total", "60.0", "kWh"), view.stats[0])
        assertEquals(ChargeSummaryStat("Avg", "20.0", "kWh"), view.stats[1])
        assertEquals(ChargeSummaryStat("Sessions", "3", null), view.stats[2])
    }

    @Test
    fun project_emptySessionsHasNoDataNoStats() {
        val view = project(emptyList())

        assertFalse(view.hasData)
        assertTrue(view.bars.isEmpty())
        assertTrue(view.stats.isEmpty())
    }

    @Test
    fun project_compactKeepsStatsAndBars() {
        val view =
            project(
                listOf(session(1, "2024-06-11T10:00:00Z", "Supercharger", 30_000.0)),
                ChargeSessionChartSize(1, 1),
            )

        assertTrue(view.isCompact)
        assertEquals(1, view.bars.size)
        assertEquals(3, view.stats.size)
    }

    @Test
    fun project_missingEnergyContributesZero() {
        val view =
            project(
                listOf(
                    session(1, "2024-06-11T10:00:00Z", "Supercharger", null),
                    session(2, "2024-06-12T10:00:00Z", "CCS", 10_000.0),
                ),
            )

        assertEquals(0.0, view.bars[1].energyKwh, EPS) // reversed → s1 with null energy
        assertEquals(ChargeSummaryStat("Total", "10.0", "kWh"), view.stats[0])
        assertEquals(ChargeSummaryStat("Avg", "5.0", "kWh"), view.stats[1])
    }

    // ---- Footprint flags + registry bounds (web isCompact / isWide) ----------------

    @Test
    fun sizeFlags_matchWeb() {
        assertTrue(ChargeSessionChartSize(1, 1).isCompact)
        assertFalse(ChargeSessionChartSize(1, 2).isCompact) // compact needs cols<=1 AND rows<=1
        assertFalse(ChargeSessionChartSize(2, 4).isWide)
        assertTrue(ChargeSessionChartSize(3, 4).isWide)
        assertTrue(ChargeSessionChartSize(4, 40).isWide)
    }

    @Test
    fun registry_metadataAndBounds() {
        assertEquals("charge-session-chart", ChargeSessionChartRegistration.ID)
        assertEquals("charging", ChargeSessionChartRegistration.CATEGORY)
        assertEquals("ChargeSessionChartWidget", ChargeSessionChartRegistration.SLUG)
        assertEquals(10, ChargeSessionChartRegistration.SESSION_LIMIT)
        assertEquals(ChargeSessionChartSize(2, 4), ChargeSessionChartRegistration.defaultSize)
        assertTrue(ChargeSessionChartRegistration.withinBounds(ChargeSessionChartSize(1, 2)))
        assertFalse(ChargeSessionChartRegistration.withinBounds(ChargeSessionChartSize(5, 40)))
        assertEquals(ChargeSessionChartSize(1, 2), ChargeSessionChartRegistration.clamp(ChargeSessionChartSize(0, 0)))
        assertEquals(ChargeSessionChartSize(4, 40), ChargeSessionChartRegistration.clamp(ChargeSessionChartSize(9, 99)))
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
            val rows = listOf(session(1, "2024-06-11T10:00:00Z", "Supercharger", 30_000.0))
            val vm = viewModel(Resource.Loading(null, null, false), Resource.Success(rows, NOW, false))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, requireNotNull(state.data).size)
            assertEquals(NOW, state.fetchedAt)
        }

    @Test
    fun viewModel_emptyListRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(Resource.Success(emptyList(), NOW, false))
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
            val rows = listOf(session(1, "2024-06-11T10:00:00Z", "Supercharger", 30_000.0))
            val vm =
                viewModel(
                    Resource.Loading(null, null, false),
                    Resource.Error(rows, NOW, true, ApiError.Timeout()),
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
            val rows = listOf(session(1, "2024-06-11T10:00:00Z", "Supercharger", 30_000.0))
            val vm = ChargeSessionChartViewModel(source(Resource.Success(rows, NOW, false)), logger, backgroundScope)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChargeSessionChartWidget", opened.single().second["slug"])
        }

    // ---- Helpers -------------------------------------------------------------------

    private fun source(vararg emissions: Resource<List<ChargingSession>>): ChargeSessionChartSource =
        ChargeSessionChartSource {
            flow { emissions.forEach { emit(it) } }
        }

    private fun TestScope.viewModel(vararg emissions: Resource<List<ChargingSession>>): ChargeSessionChartViewModel =
        ChargeSessionChartViewModel(source(*emissions), NoopLogger, backgroundScope)

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
        const val VEHICLE_ID = 7L
    }
}
