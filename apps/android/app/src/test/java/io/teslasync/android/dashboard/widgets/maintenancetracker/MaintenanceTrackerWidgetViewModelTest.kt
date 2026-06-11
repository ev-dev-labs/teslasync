package io.teslasync.android.dashboard.widgets.maintenancetracker

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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [MaintenanceTrackerWidgetViewModel] over a controllable fake [MaintenanceTrackerSource], covering
 * the cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / records-error tolerance / refresh re-fetch), the settings-derived display
 * preferences (web `useUnits`/`useFormatting`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MaintenanceTrackerWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : MaintenanceTrackerSource {
        var maintenanceEmissions: List<Resource<JsonElement>> = listOf(loadingJson())
        var recordsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(emptyArrayJson(), 0L, false))
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun maintenance(): Flow<Resource<JsonElement>> = flow { maintenanceEmissions.forEach { emit(it) } }

        override fun serviceRecords(): Flow<Resource<JsonElement>> = flow { recordsEmissions.forEach { emit(it) } }

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
    fun loadingWhileFeedsLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenMaintenanceHasItems() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(Resource.Success(itemsJson(), 100L, false))
            src.recordsEmissions = listOf(Resource.Success(emptyArrayJson(), 80L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(1, state.data?.items?.size)
        }

    @Test
    fun emptyWhenBothFeedsResolveEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(Resource.Success(emptyArrayJson(), 10L, false))
            src.recordsEmissions = listOf(Resource.Success(emptyArrayJson(), 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWhenMaintenanceFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(errorJson(cached = null))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
        }

    @Test
    fun offlineKeepsCachedMaintenanceVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(errorJson(cached = itemsJson()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertEquals(1, state.data?.items?.size)
        }

    @Test
    fun toleratesRecordsErrorAsSupplementary() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(Resource.Success(itemsJson(), 100L, false))
            src.recordsEmissions = listOf(errorJson(cached = null))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertFalse(state.hasError)
        }

    @Test
    fun refreshReFetchesAfterError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.maintenanceEmissions = listOf(errorJson(cached = null))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)

            src.maintenanceEmissions = listOf(Resource.Success(itemsJson(), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun displayPrefsDerivedFromSettings() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions =
                listOf(
                    Resource.Success(
                        buildJsonObject {
                            put("unit_of_length", "mi")
                            put("currency_symbol", "€")
                            put("decimal_precision", 0)
                        },
                        0L,
                        false,
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()

            val prefs = vm.displayPrefs.value
            assertEquals(DistanceUnitPref.MI, prefs.unitPref.distance)
            assertEquals("€", prefs.currencySymbol)
            assertEquals(0, prefs.precision)
        }

    @Test
    fun displayPrefsDefaultToMetricBeforeSettingsLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            assertEquals(DistanceUnitPref.KM, vm.displayPrefs.value.unitPref.distance)
            assertEquals("$", vm.displayPrefs.value.currencySymbol)
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
            assertEquals(mapOf("surface" to "MaintenanceTrackerWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutMaintenancePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "maintenanceTracker.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("name") })
            assertFalse(logger.events.any { it.second.containsKey("cost") })
        }

    private fun TestScope.viewModel(
        source: MaintenanceTrackerSource,
        logger: Logger = NoopLogger,
    ): MaintenanceTrackerWidgetViewModel = MaintenanceTrackerWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun errorJson(cached: JsonElement?): Resource<JsonElement> =
            Resource.Error(
                cached = cached,
                fetchedAt = 50L,
                stale = cached != null,
                error = ApiError.Network(),
            )

        fun emptyArrayJson(): JsonElement = buildJsonArray { }

        fun itemsJson(): JsonElement =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 2)
                        put("name", "Tire Rotation")
                        put("interval_miles", 10000.0)
                    },
                )
            }
    }
}
