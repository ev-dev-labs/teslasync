package io.teslasync.android.dashboardwidgets.livesignalsparklines

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalDescriptor
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalUnitKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Tests [LiveSignalSparklinesWidgetViewModel] against the [LiveSignalSparklinesSource] seam with a fake
 * feed, plus the [liveSparklinesResource] cache-then-network adapter directly — covering every state the
 * web widget renders (loading / content / empty / hard error / offline-cached), the active-vehicle
 * resolution (preferred id vs. first enrolled), the refresh + retry re-fetch, and the one-shot
 * `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalSparklinesWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals("BatteryLevel" to SignalValue.Num(72.0)))),
                    history = success(history(listOf(70.0, 71.0, 71.5, 72.0))),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.rows?.size)
            assertEquals(
                72.0,
                ui.data
                    ?.rows
                    ?.first()
                    ?.currentValue,
            )
            assertTrue(
                ui.data
                    ?.rows
                    ?.first()
                    ?.hasSparkline == true,
            )
        }

    @Test
    fun noConfiguredSignalsIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    available = success(catalog()),
                    live = listOf(success(liveSignals())),
                )
            val vm =
                LiveSignalSparklinesWidgetViewModel(
                    source,
                    RecordingLogger(),
                    backgroundScope,
                    configuredSignals = emptyList(),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals())),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals())),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun liveLoadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    available = success(catalog("BatteryLevel")),
                    live = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    history = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedRowsWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    available = success(catalog("BatteryLevel")),
                    live =
                        listOf(
                            Resource.Error(
                                cached = liveSignals("BatteryLevel" to SignalValue.Num(50.0)),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    history = success(history(listOf(48.0, 49.0, 50.0, 50.0))),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(
                50.0,
                ui.data
                    ?.rows
                    ?.first()
                    ?.currentValue,
            )
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals("BatteryLevel" to SignalValue.Num(33.0)))),
                    history = success(history(listOf(30.0, 31.0, 32.0, 33.0))),
                )
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(
                33.0,
                ui.data
                    ?.rows
                    ?.first()
                    ?.currentValue,
            )
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReFetchesPreferredVehicleAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), available = success(catalog()), live = emptyList())
            val vm = LiveSignalSparklinesWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2L, source.refreshedId)
            assertEquals(1, source.refreshCount)
            assertTrue(logger.records.any { it.event == "liveSignalSparklines.refresh" })
        }

    @Test
    fun refreshResolvesFirstVehicleWhenNoPreferredId() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(vehicles = listOf(success(listOf(vehicle(7)))), available = success(catalog()), live = emptyList())
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(7L, source.refreshedId)
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), available = success(catalog()), live = emptyList())
            val vm = LiveSignalSparklinesWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)

            vm.retry()
            advanceUntilIdle()

            assertEquals(4L, source.refreshedId)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                LiveSignalSparklinesWidgetViewModel(
                    FakeSource(emptyList(), success(catalog()), emptyList()),
                    logger,
                    backgroundScope,
                )

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("LiveSignalSparklinesWidget", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsSignalsDirectly() =
        runTest {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals("BatteryLevel" to SignalValue.Num(44.0)))),
                    history = success(history(listOf(40.0, 42.0, 43.0, 44.0))),
                )
            val result = liveSparklinesResource(source, preferredVehicleId = 2L, configSignals = null).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(
                44.0,
                result.cached
                    ?.rows
                    ?.first()
                    ?.currentValue,
            )
        }

    @Test
    fun adapterResolvesFirstVehicleForSignals() =
        runTest {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(7)))),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals("BatteryLevel" to SignalValue.Num(60.0)))),
                    history = success(history(listOf(58.0, 59.0, 60.0, 60.0))),
                )
            val result = liveSparklinesResource(source, preferredVehicleId = null, configSignals = null).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(
                60.0,
                result.cached
                    ?.rows
                    ?.first()
                    ?.currentValue,
            )
        }

    @Test
    fun adapterEmitsEmptyWhenFleetEmpty() =
        runTest {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals())),
                    history = success(history(emptyList())),
                )
            val result = liveSparklinesResource(source, preferredVehicleId = null, configSignals = null).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals())),
                )
            val result = liveSparklinesResource(source, preferredVehicleId = null, configSignals = null).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    available = success(catalog("BatteryLevel")),
                    live = listOf(success(liveSignals())),
                )
            val result = liveSparklinesResource(source, preferredVehicleId = null, configSignals = null).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val available: Resource<AvailableSignalsResponse>,
        private val live: List<Resource<LiveSignalsResponse>>,
        private val history: Resource<SignalHistoryResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : LiveSignalSparklinesSource {
        var refreshedId: Long? = null
            private set
        var refreshCount = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> = flowOf(available)

        override fun liveSignals(vehicleId: Long): Flow<Resource<LiveSignalsResponse>> = live.asFlow()

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = flowOf(history)

        override suspend fun refresh(vehicleId: Long) {
            refreshedId = vehicleId
            refreshCount++
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

    private fun success(available: AvailableSignalsResponse): Resource<AvailableSignalsResponse> =
        Resource.Success(available, fetchedAt = 100L, stale = false)

    private fun success(live: LiveSignalsResponse): Resource<LiveSignalsResponse> = Resource.Success(live, fetchedAt = 100L, stale = false)

    private fun success(history: SignalHistoryResponse): Resource<SignalHistoryResponse> =
        Resource.Success(history, fetchedAt = 100L, stale = false)

    private fun catalog(vararg names: String): AvailableSignalsResponse =
        AvailableSignalsResponse(
            vehicleId = 1L,
            count = names.size,
            source = "test",
            signals =
                names.map { name ->
                    SignalDescriptor(
                        name = name,
                        category = "telemetry",
                        valueKind = SignalKind.Float,
                        unitKind = SignalUnitKind.None,
                        isCompound = false,
                        isSettingUnit = false,
                    )
                },
        )

    private fun liveSignals(vararg entries: Pair<String, SignalValue>): LiveSignalsResponse =
        LiveSignalsResponse(
            vehicleId = 1L,
            count = entries.size,
            at = "",
            signals = entries.associate { (name, value) -> name to SignalEnvelope(SignalKind.Float, value, "") },
        )

    private fun history(values: List<Double>): SignalHistoryResponse =
        SignalHistoryResponse(
            vehicleId = 1L,
            signal = "BatteryLevel",
            expectedKind = "ValueKindFloat",
            from = "",
            to = "",
            count = values.size,
            data = values.map { SignalEnvelope(SignalKind.Float, SignalValue.Num(it), "") },
        )

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
