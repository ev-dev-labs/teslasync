package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.vehicles.FakeVehiclesRepository
import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device tests for the AuditLogWidget data layer: the pure adapter/projection (severity
 * inference, security-title build, snake_case decoding, 24h stats, newest-first cap), the
 * two-feed [combineAuditUi] state fold, and the [AuditLogWidgetViewModel] binding the shared
 * [AdminStore] + [VehiclesStore] across the loading / content / empty / error states.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuditLogWidgetTest {
    private val now: Long = Instant.parse("2024-06-01T12:00:00Z").toEpochMilli()

    private fun ts(iso: String): String = iso

    // ── severity inference ───────────────────────────────────────────────────

    @Test
    fun auditSeverityFromAction() {
        assertEquals(AuditSeverity.Critical, inferAuditSeverity("user.delete"))
        assertEquals(AuditSeverity.Critical, inferAuditSeverity("token.REVOKE"))
        assertEquals(AuditSeverity.Critical, inferAuditSeverity("login failed"))
        assertEquals(AuditSeverity.Warning, inferAuditSeverity("vehicle.update"))
        assertEquals(AuditSeverity.Warning, inferAuditSeverity("settings change"))
        assertEquals(AuditSeverity.Info, inferAuditSeverity("user.login"))
        assertEquals(AuditSeverity.Info, inferAuditSeverity(null))
    }

    @Test
    fun securitySeverityFromEvent() {
        assertEquals(AuditSeverity.Critical, inferSecuritySeverity(securityEvent(locked = false)))
        assertEquals(AuditSeverity.Warning, inferSecuritySeverity(securityEvent(sentry = Flag.Text("active"))))
        assertEquals(AuditSeverity.Warning, inferSecuritySeverity(securityEvent(sentry = Flag.Bool(true))))
        assertEquals(AuditSeverity.Info, inferSecuritySeverity(securityEvent(locked = true)))
        assertEquals(AuditSeverity.Info, inferSecuritySeverity(securityEvent(sentry = Flag.Text("off"))))
    }

    @Test
    fun buildSecurityTitleMatchesWebOrdering() {
        assertEquals("Vehicle unlocked", buildSecurityTitle(securityEvent(locked = false)))
        assertEquals("Vehicle locked", buildSecurityTitle(securityEvent(locked = true)))
        assertEquals("Sentry: active", buildSecurityTitle(securityEvent(sentry = Flag.Text("active"))))
        assertEquals("Sentry: On", buildSecurityTitle(securityEvent(sentry = Flag.Bool(true))))
        assertEquals("Guest mode on", buildSecurityTitle(securityEvent(guest = true)))
        assertEquals("Security event", buildSecurityTitle(securityEvent()))
    }

    // ── JSON decoding ──────────────────────────────────────────────────────────

    @Test
    fun parseAuditEntriesReadsSnakeCaseWithFallbacks() {
        val json =
            array(
                """{"id":1,"action":"user.delete","resource":"users","details":"admin","created_at":"2024-06-01T11:00:00Z"}""",
                """{"id":"x2","action":"sync","entity_type":"vehicle","detail":"vin","ts":"2024-06-01T10:00:00Z"}""",
            )
        val entries = parseAuditEntries(json)
        assertEquals(2, entries.size)
        assertEquals("1", entries[0].id)
        assertEquals("users", entries[0].resource)
        assertEquals("admin", entries[0].details)
        assertEquals("vehicle", entries[1].resource)
        assertEquals("vin", entries[1].details)
        assertEquals("2024-06-01T10:00:00Z", entries[1].createdAt)
    }

    @Test
    fun parseSecurityEventsReadsUnionFields() {
        val json =
            array(
                """{"id":7,"locked":false,"sentry_mode":"active","door_state":true,"created_at":"2024-06-01T11:30:00Z"}""",
            )
        val events = parseSecurityEvents(json)
        assertEquals(1, events.size)
        assertEquals(false, events[0].locked)
        assertEquals(Flag.Text("active"), events[0].sentryMode)
        assertEquals(Flag.Bool(true), events[0].doorState)
        assertEquals(null, events[0].guestMode)
    }

    @Test
    fun parseHandlesNonArrayAndNull() {
        assertTrue(parseAuditEntries(null).isEmpty())
        assertTrue(parseAuditEntries(JsonNull).isEmpty())
        assertTrue(parseSecurityEvents(Json.parseToJsonElement("""{"not":"an array"}""")).isEmpty())
    }

    // ── projection ───────────────────────────────────────────────────────────

    @Test
    fun projectionSortsNewestFirstAndCountsLast24h() {
        val audits =
            listOf(
                auditEntry("a-old", "user.login", ts("2024-05-01T00:00:00Z")),
                auditEntry("a-new", "user.delete", ts("2024-06-01T11:00:00Z")),
            )
        val events = listOf(secEntry("s1", locked = false, created = ts("2024-06-01T11:30:00Z")))
        val content = projectAuditFeed(audits, events, now)

        assertEquals(3, content.rows.size)
        assertEquals("sec-s1", content.rows[0].id)
        assertEquals("audit-a-new", content.rows[1].id)
        assertEquals(2, content.totalEvents24h)
        assertEquals(AuditSeverity.Critical, content.worstSeverity)
    }

    @Test
    fun projectionCapsFeedAt15() {
        val audits = (1..30).map { auditEntry("a$it", "user.login", ts("2024-06-01T11:00:00Z")) }
        val content = projectAuditFeed(audits, emptyList(), now)
        assertEquals(15, content.rows.size)
        assertEquals(30, content.totalEvents24h)
    }

    // ── state fold ─────────────────────────────────────────────────────────────

    @Test
    fun combineLoadingWhenEitherLoading() {
        val state = combineAuditUi(UiState.loading(), UiState(UiPhase.Empty, data = emptyList()), now)
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun combineErrorWhenNoDataAndHardError() {
        val audit = UiState<List<AuditLogEntry>>(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network)
        val state = combineAuditUi(audit, UiState(UiPhase.Empty, data = emptyList()), now)
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(io.teslasync.android.data.ErrorKind.Network, state.errorKind)
    }

    @Test
    fun combineContentKeepsCachedRowsWhenStale() {
        val audit =
            UiState(
                UiPhase.Content,
                data = listOf(auditEntry("a1", "user.delete", ts("2024-06-01T11:00:00Z"))),
                stale = true,
                errorKind = io.teslasync.android.data.ErrorKind.Network,
            )
        val state = combineAuditUi(audit, UiState(UiPhase.Empty, data = emptyList()), now)
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertEquals(1, state.data?.rows?.size)
    }

    @Test
    fun combineEmptyWhenResolvedWithNoRows() {
        val state =
            combineAuditUi(
                UiState(UiPhase.Empty, data = emptyList()),
                UiState(UiPhase.Empty, data = emptyList()),
                now,
            )
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── view model ─────────────────────────────────────────────────────────────

    @Test
    fun viewModelEmitsContentFromBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val admin = FakeAdminRepository()
            admin.auditEmissions =
                listOf(
                    Resource.Loading(null, null, false),
                    Resource.Success(array("""{"id":1,"action":"user.delete","created_at":"2024-06-01T11:00:00Z"}"""), 10L, false),
                )
            admin.securityEmissions = listOf(Resource.Success(array(), 10L, false))
            val vm = viewModel(admin, backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.rows?.size)
            assertEquals(AuditSeverity.Critical, state.data?.worstSeverity)
        }

    @Test
    fun viewModelEmptyWhenBothFeedsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val admin = FakeAdminRepository()
            admin.auditEmissions = listOf(Resource.Success(array(), 10L, false))
            admin.securityEmissions = listOf(Resource.Success(array(), 10L, false))
            val vm = viewModel(admin, backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun viewModelErrorWhenAuditFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val admin = FakeAdminRepository()
            admin.auditEmissions = listOf(Resource.Error(null, null, true, ApiError.Network()))
            admin.securityEmissions = listOf(Resource.Success(array(), 10L, false))
            val vm = viewModel(admin, backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, vm.state.value.phase)
        }

    @Test
    fun viewModelResolvesPrimaryVehicleForSecurityFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val admin = FakeAdminRepository()
            admin.auditEmissions = listOf(Resource.Success(array(), 10L, false))
            admin.securityEmissions =
                listOf(Resource.Success(array("""{"id":9,"locked":false,"created_at":"2024-06-01T11:00:00Z"}"""), 10L, false))
            val vehicles = FakeVehiclesRepository()
            vehicles.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(42)), 10L, false))
            val vm = viewModel(admin, backgroundScope, vehicles = vehicles, vehicleId = null)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals("42", admin.lastSecurityVehicleId)
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun onOpenedEmitsViewOpenedEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeAdminRepository(), backgroundScope, logger = logger)
            vm.onOpened()
            assertTrue(logger.events.any { it.first == "view.opened" && it.second["surface"] == "AuditLogWidget" })
        }

    @Test
    fun refreshLogsAndKeepsStateValid() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val admin = FakeAdminRepository()
            admin.auditEmissions = listOf(Resource.Success(array(), 10L, false))
            admin.securityEmissions = listOf(Resource.Success(array(), 10L, false))
            val vm = viewModel(admin, backgroundScope, vehicleId = 1L, logger = logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.refresh()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "audit-log.refresh" })
            assertFalse(vm.state.value.isLoading)
        }

    // ── helpers ──────────────────────────────────────────────────────────────

    private fun viewModel(
        admin: FakeAdminRepository,
        scope: CoroutineScope,
        vehicles: FakeVehiclesRepository = FakeVehiclesRepository(),
        vehicleId: Long? = 1L,
        logger: Logger = RecordingLogger(),
    ): AuditLogWidgetViewModel =
        // Each ViewModel is built against the real shared stores backed by fakes (S8 contract).
        AuditLogWidgetViewModel(
            adminStore = AdminStore(admin, scope),
            vehiclesStore = VehiclesStore(vehicles, scope),
            logger = logger,
            vehicleId = vehicleId,
            now = { now },
            scope = scope,
        )

    private fun auditEntry(
        id: String,
        action: String,
        created: String,
    ): AuditLogEntry = AuditLogEntry(id = id, action = action, resource = null, details = null, createdAt = created)

    private fun secEntry(
        id: String,
        locked: Boolean?,
        created: String,
    ): SecurityEvent = securityEvent(id = id, locked = locked, created = created)

    private fun securityEvent(
        id: String = "e1",
        locked: Boolean? = null,
        sentry: Flag = Flag.Absent,
        guest: Boolean? = null,
        created: String? = null,
    ): SecurityEvent =
        SecurityEvent(
            id = id,
            locked = locked,
            sentryMode = sentry,
            doorState = Flag.Absent,
            guestMode = guest,
            valetModeEnabled = null,
            createdAt = created,
        )

    private fun array(vararg objects: String): JsonElement = Json.parseToJsonElement("[" + objects.joinToString(",") + "]")
}

