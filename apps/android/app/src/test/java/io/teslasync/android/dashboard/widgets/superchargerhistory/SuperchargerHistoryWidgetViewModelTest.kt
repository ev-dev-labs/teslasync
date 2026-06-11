package io.teslasync.android.dashboard.widgets.superchargerhistory

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
 * Drives [SuperchargerHistoryWidgetViewModel] over a controllable fake [SuperchargerHistorySource],
 * covering the full cache-then-network state matrix the web component renders (loading / content / empty /
 * hard error + retry / stale-offline + retry / refresh re-fetch), the empty gate on the entry list (web
 * `entries.length > 0`), the settings-derived display preferences (web `useUnits`/`useFormatting`), and the
 * PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SuperchargerHistoryWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : SuperchargerHistorySource {
        var historyEmissions: List<Resource<JsonElement>> = listOf(loading())
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun chargingHistory(): Flow<Resource<JsonElement>> = flow { historyEmissions.forEach { emit(it) } }

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
    fun loadingWhileHistoryLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenSessionsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.historyEmissions = listOf(Resource.Success(historyJson(sessions = 2, totalSpend = 30.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertTrue(parseSuperchargerHistory(state.data).hasEntries)
        }

    @Test
    fun emptyWhenNoSessions() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // A summary is present but the entry list is empty — the web gate is on entries, not the summary.
            src.historyEmissions = listOf(Resource.Success(historyJson(sessions = 0, totalSpend = 0.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenHistoryFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.historyEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedHistoryWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val cached = historyJson(sessions = 1, totalSpend = 12.0)
            src.historyEmissions = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.historyEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedHistory() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.historyEmissions = listOf(Resource.Success(historyJson(sessions = 1, totalSpend = 10.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, parseSuperchargerHistory(vm.state.value.data).entries.size)

            src.historyEmissions = listOf(Resource.Success(historyJson(sessions = 3, totalSpend = 40.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(3, parseSuperchargerHistory(vm.state.value.data).entries.size)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions =
                listOf(
                    Resource.Success(
                        buildJsonObject {
                            put("unit_of_length", "mi")
                            put("currency_symbol", "\u20AC")
                            put("decimal_precision", 3)
                        },
                        10L,
                        false,
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()

            val prefs = vm.displayPrefs.value
            assertEquals(DistanceUnitPref.MI, prefs.unitPref.distance)
            assertEquals("\u20AC", prefs.currencySymbol)
            assertEquals(3, prefs.precision)
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
            assertEquals(mapOf("surface" to "SuperchargerHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutSessionPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "superchargerHistory.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("site") })
            assertFalse(logger.events.any { it.second.containsKey("cost") })
        }

    private fun TestScope.viewModel(
        source: SuperchargerHistorySource,
        logger: Logger = NoopLogger,
    ): SuperchargerHistoryWidgetViewModel = SuperchargerHistoryWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun historyJson(
            sessions: Int,
            totalSpend: Double,
        ): JsonElement =
            buildJsonObject {
                put(
                    "entries",
                    buildJsonArray {
                        repeat(sessions) { i ->
                            add(
                                buildJsonObject {
                                    put("id", i.toLong())
                                    put("site_location_name", "Site $i")
                                    put("charge_start_datetime", "2025-03-${(i + 1).toString().padStart(2, '0')}T00:00:00Z")
                                    put("usage_wh", (i + 1) * 1000.0)
                                    put("total_due", (i + 1) * 5.0)
                                },
                            )
                        }
                    },
                )
                put(
                    "summary",
                    buildJsonObject {
                        put("total_sessions", sessions)
                        put("total_wh", sessions * 1000.0)
                        put("total_spend", totalSpend)
                    },
                )
            }
    }
}
