package io.teslasync.android.featureviews.anomalyinlinerow

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [AnomalyInlineRowViewModel] over a fake [AnomalyInlineRowSource], plus the [anomalyInlineResource]
 * cache-then-network adapter directly — covering every state the web component resolves from its
 * `useVehicles` + inline anomalies query (loading / content / empty / hard error / offline-cached), the
 * `vehicles?.[0]?.id` resolution, the `days=1` window threading, the refresh + retry re-fetch, and the
 * one-shot `view.opened` diagnostic. Run by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnomalyInlineRowViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    anomalies =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            successJson(anomalyEnvelope(count = 2)),
                        ),
                )
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
        }

    @Test
    fun noQualifyingAnomalyIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    anomalies = listOf(successJson(anomalyEnvelope(count = 0))),
                )
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), anomalies = emptyList())
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    anomalies = emptyList(),
                )
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    anomalies = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedEnvelopeWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    anomalies =
                        listOf(
                            Resource.Error(
                                cached = anomalyEnvelope(count = 2),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── ViewModel: window / refresh / retry / telemetry ───────────────────────────
    @Test
    fun requestsTheWebTwentyFourHourWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(listOf(vehicle(1)))), anomalies = listOf(successJson(anomalyEnvelope(2))))
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(ANOMALY_INLINE_WINDOW_DAYS, source.lastDays)
        }

    @Test
    fun refreshReCollectsAnomaliesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = listOf(success(listOf(vehicle(1)))), anomalies = listOf(successJson(anomalyEnvelope(2))))
            val vm = AnomalyInlineRowViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.anomaliesCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.anomaliesCalls > before)
            assertTrue(logger.records.any { it.event == "anomalyInlineRow.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(listOf(vehicle(1)))), anomalies = listOf(successJson(anomalyEnvelope(2))))
            val vm = AnomalyInlineRowViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.anomaliesCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.anomaliesCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AnomalyInlineRowViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AnomalyInlineRow", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterResolvesFirstVehicleForAnomalies() =
        runTest {
            val result =
                anomalyInlineResource(
                    vehicles = flowOf(success(listOf(vehicle(7)))),
                    days = ANOMALY_INLINE_WINDOW_DAYS,
                    anomaliesFor = { id, _ -> flowOf(successJson(buildJsonObject { put("vehicle_id", id) })) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals("7", ((result.cached as JsonObject)["vehicle_id"] as JsonPrimitive).content)
        }

    @Test
    fun adapterThreadsTheDaysWindow() =
        runTest {
            val result =
                anomalyInlineResource(
                    vehicles = flowOf(success(listOf(vehicle(1)))),
                    days = ANOMALY_INLINE_WINDOW_DAYS,
                    anomaliesFor = { _, days -> flowOf(successJson(buildJsonObject { put("days", days) })) },
                ).toList().last()
            assertEquals("1", ((result.cached as JsonObject)["days"] as JsonPrimitive).content)
        }

    @Test
    fun adapterEmitsNoVehicleWhenFleetEmpty() =
        runTest {
            val result =
                anomalyInlineResource(
                    vehicles = flowOf(success(emptyList())),
                    days = ANOMALY_INLINE_WINDOW_DAYS,
                    anomaliesFor = { _, _ -> flowOf(successJson(anomalyEnvelope(2))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                anomalyInlineResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    days = ANOMALY_INLINE_WINDOW_DAYS,
                    anomaliesFor = { _, _ -> flowOf(successJson(anomalyEnvelope(2))) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                anomalyInlineResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    days = ANOMALY_INLINE_WINDOW_DAYS,
                    anomaliesFor = { _, _ -> flowOf(successJson(anomalyEnvelope(2))) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    @Test
    fun firstVehicleIdResolvesTheWebRule() {
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
        assertEquals("7", firstVehicleId(listOf(vehicle(7), vehicle(8))))
    }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val anomalies: List<Resource<JsonElement>>,
    ) : AnomalyInlineRowSource {
        var anomaliesCalls = 0
            private set

        var lastDays = -1
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun anomalies(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> {
            anomaliesCalls++
            lastDays = days
            return anomalies.asFlow()
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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun anomalyEnvelope(count: Int): JsonElement =
        buildJsonObject {
            put("anomalies_last_24h", count)
            putJsonArray("anomalies") {
                add(
                    buildJsonObject {
                        put("signal", "BatteryVoltage")
                        put("severity", "critical")
                        put("detected_at", "2026-06-01T12:00:00Z")
                    },
                )
            }
        }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
