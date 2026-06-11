package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.vehicles.FakeVehiclesRepository
import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free Battery Analytics surface logic: the cached-JSON → display
 * projection (the "data adapter"), the score → severity thresholds (web `scoreColor`), the per-state
 * surface decision, the error-kind mapping, the `!!data` empty classification, the vehicle-resolution
 * fallback (web `vehicleId ?? vehicles?.[0]?.id`), and the registry size constraints — plus the
 * [BatteryHealthAnalyticsWidgetViewModel] state mapping over the source seam. No device required.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryHealthAnalyticsWidgetTest {
    // ── Adapter: cached SI/score JSON → display projection ──────────────────────

    @Test
    fun projectionReadsEverySnakeCaseField() {
        val ui = batteryHealthAnalyticsUi(fullJson())

        assertEquals(92.0, ui.healthScore, TOLERANCE)
        assertEquals(312.0, ui.totalCycles, TOLERANCE)
        assertEquals(18.0, ui.fullChargePct, TOLERANCE)
        assertEquals(47.0, ui.avgDepthOfDischarge, TOLERANCE)
        assertEquals(23.0, ui.fastChargePct, TOLERANCE)
        assertEquals(88.0, ui.tempExposureScore, TOLERANCE)
        assertEquals(74.0, ui.chargeHabitsScore, TOLERANCE)
        assertEquals(Severity.Success, ui.severity)
    }

    @Test
    fun camelCaseWireKeysAreTolerated() {
        val json =
            buildJsonObject {
                put("currentSoh", 64.0)
                put("totalCycles", 120.0)
                put("avgDepthOfDischarge", 55.0)
                put("fastChargePct", 12.0)
                put("fullChargePct", 80.0)
                put("tempExposureScore", 70.0)
                put("chargeHabitsScore", 66.0)
            }

        val ui = batteryHealthAnalyticsUi(json)

        assertEquals(64.0, ui.healthScore, TOLERANCE)
        assertEquals(120.0, ui.totalCycles, TOLERANCE)
        assertEquals(55.0, ui.avgDepthOfDischarge, TOLERANCE)
        assertEquals(12.0, ui.fastChargePct, TOLERANCE)
        assertEquals(80.0, ui.fullChargePct, TOLERANCE)
        assertEquals(70.0, ui.tempExposureScore, TOLERANCE)
        assertEquals(66.0, ui.chargeHabitsScore, TOLERANCE)
        assertEquals(Severity.Warn, ui.severity)
    }

    @Test
    fun missingFieldsCollapseToZero() {
        val ui = batteryHealthAnalyticsUi(null)

        assertEquals(0.0, ui.healthScore, TOLERANCE)
        assertEquals(0.0, ui.totalCycles, TOLERANCE)
        assertEquals(0.0, ui.fullChargePct, TOLERANCE)
        assertEquals(0.0, ui.avgDepthOfDischarge, TOLERANCE)
        assertEquals(0.0, ui.fastChargePct, TOLERANCE)
        assertEquals(0.0, ui.tempExposureScore, TOLERANCE)
        assertEquals(0.0, ui.chargeHabitsScore, TOLERANCE)
        assertEquals(Severity.Critical, ui.severity)
    }

    // ── Score → severity thresholds (web scoreColor) ────────────────────────────

    @Test
    fun severityThresholdsMatchWebScoreColor() {
        assertEquals(Severity.Success, batteryHealthScoreSeverity(100.0))
        assertEquals(Severity.Success, batteryHealthScoreSeverity(80.0))
        assertEquals(Severity.Warn, batteryHealthScoreSeverity(79.999))
        assertEquals(Severity.Warn, batteryHealthScoreSeverity(50.0))
        assertEquals(Severity.Critical, batteryHealthScoreSeverity(49.999))
        assertEquals(Severity.Critical, batteryHealthScoreSeverity(0.0))
    }

    // ── hasData / empty classification (web `!!data`) ───────────────────────────

    @Test
    fun hasDataReflectsObjectExistenceNotValues() {
        assertTrue(batteryHealthAnalyticsHasData(fullJson()))
        assertTrue(batteryHealthAnalyticsHasData(buildJsonObject {})) // empty object is still `!!data` true
        assertFalse(batteryHealthAnalyticsHasData(JsonNull))
        assertFalse(batteryHealthAnalyticsHasData(null))
    }

    // ── Per-state surface decision ──────────────────────────────────────────────

    @Test
    fun surfaceMapsEveryPhase() {
        assertEquals(BatteryHealthAnalyticsSurface.Loading, batteryHealthAnalyticsSurface(UiState<JsonElement>(UiPhase.Loading)))
        assertEquals(BatteryHealthAnalyticsSurface.Error, batteryHealthAnalyticsSurface(UiState<JsonElement>(UiPhase.Error)))
        assertEquals(BatteryHealthAnalyticsSurface.Empty, batteryHealthAnalyticsSurface(UiState<JsonElement>(UiPhase.Empty)))
        assertEquals(BatteryHealthAnalyticsSurface.Content, batteryHealthAnalyticsSurface(UiState<JsonElement>(UiPhase.Content)))
    }

    @Test
    fun offlineCachedStaysContentNotError() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = fullJson(),
                stale = true,
                errorKind = ErrorKind.Network,
            )

        assertEquals(BatteryHealthAnalyticsSurface.Content, batteryHealthAnalyticsSurface(offline))
        assertTrue(offline.isOffline)
    }

    // ── Error-kind mapping ──────────────────────────────────────────────────────

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, batteryHealthAnalyticsErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, batteryHealthAnalyticsErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, batteryHealthAnalyticsErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, batteryHealthAnalyticsErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, batteryHealthAnalyticsErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, batteryHealthAnalyticsErrorKind(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.ServerError, batteryHealthAnalyticsErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, batteryHealthAnalyticsErrorKind(ErrorKind.Unknown, null))
    }

    // ── Registry size constraints ───────────────────────────────────────────────

    @Test
    fun registryIdAndSpanConstraintsMatchWeb() {
        assertEquals("battery-health-analytics", BatteryHealthAnalyticsWidgetSpec.ID)
        assertEquals("battery", BatteryHealthAnalyticsWidgetSpec.CATEGORY)
        assertEquals(BatteryHealthSpan(2, 4), BatteryHealthAnalyticsWidgetSpec.defaultSpan)
        assertEquals(BatteryHealthSpan(1, 2), BatteryHealthAnalyticsWidgetSpec.coerceSpan(BatteryHealthSpan(0, 0)))
        assertEquals(BatteryHealthSpan(4, 40), BatteryHealthAnalyticsWidgetSpec.coerceSpan(BatteryHealthSpan(9, 99)))
        assertTrue(BatteryHealthAnalyticsWidgetSpec.isCompact(BatteryHealthSpan(1, 2)))
        assertFalse(BatteryHealthAnalyticsWidgetSpec.isCompact(BatteryHealthSpan(2, 2)))
    }

    // ── Vehicle resolution (web `vehicleId ?? vehicles?.[0]?.id`) ────────────────

    @Test
    fun resolveVehiclePicksFirstWhenAvailable() {
        val res = Resource.Success(listOf(vehicle(7), vehicle(9)), fetchedAt = 1L, stale = false)
        assertEquals(VehicleResolution.Resolved(7), resolveVehicle(res))
    }

    @Test
    fun resolveVehicleResolvingWhileLoadingWithoutCache() {
        val res = Resource.Loading<List<io.teslasync.shared.core.api.generated.Vehicle>>(cached = null, fetchedAt = null, stale = false)
        assertEquals(VehicleResolution.Resolving, resolveVehicle(res))
    }

    @Test
    fun resolveVehicleUsesCachedFirstIdEvenWhileLoading() {
        val res = Resource.Loading(cached = listOf(vehicle(3)), fetchedAt = 1L, stale = true)
        assertEquals(VehicleResolution.Resolved(3), resolveVehicle(res))
    }

    @Test
    fun resolveVehicleAbsentWhenFleetEmpty() {
        val res = Resource.Success(emptyList<io.teslasync.shared.core.api.generated.Vehicle>(), fetchedAt = 1L, stale = false)
        assertEquals(VehicleResolution.Absent, resolveVehicle(res))
    }

    // ── ViewModel state mapping over the source seam ────────────────────────────

    @Test
    fun viewModelLoadsContentForExplicitVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        Resource.Success(fullJson(), fetchedAt = 100L, stale = false),
                    ),
                )
            val vm = viewModel(source, explicitVehicleId = 7L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals("7", source.lastVehicleId)
        }

    @Test
    fun viewModelAbsentVehicleIsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository().apply { vehiclesEmissions = listOf(Resource.Success(emptyList(), 1L, false)) }
            val source = FakeSource(emptyList())
            val vm =
                BatteryHealthAnalyticsWidgetViewModel(
                    source = source,
                    vehicles = VehiclesStore(repo, backgroundScope),
                    logger = RecordingLogger(),
                    explicitVehicleId = null,
                    scope = backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(0, source.streamCalls) // no vehicle → no fetch (web query disabled)
        }

    @Test
    fun viewModelFallsBackToFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeVehiclesRepository().apply { vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(42)), 1L, false)) }
            val source = FakeSource(listOf(Resource.Success(fullJson(), fetchedAt = 100L, stale = false)))
            val vm =
                BatteryHealthAnalyticsWidgetViewModel(
                    source = source,
                    vehicles = VehiclesStore(repo, backgroundScope),
                    logger = RecordingLogger(),
                    explicitVehicleId = null,
                    scope = backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals("42", source.lastVehicleId)
        }

    @Test
    fun viewModelHardErrorWithNoCacheIsError() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val vm = viewModel(source, explicitVehicleId = 7L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertTrue(vm.state.value.hasError)
            assertNull(vm.state.value.data)
        }

    @Test
    fun viewModelOfflineKeepsCachedWithStale() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(cached = fullJson(), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                )
            val vm = viewModel(source, explicitVehicleId = 7L, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshAndRetryReFetch() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Success(fullJson(), fetchedAt = 100L, stale = false)))
            val logger = RecordingLogger()
            val vm =
                BatteryHealthAnalyticsWidgetViewModel(
                    source = source,
                    vehicles = VehiclesStore(FakeVehiclesRepository(), backgroundScope),
                    logger = logger,
                    explicitVehicleId = 7L,
                    scope = backgroundScope,
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, source.streamCalls)

            vm.refresh()
            advanceUntilIdle()
            assertEquals(2, source.streamCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(3, source.streamCalls)
            assertTrue(logger.records.any { it.event == "widget.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                BatteryHealthAnalyticsWidgetViewModel(
                    source = FakeSource(emptyList()),
                    vehicles = VehiclesStore(FakeVehiclesRepository(), backgroundScope),
                    logger = logger,
                    explicitVehicleId = 7L,
                    scope = backgroundScope,
                )

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BatteryHealthAnalyticsWidget", opened.first().fields["surface"])
        }

    // ── Fixtures ────────────────────────────────────────────────────────────────

    private fun viewModel(
        source: BatteryHealthAnalyticsSource,
        explicitVehicleId: Long,
        scope: kotlinx.coroutines.CoroutineScope,
    ): BatteryHealthAnalyticsWidgetViewModel =
        BatteryHealthAnalyticsWidgetViewModel(
            source = source,
            vehicles = VehiclesStore(FakeVehiclesRepository(), scope),
            logger = RecordingLogger(),
            explicitVehicleId = explicitVehicleId,
            scope = scope,
        )

    private class FakeSource(
        private val emissions: List<Resource<JsonElement>>,
    ) : BatteryHealthAnalyticsSource {
        var streamCalls = 0
            private set
        var lastVehicleId: String? = null
            private set

        override fun stream(vehicleId: String): Flow<Resource<JsonElement>> {
            streamCalls++
            lastVehicleId = vehicleId
            return emissions.asFlow()
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

    private fun fullJson(): JsonElement =
        buildJsonObject {
            put("current_soh", 92.0)
            put("total_cycles", 312.0)
            put("full_charge_pct", 18.0)
            put("avg_depth_of_discharge", 47.0)
            put("fast_charge_pct", 23.0)
            put("temp_exposure_score", 88.0)
            put("charge_habits_score", 74.0)
        }

    private companion object {
        const val TOLERANCE = 0.001
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_SERVER_ERROR = 500
    }
}
