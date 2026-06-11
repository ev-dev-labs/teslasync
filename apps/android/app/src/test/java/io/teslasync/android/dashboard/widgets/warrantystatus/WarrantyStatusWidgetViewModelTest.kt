package io.teslasync.android.dashboard.widgets.warrantystatus

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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [WarrantyStatusWidgetViewModel] over a controllable fake [WarrantyStatusSource], covering the
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the settings-derived display preferences (web `useUnits`), and
 * the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WarrantyStatusWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : WarrantyStatusSource {
        var warrantyEmissions: List<Resource<JsonElement>> = listOf(loading())
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun warrantyDetails(): Flow<Resource<JsonElement>> = flow { warrantyEmissions.forEach { emit(it) } }

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
    fun loadingWhileFeedLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenWarrantyHasData() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.warrantyEmissions = listOf(Resource.Success(envelope(warrantyDoc()), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertNotNull(warrantyData(state.data))
        }

    @Test
    fun emptyWhenDataDocumentIsNull() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.warrantyEmissions = listOf(Resource.Success(envelope(null), 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWhenWarrantyFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.warrantyEmissions = listOf(errorOf(cached = null))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
        }

    @Test
    fun offlineKeepsCachedWarrantyVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.warrantyEmissions = listOf(errorOf(cached = envelope(warrantyDoc())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertNotNull(warrantyData(state.data))
        }

    @Test
    fun refreshReFetchesAfterError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.warrantyEmissions = listOf(errorOf(cached = null))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)

            src.warrantyEmissions = listOf(Resource.Success(envelope(warrantyDoc()), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun displayPrefsDerivedFromSettings() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions = listOf(Resource.Success(buildJsonObject { put("unit_of_length", "mi") }, 0L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals(DistanceUnitPref.MI, vm.displayPrefs.value.unitPref.distance)
        }

    @Test
    fun displayPrefsDefaultToMetricBeforeSettingsLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            assertEquals(DistanceUnitPref.KM, vm.displayPrefs.value.unitPref.distance)
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
            assertEquals(mapOf("surface" to "WarrantyStatusWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutWarrantyPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "warrantyStatus.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("expiry") })
            assertFalse(logger.events.any { it.second.containsKey("mileage") })
        }

    private fun TestScope.viewModel(
        source: WarrantyStatusSource,
        logger: Logger = NoopLogger,
    ): WarrantyStatusWidgetViewModel = WarrantyStatusWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun errorOf(cached: JsonElement?): Resource<JsonElement> =
            Resource.Error(cached = cached, fetchedAt = 50L, stale = cached != null, error = ApiError.Network())

        fun warrantyDoc(): JsonObject =
            buildJsonObject {
                put("warranty_expiry_date", "2025-06-01")
                put("mileage_limit_mi", 80_467.0)
            }

        fun envelope(data: JsonObject?): JsonElement = buildJsonObject { put("data", data ?: JsonNull) }
    }
}
