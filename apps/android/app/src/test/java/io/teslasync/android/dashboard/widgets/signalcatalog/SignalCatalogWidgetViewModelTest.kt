package io.teslasync.android.dashboard.widgets.signalcatalog

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SignalCatalogWidgetViewModel] over a controllable fake [SignalCatalogSource], plus the
 * [signalCatalogResource] cache-then-network adapter directly — covering every state the web component
 * renders (loading / content / empty / hard error + retry / stale-offline + retry), the observation-count
 * composition (first-enrolled vs. bound vehicle), the catalog-driven freshness envelope, the refresh +
 * retry re-fetch, and the PII-safe `view.opened` + refresh diagnostics.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalCatalogWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────

    @Test
    fun loadingWhenCatalogLoadingNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(catalog = listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWithEntriesAndObservationCounts() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    catalog = listOf(successCatalog(listOf(entry("BatteryLevel", "battery", "%")))),
                    vehicles = listOf(successVehicles(listOf(vehicleFixture(1)))),
                    observations = successObservations(listOf(observation("BatteryLevel"), observation("BatteryLevel"))),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.entries?.size)
            assertEquals(2, ui.data?.observationCounts?.get("BatteryLevel"))
        }

    @Test
    fun emptyWhenCatalogHasNoEntries() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(catalog = listOf(successCatalog(emptyList()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    catalog = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertEquals(ErrorKind.Network, ui.errorKind)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedCatalogWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    catalog =
                        listOf(
                            Resource.Error(
                                cached = listOf(entry("BatteryLevel", "battery", "%")),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Timeout(),
                            ),
                        ),
                    vehicles = listOf(successVehicles(listOf(vehicleFixture(1)))),
                    observations = successObservations(listOf(observation("BatteryLevel"))),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.entries?.size)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(ErrorKind.Timeout, ui.errorKind)
        }

    @Test
    fun boundVehicleIdResolvesObservationsWithoutFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    catalog = listOf(successCatalog(listOf(entry("BatteryLevel", "battery", "%")))),
                    vehicles = listOf(successVehicles(emptyList())),
                    observations = successObservations(listOf(observation("BatteryLevel"))),
                )
            val vm = SignalCatalogWidgetViewModel(source, NoopLogger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(
                1,
                vm.state.value.data
                    ?.observationCounts
                    ?.get("BatteryLevel"),
            )
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────

    @Test
    fun refreshReFetchesBoundVehicleAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(catalog = listOf(successCatalog(emptyList())))
            val vm = SignalCatalogWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2L, source.refreshedId)
            assertEquals(1, source.refreshCount)
            assertTrue(logger.events.any { it.first == "signalCatalog.refresh" })
        }

    @Test
    fun refreshResolvesFirstVehicleWhenNoBoundId() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    catalog = listOf(successCatalog(emptyList())),
                    vehicles = listOf(successVehicles(listOf(vehicleFixture(7)))),
                )
            val vm = viewModel(source)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(7L, source.refreshedId)
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(catalog = listOf(successCatalog(emptyList())))
            val vm = SignalCatalogWidgetViewModel(source, NoopLogger, backgroundScope, vehicleId = 4L)

            vm.retry()
            advanceUntilIdle()

            assertEquals(4L, source.refreshedId)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(catalog = listOf(successCatalog(emptyList()))), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SignalCatalogWidget"), opened.single().second)
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────

    @Test
    fun adapterBoundIdStreamsCatalogAndCounts() =
        runTest {
            val source =
                FakeSource(
                    catalog = listOf(successCatalog(listOf(entry("BatteryLevel", "battery", "%")))),
                    vehicles = listOf(successVehicles(emptyList())),
                    observations = successObservations(listOf(observation("BatteryLevel"))),
                )
            val result = signalCatalogResource(source, preferredVehicleId = 2L).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(1, result.cached?.entries?.size)
            assertEquals(1, result.cached?.observationCounts?.get("BatteryLevel"))
        }

    @Test
    fun adapterResolvesFirstVehicleForCounts() =
        runTest {
            val source =
                FakeSource(
                    catalog = listOf(successCatalog(listOf(entry("BatteryLevel", "battery", "%")))),
                    vehicles = listOf(successVehicles(listOf(vehicleFixture(7)))),
                    observations = successObservations(listOf(observation("BatteryLevel"), observation("BatteryLevel"))),
                )
            val result = signalCatalogResource(source, preferredVehicleId = null).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(2, result.cached?.observationCounts?.get("BatteryLevel"))
        }

    @Test
    fun adapterEmitsEmptySnapshotWhenCatalogEmpty() =
        runTest {
            val source = FakeSource(catalog = listOf(successCatalog(emptyList())))
            val result = signalCatalogResource(source, preferredVehicleId = null).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterStaysLoadingWhileCatalogLoads() =
        runTest {
            val source = FakeSource(catalog = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val result = signalCatalogResource(source, preferredVehicleId = 2L).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesCatalogErrorWhenNoCache() =
        runTest {
            val source =
                FakeSource(
                    catalog = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val result = signalCatalogResource(source, preferredVehicleId = 2L).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: SignalCatalogSource,
        logger: Logger = NoopLogger,
    ): SignalCatalogWidgetViewModel = SignalCatalogWidgetViewModel(source, logger, backgroundScope)

    private class FakeSource(
        private val catalog: List<Resource<List<SignalCatalogEntry>>>,
        private val vehicles: List<Resource<List<Vehicle>>> = listOf(Resource.Success(emptyList(), 100L, false)),
        private val observations: Resource<List<SignalObservation>> = Resource.Success(emptyList(), 100L, false),
    ) : SignalCatalogSource {
        var refreshedId: Long? = null
            private set
        var refreshCount = 0
            private set

        override fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>> = catalog.asFlow()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun signalObservations(vehicleId: Long): Flow<Resource<List<SignalObservation>>> = flowOf(observations)

        override suspend fun refresh(vehicleId: Long?) {
            refreshedId = vehicleId
            refreshCount++
        }
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
}

// ── top-level builders ─────────────────────────────────────────────────────────────

private fun entry(
    name: String,
    module: String = "battery",
    unit: String? = null,
): SignalCatalogEntry =
    SignalCatalogEntry(
        name = name,
        valueType = "numeric",
        sourceModule = module,
        unit = unit,
        description = null,
        firstSeenAt = "",
        lastSeenAt = "",
    )

private fun observation(signalName: String): SignalObservation =
    SignalObservation(
        vehicleId = 1L,
        ts = "2024-01-15T10:00:00Z",
        signalName = signalName,
        valueNumeric = 1.0,
        valueText = null,
        valueBool = null,
        source = "fleet_telemetry",
    )

private fun vehicleFixture(id: Long): Vehicle =
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

private fun successCatalog(entries: List<SignalCatalogEntry>): Resource<List<SignalCatalogEntry>> =
    Resource.Success(entries, fetchedAt = 100L, stale = false)

private fun successVehicles(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

private fun successObservations(observations: List<SignalObservation>): Resource<List<SignalObservation>> =
    Resource.Success(observations, fetchedAt = 100L, stale = false)