// ── test doubles ───────────────────────────────────────────────────────────────

/** Records the structured events emitted to the diagnostics logger so tests can assert on them. */
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

/**
 * Controllable fake [AdminRepository]: the two feeds the widget reads ([auditLogs]/[securityEvents])
 * replay configurable [Resource]s; every other read returns a benign loading default and every
 * mutation a success, so the real [AdminStore] can be built over it.
 */
private class FakeAdminRepository : AdminRepository {
    var auditEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(emptyArray(), 0L, false))
    var securityEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(emptyArray(), 0L, false))
    var lastSecurityVehicleId: String? = null
        private set

    override fun auditLogs(): Flow<Resource<JsonElement>> = flow { auditEmissions.forEach { emit(it) } }

    override fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>> =
        flow {
            lastSecurityVehicleId = vehicleId
            securityEmissions.forEach { emit(it) }
        }

    override fun apiKeys(): Flow<Resource<JsonElement>> = loading()

    override fun apiLogs(page: Int): Flow<Resource<JsonElement>> = loading()

    override fun apiLogStats(): Flow<Resource<JsonElement>> = loading()

    override fun backupConfigs(): Flow<Resource<JsonElement>> = loading()

    override fun backupRuns(): Flow<Resource<JsonElement>> = loading()

    override fun systemHealth(): Flow<Resource<JsonElement>> = loading()

    override fun maintenanceState(): Flow<Resource<JsonElement>> = loading()

    override fun webErrorsSummary(): Flow<Resource<JsonElement>> = loading()

    override fun dbStats(): Flow<Resource<JsonElement>> = loading()

    override fun migrations(): Flow<Resource<JsonElement>> = loading()

    override fun connectionPool(): Flow<Resource<JsonElement>> = loading()

    override fun compressionStats(): Flow<Resource<JsonElement>> = loading()

    override fun exportJobs(): Flow<Resource<JsonElement>> = loading()

    override fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>> = loading()

    override fun stateTimeline(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> = loading()

    override suspend fun createApiKey(
        name: String,
        permissions: String,
    ): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun deleteApiKey(id: String): Result<Unit> = Result.success(Unit)

    override suspend fun revokeApiKey(id: String): Result<Unit> = Result.success(Unit)

    override suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun createExport(
        type: String,
        format: String,
        vehicleId: String?,
    ): Result<JsonElement> = Result.success(JsonNull)

    private fun loading(): Flow<Resource<JsonElement>> = flow { emit(Resource.Loading(null, null, false)) }
}

private fun emptyArray(): JsonElement = Json.parseToJsonElement("[]")
