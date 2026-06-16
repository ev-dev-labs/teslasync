@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.costanalysis

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import kotlin.time.Instant

/**
 * Drives [CostAnalysisPageViewModel] over a controllable fake [CostAnalysisPageSource], covering the sessions
 * feed's cache-then-network state matrix (loading / content / empty / error / no-vehicle), the always-rendered
 * forecast feed, the date-range filter re-fetch, the settings-derived display preference, and the PII-safe
 * `view.opened` diagnostic — end to end through the real `Resource → UiState` projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CostAnalysisPageViewModelTest {
    private val emptyObject: JsonElement = JsonObject(emptyMap())

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

    private class FakeSource(
        val selected: MutableStateFlow<Long?> = MutableStateFlow(1L),
        var sessions: List<Resource<List<ChargingSession>>> =
            listOf(Resource.Success(emptyList(), 0L, false)),
        var forecast: List<Resource<JsonElement>> =
            listOf(Resource.Success(JsonObject(emptyMap()), 0L, false)),
        val settingsFlow: MutableStateFlow<Resource<JsonElement>> =
            MutableStateFlow(Resource.Success(JsonObject(emptyMap()), 0L, false)),
    ) : CostAnalysisPageSource {
        var sessionsCalls = 0
        var lastStart: String? = null
        var lastEnd: String? = null

        override fun selectedVehicleId(): StateFlow<Long?> = selected

        override fun sessionsPaginated(
            vehicleId: Long,
            start: String?,
            end: String?,
        ): Flow<Resource<List<ChargingSession>>> {
            sessionsCalls++
            lastStart = start
            lastEnd = end
            return flow { sessions.forEach { emit(it) } }
        }

        override fun costForecast(vehicleId: Long): Flow<Resource<JsonElement>> = flow { forecast.forEach { emit(it) } }

        override fun settings(): StateFlow<Resource<JsonElement>> = settingsFlow
    }

    @Test
    fun sessionsContentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(sessions = listOf(Resource.Success(listOf(session()), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.sessionsState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.sessionsState.value.isContent)
            assertEquals(1, vm.sessionsState.value.data?.size)
        }

    @Test
    fun sessionsEmptyWhenNoSessions() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(sessions = listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.sessionsState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.sessionsState.value.isEmpty)
        }

    @Test
    fun sessionsEmptyWhenNoVehicleSelected() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(selected = MutableStateFlow(null), sessions = listOf(Resource.Success(listOf(session()), 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.sessionsState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.sessionsState.value.isEmpty)
            assertEquals(0, src.sessionsCalls) // no fetch without a vehicle
        }

    @Test
    fun sessionsHardErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(sessions = listOf(Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.sessionsState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.sessionsState.value.isError)
            assertTrue(vm.sessionsState.value.canRetry)
        }

    @Test
    fun forecastRendersContentNotGatedEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(forecast = listOf(Resource.Success(emptyObject, 100L, false))))
            backgroundScope.launch { vm.forecastState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.forecastState.value.isContent)
            assertFalse(vm.forecastState.value.isEmpty)
        }

    @Test
    fun setRangeUpdatesRangeAndRefetchesWithNewDates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(sessions = listOf(Resource.Success(listOf(session()), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.sessionsState.collect {} }
            advanceUntilIdle()

            vm.setRange(LocalDate.of(2023, 1, 1), LocalDate.of(2023, 12, 31))
            advanceUntilIdle()

            assertEquals(LocalDate.of(2023, 1, 1), vm.range.value.start)
            assertEquals("2023-01-01", src.lastStart)
            assertEquals("2023-12-31", src.lastEnd)
        }

    @Test
    fun displayPrefsReflectMilesSetting() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    settingsFlow =
                        MutableStateFlow(
                            Resource.Success(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""), 0L, false),
                        ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertTrue(vm.displayPrefs.value.isMiles)
            assertEquals("mi", vm.displayPrefs.value.distanceUnit)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "CostAnalysisPage"), opened.single().second)
        }

    private fun session(): ChargingSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.parse("2024-01-15T10:00:00Z"),
            vehicleId = 1L,
            avgPowerW = null,
            cableType = null,
            chargerType = null,
            costCurrency = null,
            costDecimal = 10.0,
            deltaSocPct = null,
            endOdometerM = null,
            endSocPct = null,
            endedAt = null,
            peakPowerW = null,
            startLat = null,
            startLng = null,
            startOdometerM = null,
            startPlace = null,
            startSocPct = null,
            totalEnergyAddedWh = 12_000.0,
        )

    private fun TestScope.viewModel(
        source: CostAnalysisPageSource,
        logger: Logger = RecordingLogger(),
    ): CostAnalysisPageViewModel = CostAnalysisPageViewModel(source, logger, backgroundScope)
}
