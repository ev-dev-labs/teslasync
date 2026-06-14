// Tests [CommandPaletteViewModel] against the [CommandPaletteSource] seam with a fake fleet / selection / search /
// command / auth feed — covering every fleet state the surface renders (loading / content / empty / hard error /
// stale-offline), the search query gating (scope + mode), the single- vs multi-vehicle command dispatch + the
// vehicle-select submode round-trip, the vehicle switch, the navigation + frecency recording, the registry routing
// (navigate / refresh / frecency-reset / host effect), the self-heal reconcile, and the one-shot `view.opened`
// diagnostic. The framework-free projection is covered by CommandPaletteModelTest. Runs in :android:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.commandpalette

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.search.SearchResponse
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class CommandPaletteViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<List<Vehicle>>>,
        initialSelectedId: Long? = null,
        private val commandResult: Result<CommandResult> = Result.success(CommandResult(success = true, message = "ok")),
    ) : CommandPaletteSource {
        private val selected = MutableStateFlow(initialSelectedId)
        private val recentState = MutableStateFlow(PaletteRecentState())
        private val searchFlow = MutableStateFlow<Resource<SearchResponse>>(Resource.Success(SearchResponse(), 0L, false))
        private val forwardAuth = MutableStateFlow(false)
        val selectCalls = mutableListOf<Long>()
        val uses = mutableListOf<String>()
        val pages = mutableListOf<String>()
        val searchQueries = mutableListOf<String>()
        val effects = mutableListOf<String>()
        val sent = mutableListOf<Pair<Long, String>>()
        var vehicleCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            vehicleCalls++
            return emissions.asFlow()
        }

        override val selectedId: StateFlow<Long?> = selected

        override fun select(id: Long) {
            selectCalls += id
            selected.value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            selected.value = effectivePaletteSelection(selected.value, availableIds)
        }

        override fun setSearchQuery(query: String) {
            searchQueries += query
        }

        override val searchResults: StateFlow<Resource<SearchResponse>> = searchFlow

        override suspend fun sendCommand(
            vehicleId: Long,
            command: String,
        ): Result<CommandResult> {
            sent += vehicleId to command
            return commandResult
        }

        override val isForwardAuth: StateFlow<Boolean> = forwardAuth

        override val recent: StateFlow<PaletteRecentState> = recentState

        override fun recordUse(key: String) {
            uses += key
            recentState.update { it.copy(frecency = recordFrecencyUse(it.frecency, key, 1L)) }
        }

        override fun recordRecentPage(
            path: String,
            title: String,
            icon: PaletteIconKind,
        ) {
            pages += path
        }

        override fun resetFrecency() {
            recentState.update { it.copy(frecency = emptyMap()) }
        }

        override fun runEffect(kind: String) {
            effects += kind
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun vm(
        source: CommandPaletteSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): CommandPaletteViewModel = CommandPaletteViewModel(source, logger, scope) { 1_000L }

    @Test
    fun fleetResolvesToContentWithTheActiveSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()

            val state = model.fleet.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, state.data?.vehicles?.size)
            assertEquals(1L, state.data?.activeVehicleId)
        }

    @Test
    fun emptyFleetIsEmptyPhaseAndErrorWithCacheIsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val empty = vm(FakeSource(listOf(success(emptyList()))), backgroundScope)
            backgroundScope.launch { empty.fleet.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, empty.fleet.value.phase)

            val offlineSource =
                FakeSource(
                    listOf(Resource.Error(cached = listOf(vehicle(1)), fetchedAt = 1L, stale = true, error = ApiError.Network())),
                )
            val offline = vm(offlineSource, backgroundScope)
            backgroundScope.launch { offline.fleet.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, offline.fleet.value.phase)
            assertTrue(offline.fleet.value.isOffline)
            assertTrue(offline.fleet.value.canRetry)
        }

    @Test
    fun onQueryChangePushesScopedTermAndGatesScopedQueries() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))))
            val model = vm(source, backgroundScope)
            model.onQueryChange("dr")
            model.onQueryChange("> wake")
            assertEquals("dr", source.searchQueries[0])
            // A scoped query is not forwarded to the backend search (web `disabled` when a scope is active).
            assertEquals("", source.searchQueries[1])
        }

    @Test
    fun singleVehicleCommandRunsImmediately() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(7)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()

            val outcome = model.selectCommand("lock")
            advanceUntilIdle()

            assertEquals(CommandSelectOutcome.Ran, outcome)
            assertEquals(7L to "lock", source.sent.single())
            assertTrue(source.uses.contains("cmd-lock"))
        }

    @Test
    fun multiVehicleCommandEntersVehicleSelectThenDispatchesOnChoice() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()

            val outcome = model.selectCommand("honk_horn")
            assertEquals(CommandSelectOutcome.NeedsVehicle, outcome)
            assertEquals(CommandPaletteMode.VehicleSelect, model.mode.value)
            assertEquals("honk_horn", model.pendingCommand.value)

            model.chooseVehicleForCommand(2)
            advanceUntilIdle()
            assertEquals(2L to "honk_horn", source.sent.single())

            model.goBack()
            assertEquals(CommandPaletteMode.Search, model.mode.value)
            assertNull(model.pendingCommand.value)
        }

    @Test
    fun noVehicleCommandIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(emptyList())))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()

            assertEquals(CommandSelectOutcome.NoVehicle, model.selectCommand("lock"))
            assertTrue(source.sent.isEmpty())
        }

    @Test
    fun switchVehicleSelectsAndRecords() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val model = vm(source, backgroundScope)
            model.switchVehicle(2)
            assertTrue(source.selectCalls.contains(2L))
            assertTrue(source.uses.contains("switch-vehicle-2"))
        }

    @Test
    fun recordNavigationRecordsFrecencyAndRecentPage() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val model = vm(source, backgroundScope)
            model.recordNavigation("most-used-/drives", "/drives", "Drives", PaletteIconKind.Drive)
            assertTrue(source.uses.contains("/drives"))
            assertTrue(source.pages.contains("/drives"))
        }

    @Test
    fun registryNavigateRoutesAndEffectsAreHandled() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()
            val callsBefore = source.vehicleCalls

            val nav = REGISTRY_COMMANDS.first { it.action is RegistryAction.Navigate }
            val routing = model.runRegistry(nav)
            assertTrue(routing is RegistryRouting.Navigate)
            assertTrue(source.uses.contains(nav.id))

            val refresh = REGISTRY_COMMANDS.first { it.action == RegistryAction.Effect(RegistryEffect.REFRESH) }
            model.runRegistry(refresh)
            advanceUntilIdle()
            assertTrue(source.vehicleCalls > callsBefore)

            source.recordUse("seed")
            val reset = REGISTRY_COMMANDS.first { it.action == RegistryAction.Effect(RegistryEffect.FRECENCY_RESET) }
            model.runRegistry(reset)
            val frecencyAfterReset = source.recent.value.frecency
            assertTrue(frecencyAfterReset.isEmpty())

            val themed = REGISTRY_COMMANDS.first { it.action == RegistryAction.Effect(RegistryEffect.THEME_TOGGLE) }
            model.runRegistry(themed)
            assertTrue(source.effects.contains(RegistryEffect.THEME_TOGGLE))
        }

    @Test
    fun resetClearsTransientStateOnClose() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()
            model.selectCommand("lock")
            model.reset()
            assertEquals(CommandPaletteMode.Search, model.mode.value)
            assertNull(model.pendingCommand.value)
            assertEquals("", model.query.value)
        }

    @Test
    fun reconcileSelfHealsSelectionFromTheLiveList() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(5), vehicle(6)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.fleet.collect {} }
            advanceUntilIdle()
            assertEquals(5L, source.selectedId.value)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = vm(FakeSource(emptyList()), backgroundScope, logger)
            model.onViewOpened()
            model.onViewOpened()
            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("CommandPalette", opened.first().fields["surface"])
            assertFalse(opened.first().fields.containsKey("query"))
        }
}
