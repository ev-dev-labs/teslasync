package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Framework-free unit tests for the BackupHistory widget — the parsing, the `fmtDuration` /
 * `totalOutages` / `avgDurationSec` / `sortedItems` projection, the two-source cache-then-network
 * adapter, the error-kind mapping and the ViewModel bound to the real shared [EnergyStore] (over a fake
 * repository). These run in the `:android:testReleaseUnitTest` gate and cover the behavior the
 * composables only render.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupHistoryWidgetTest {
    private val durationLabel = "Duration"
    private val rawTime: (String?) -> String = { it ?: "-" }

    // ── fmtDuration parity (web fmtDuration) ────────────────────────────────────
    @Test
    fun formatDurationMatchesWebRules() {
        assertEquals("0s", BackupHistoryProjection.formatDuration(0.0))
        assertEquals("0s", BackupHistoryProjection.formatDuration(-5.0))
        assertEquals("0s", BackupHistoryProjection.formatDuration(Double.NaN))
        assertEquals("0s", BackupHistoryProjection.formatDuration(Double.POSITIVE_INFINITY))
        assertEquals("30s", BackupHistoryProjection.formatDuration(30.0))
        assertEquals("46s", BackupHistoryProjection.formatDuration(45.6))
        assertEquals("1m", BackupHistoryProjection.formatDuration(60.0))
        assertEquals("1m", BackupHistoryProjection.formatDuration(90.0))
        assertEquals("45m", BackupHistoryProjection.formatDuration(2700.0))
        assertEquals("1h", BackupHistoryProjection.formatDuration(3600.0))
        assertEquals("1h 1m", BackupHistoryProjection.formatDuration(3661.0))
        assertEquals("2h", BackupHistoryProjection.formatDuration(7200.0))
        assertEquals("2h 15m", BackupHistoryProjection.formatDuration(8100.0))
    }

    @Test
    fun averageDurationIsMeanOverAllEventsAndZeroWhenEmpty() {
        assertEquals(0.0, BackupHistoryProjection.averageDurationSeconds(emptyList()), 0.0001)
        val events =
            listOf(
                BackupEvent(1, "t", 60.0),
                BackupEvent(2, "t", 120.0),
                BackupEvent(3, "t", 180.0),
            )
        assertEquals(120.0, BackupHistoryProjection.averageDurationSeconds(events), 0.0001)
        val withNull = listOf(BackupEvent(1, "t", 60.0), BackupEvent(2, "t", null))
        assertEquals(30.0, BackupHistoryProjection.averageDurationSeconds(withNull), 0.0001)
    }

    // ── JSON parsing (tolerant, web safeArray parity) ───────────────────────────
    @Test
    fun parseFirstSiteIdReadsFirstObjectsId() {
        assertEquals(7L, BackupHistorySnapshot.parseFirstSiteId(sitesJson(7L, 9L)))
        assertEquals(null, BackupHistorySnapshot.parseFirstSiteId(buildJsonArray {}))
        assertEquals(null, BackupHistorySnapshot.parseFirstSiteId(JsonNull))
        val noId = buildJsonArray { add(buildJsonObject { put("name", "x") }) }
        assertEquals(null, BackupHistorySnapshot.parseFirstSiteId(noId))
    }

    @Test
    fun parseEventsIsTolerant() {
        val json = eventsJson(event(1, "2024-01-01T00:00:00Z", 60.0), event(2, "2024-01-02T00:00:00Z", null))
        val events = BackupHistorySnapshot.parseEvents(json)
        assertEquals(2, events.size)
        assertEquals(1L, events[0].id)
        assertEquals("2024-01-01T00:00:00Z", events[0].timestamp)
        assertEquals(60.0, events[0].durationSeconds)
        assertEquals(null, events[1].durationSeconds)

        val withNonObject =
            buildJsonArray {
                add(JsonNull)
                add(event(5, "2024-01-01T00:00:00Z", 10.0))
            }
        assertEquals(1, BackupHistorySnapshot.parseEvents(withNonObject).size)
        assertTrue(BackupHistorySnapshot.parseEvents(JsonNull).isEmpty())
    }

    // ── projection: sorting, capping, labels (web sortedItems / maxEvents) ───────
    @Test
    fun projectStandardSortsNewestFirstAndComputesStats() {
        val snapshot =
            BackupHistorySnapshot.fromSiteAndEvents(
                siteId = 1,
                eventsJson =
                    eventsJson(
                        event(1, "2024-01-01T00:00:00Z", 60.0),
                        event(2, "2024-01-03T00:00:00Z", 120.0),
                        event(3, "2024-01-02T00:00:00Z", 180.0),
                    ),
            )
        val display = BackupHistoryProjection.project(snapshot, BackupHistorySize(2, 4), durationLabel, rawTime)

        assertFalse(display.isCompact)
        assertTrue(display.hasSites)
        assertTrue(display.hasEvents)
        assertEquals("3", display.outagesValue)
        assertEquals("2m", display.avgDurationValue)
        assertEquals(3, display.rows.size)
        assertEquals("2024-01-03T00:00:00Z", display.rows[0].timeText)
        assertEquals("2024-01-01T00:00:00Z", display.rows[2].timeText)
        assertEquals("2024-01-03T00:00:00Z, Duration: 2m", display.rows[0].accessibilityLabel)
    }

    @Test
    fun projectCompactCapsToThreeRows() {
        val events =
            (1..5).map { event(it.toLong(), "2024-01-0${it}T00:00:00Z", 60.0) }.toTypedArray()
        val snapshot = BackupHistorySnapshot.fromSiteAndEvents(1, eventsJson(*events))
        val display = BackupHistoryProjection.project(snapshot, BackupHistorySize(1, 2), durationLabel, rawTime)

        assertTrue(display.isCompact)
        assertEquals("5", display.outagesValue)
        assertEquals(BackupHistorySize.COMPACT_MAX_EVENTS, display.rows.size)
        assertEquals("2024-01-05T00:00:00Z", display.rows[0].timeText)
    }

    // ── size model ──────────────────────────────────────────────────────────────
    @Test
    fun sizeModelMatchesRegistryConstraints() {
        assertTrue(BackupHistorySize(1, 2).isCompact)
        assertFalse(BackupHistorySize(2, 4).isCompact)
        assertEquals(BackupHistorySize.COMPACT_MAX_EVENTS, BackupHistorySize(1, 8).maxEvents)
        assertEquals(BackupHistorySize.STANDARD_MAX_EVENTS, BackupHistorySize(4, 40).maxEvents)
        assertEquals("backup-history", BackupHistoryWidgetDescriptor.ID)
        assertEquals("energy", BackupHistoryWidgetDescriptor.CATEGORY)
        assertEquals(BackupHistorySize(2, 4), BackupHistoryWidgetDescriptor.defaultSize)
        assertEquals(BackupHistorySize(1, 2), BackupHistoryWidgetDescriptor.minSize)
        assertEquals(BackupHistorySize(4, 40), BackupHistoryWidgetDescriptor.maxSize)
    }

    @Test
    fun defaultSinceIsThirtyDaysBack() {
        assertEquals("2024-01-01", defaultBackupSince(LocalDate.of(2024, 1, 31)))
    }

    // ── two-source adapter (cache-then-network combine) ─────────────────────────
    @Test
    fun adapterEmitsNoSiteSnapshotWhenNoSiteResolves() =
        runTest {
            val sites = flowOf(success(buildJsonArray {}))
            val result = backupHistoryResource(sites) { flowOf(success(buildJsonArray {})) }.toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached!!.hasSites)
            assertFalse(result.cached!!.hasEvents)
        }

    @Test
    fun adapterMergesSiteAndEventsIntoSuccess() =
        runTest {
            val sites = flowOf(success(sitesJson(42L)))
            val events = eventsJson(event(1, "2024-01-01T00:00:00Z", 60.0))
            val result = backupHistoryResource(sites) { flowOf(success(events)) }.toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached!!.hasSites)
            assertEquals(42L, result.cached!!.siteId)
            assertEquals(1, result.cached!!.events.size)
        }

    @Test
    fun adapterStaysLoadingWhileEventsLoad() =
        runTest {
            val sites = flowOf(success(sitesJson(1L)))
            val result =
                backupHistoryResource(sites) { flowOf(Resource.Loading(null, null, false)) }.toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterKeepsCachedEventsOnErrorAsOffline() =
        runTest {
            val sites = flowOf(success(sitesJson(1L)))
            val cached = eventsJson(event(1, "2024-01-01T00:00:00Z", 60.0))
            val errored: Flow<Resource<JsonElement>> =
                flowOf(Resource.Error(cached, 50L, stale = true, error = ApiError.Network()))
            val result = backupHistoryResource(sites) { errored }.toList().last()
            assertTrue(result is Resource.Error)
            assertTrue(result.stale)
            assertTrue(result.cached!!.hasEvents)
        }

    // ── error-kind mapping ──────────────────────────────────────────────────────
    @Test
    fun queryErrorKindMapsStatusAndKind() {
        assertEquals(QueryErrorKind.Network, queryErrorKindFor(errorState(ErrorKind.Network, null)))
        assertEquals(QueryErrorKind.NotFound, queryErrorKindFor(errorState(ErrorKind.Http, 404)))
        assertEquals(QueryErrorKind.Unauthorized, queryErrorKindFor(errorState(ErrorKind.Http, 401)))
        assertEquals(QueryErrorKind.ServerError, queryErrorKindFor(errorState(ErrorKind.Http, 500)))
        assertEquals(QueryErrorKind.Waiting, queryErrorKindFor(errorState(ErrorKind.CircuitOpen, null)))
    }

    // ── ViewModel bound to the real shared EnergyStore ──────────────────────────
    @Test
    fun viewModelProjectsContentFromStore() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeEnergyRepository()
            repo.sites.value = listOf(Resource.Loading(null, null, false), success(sitesJson(1L)))
            repo.backup.value =
                listOf(Resource.Loading(null, null, false), success(eventsJson(event(1, "2024-01-01T00:00:00Z", 90.0))))
            val viewModel =
                BackupHistoryWidgetViewModel(EnergyStore(repo, backgroundScope), RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasEvents)
            assertEquals(1L, data.siteId)
        }

    @Test
    fun viewModelNoEventsIsEmptyPhaseWithSite() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeEnergyRepository()
            repo.sites.value = listOf(success(sitesJson(1L)))
            repo.backup.value = listOf(success(buildJsonArray {}))
            val viewModel =
                BackupHistoryWidgetViewModel(EnergyStore(repo, backgroundScope), RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Empty, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertFalse(data.hasEvents)
        }

    @Test
    fun viewModelNoSiteIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeEnergyRepository()
            repo.sites.value = listOf(success(buildJsonArray {}))
            val viewModel =
                BackupHistoryWidgetViewModel(EnergyStore(repo, backgroundScope), RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertFalse(state.data!!.hasSites)
        }

    @Test
    fun onAppearEmitsViewOpenedTelemetry() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel =
                BackupHistoryWidgetViewModel(EnergyStore(FakeEnergyRepository(), backgroundScope), logger, backgroundScope)
            viewModel.onAppear()
            val opened = logger.records.firstOrNull { it.first == "view.opened" }
            assertTrue(opened != null)
            assertEquals("BackupHistoryWidget", opened!!.second["surface"])
        }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private fun errorState(
        kind: ErrorKind,
        status: Int?,
    ): UiState<BackupHistorySnapshot> = UiState(phase = UiPhase.Error, errorKind = kind, httpStatus = status)

    private fun success(payload: JsonElement): Resource<JsonElement> = Resource.Success(payload, fetchedAt = 100L, stale = false)

    private fun sitesJson(vararg ids: Long): JsonArray =
        buildJsonArray { ids.forEach { id -> add(buildJsonObject { put("energy_site_id", id) }) } }

    private fun eventsJson(vararg events: JsonObject): JsonArray = buildJsonArray { events.forEach { add(it) } }

    private fun event(
        id: Long,
        timestamp: String?,
        duration: Double?,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            if (timestamp != null) put("timestamp", timestamp)
            if (duration != null) put("duration_seconds", duration)
        }
}

