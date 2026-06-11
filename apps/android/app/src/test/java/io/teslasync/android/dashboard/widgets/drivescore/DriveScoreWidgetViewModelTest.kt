package io.teslasync.android.dashboard.widgets.drivescore

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [DriveScoreWidgetViewModel] over a controllable fake [DriveScoreSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch), the settings-derived display preferences (web
 * `useUnits`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveScoreWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : DriveScoreSource {
        var fleetEmissions: List<Resource<JsonElement>> = listOf(loadingAnalytics())
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = flow { fleetEmissions.forEach { emit(it) } }

        override fun settings(): Flow<Resource<JsonElement>> = flow { settingsEmissions.forEach { emit(it) } }
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
    fun loadingWhileAnalyticsLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenAnalyticsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.fleetEmissions = listOf(Resource.Success(analyticsJson(300.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            val data = parseDriveScore(state.data)
            assertTrue(data.hasData)
            assertEquals(300.0, data.efficiencyWhKm, 0.0)
        }

    @Test
    fun emptyWhenAnalyticsPayloadIsEmptyObject() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.fleetEmissions = listOf(Resource.Success(JsonObject(emptyMap()), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenAnalyticsFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.fleetEmissions = listOf(loadingAnalytics(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedAnalyticsWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val cached = analyticsJson(420.0)
            src.fleetEmissions = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.fleetEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(420.0, parseDriveScore(state.data).efficiencyWhKm, 0.0)
        }

    @Test
    fun refreshReFetchesUpdatedAnalytics() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.fleetEmissions = listOf(Resource.Success(analyticsJson(200.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(200.0, parseDriveScore(vm.state.value.data).efficiencyWhKm, 0.0)

            src.fleetEmissions = listOf(Resource.Success(analyticsJson(600.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(600.0, parseDriveScore(vm.state.value.data).efficiencyWhKm, 0.0)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions = listOf(Resource.Success(buildJsonObject { put("unit_of_length", "mi") }, 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals(DistanceUnitPref.MI, vm.displayPrefs.value.distanceUnit)
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
            assertEquals(mapOf("surface" to "DriveScoreWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutScorePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "driveScore.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("efficiency") })
            assertFalse(logger.events.any { it.second.containsKey("score") })
        }

    private fun TestScope.viewModel(
        source: DriveScoreSource,
        logger: Logger = NoopLogger,
    ): DriveScoreWidgetViewModel = DriveScoreWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loadingAnalytics(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun analyticsJson(efficiency: Double): JsonElement =
            buildJsonObject {
                put("period_days", 7)
                put("total_vehicles", 1)
                put("avg_efficiency_wh_km", efficiency)
            }
    }
}
