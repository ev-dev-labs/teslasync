package io.teslasync.android.featureviews.infrastructurestatus

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
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
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [InfrastructureStatusSectionViewModel] over a fake [InfrastructureStatusSectionSource] — covering
 * every state the web component renders from its two polled `useQuery` feeds (loading / content / empty /
 * hard error / offline-cached), the refresh + retry re-subscribe, and the one-shot `view.opened` diagnostic.
 * Run by the offline `:app:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InfrastructureStatusSectionViewModelTest {
    @Test
    fun loadsContentFromBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    telemetry = listOf(loading(), successJson(telemetryObject())),
                    health = listOf(loading(), successJson(healthObject())),
                )
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data?.telemetry is JsonObject)
            assertTrue(ui.data?.health is JsonObject)
        }

    @Test
    fun loadingWhenTelemetryHasNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(telemetry = listOf(loading()), health = listOf(loading()))
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun emptyWhenTelemetryResolvesBlank() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    telemetry = listOf(successJson(JsonNull)),
                    health = listOf(successJson(JsonNull)),
                )
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWhenTelemetryErrorNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    telemetry = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    health = listOf(loading()),
                )
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSnapshotWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    telemetry =
                        listOf(
                            Resource.Error(
                                cached = telemetryObject(),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    health = listOf(successJson(healthObject())),
                )
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data?.telemetry is JsonObject)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeSource(
                    telemetry = listOf(successJson(telemetryObject())),
                    health = listOf(successJson(healthObject())),
                )
            val vm = InfrastructureStatusSectionViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.telemetryCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.telemetryCalls > before)
            assertTrue(logger.records.any { it.event == "infrastructureStatus.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    telemetry = listOf(successJson(telemetryObject())),
                    health = listOf(successJson(healthObject())),
                )
            val vm = InfrastructureStatusSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.telemetryCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.telemetryCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                InfrastructureStatusSectionViewModel(
                    FakeSource(telemetry = emptyList(), health = emptyList()),
                    logger,
                    backgroundScope,
                )

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("InfrastructureSection", opened.first().fields["slug"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val telemetry: List<Resource<JsonElement>>,
        private val health: List<Resource<JsonElement>>,
    ) : InfrastructureStatusSectionSource {
        var telemetryCalls = 0
            private set

        override fun telemetryStatus(): Flow<Resource<JsonElement>> {
            telemetryCalls++
            return telemetry.asFlow()
        }

        override fun systemHealth(): Flow<Resource<JsonElement>> = health.asFlow()
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

    private fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun telemetryObject(): JsonObject =
        buildJsonObject {
            put("enabled", true)
            put("mode", "fleet_telemetry")
            put("endpoint", "telemetry.tesla.com")
            put("protocol", "mqtt")
        }

    private fun healthObject(): JsonObject =
        buildJsonObject {
            put(
                "database_pool",
                buildJsonObject {
                    put("total_conns", 25)
                    put("acquired_conns", 4)
                    put("idle_conns", 21)
                },
            )
        }
}