/** A [Logger] that records every event + fields, for telemetry assertions. */
private class RecordingLogger : Logger {
    val records = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        records.add(event to fields)
    }
}

/**
 * A fake [EnergyRepository] whose `teslaEnergySites` / `teslaBackupHistory` replay hand-built emission
 * lists (the same shape the real HTTP repo emits); every other read returns a benign loading feed and
 * every mutation succeeds. Only the surfaces this widget exercises are configurable.
 */
private class FakeEnergyRepository : EnergyRepository {
    val sites = MutableStateFlow<List<Resource<JsonElement>>>(listOf(Resource.Loading(null, null, false)))
    val backup = MutableStateFlow<List<Resource<JsonElement>>>(listOf(Resource.Loading(null, null, false)))

    private fun loading(): Flow<Resource<JsonElement>> = flowOf(Resource.Loading(null, null, false))

    override fun energyStats(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun batteryHealth(
        vehicleId: String,
        asOf: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun energyFlow(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vampireDrainStats(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun vampireDrainEvents(
        vehicleId: String,
        limit: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override fun projectedRange(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun sleepEfficiency(
        vehicleId: String,
        days: Int,
        startDate: String?,
        endDate: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergySites(): Flow<Resource<JsonElement>> = flow { sites.value.forEach { emit(it) } }

    override fun teslaEnergySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyHistory(
        siteId: Long,
        period: String,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaBackupHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = flow { backup.value.forEach { emit(it) } }

    override fun teslaWcChargingHistory(
        siteId: Long,
        since: String?,
        until: String?,
    ): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyLiveStatus(siteId: Long): Flow<Resource<JsonElement>> = loading()

    override fun teslaEnergyLiveStatusHistory(
        siteId: Long,
        since: String?,
        until: String?,
        limit: Int?,
    ): Flow<Resource<JsonElement>> = loading()

    override suspend fun refreshTeslaEnergySites(): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergyHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaBackupHistory(
        siteId: Long,
        period: String,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaWcChargingHistory(
        siteId: Long,
        startDate: String?,
        endDate: String?,
        timeZone: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement> = Result.success(JsonNull)
}
