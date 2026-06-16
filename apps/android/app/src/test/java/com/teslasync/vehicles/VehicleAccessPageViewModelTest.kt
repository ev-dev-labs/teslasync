// Off-device coverage for [VehicleAccessPageViewModel] — drives it over a controllable fake [VehicleAccessPageSource]
// covering the cache-then-network state matrix each panel renders (loading / empty / content / offline-cached), the
// per-feed refresh semantics (a driver mutation re-collects ONLY the drivers feed; an invitation mutation re-collects
// ONLY the invitations feed; a failed mutation re-collects nothing — the web `onError` skips invalidation), the
// confirm-dialog open/confirm/cancel flow, the share-user-id guard on remove, and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testDebugUnitTest. Mirrors the sibling
// VehicleAccessWidgetViewModelTest conventions.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicleaccess

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class VehicleAccessPageViewModelTest {
    // ── data-state matrix ────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun emptyDriverListIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(drivers = listOf(success(emptyList()))))
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.driversState.value.phase)
        }

    @Test
    fun populatedDriverListIsContentPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(drivers = listOf(success(listOf(driver())))))
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.driversState.value.phase)
            assertEquals(1, vm.driversState.value.data?.size)
        }

    @Test
    fun loadingDriversWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(drivers = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))))
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.driversState.value.phase)
        }

    @Test
    fun emptyInvitationListIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(invitations = listOf(success(emptyList()))))
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.invitationsState.value.phase)
        }

    @Test
    fun populatedInvitationListIsContentPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(invitations = listOf(success(listOf(invitation())))))
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.invitationsState.value.phase)
        }

    @Test
    fun offlineKeepsCachedDriversWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        drivers =
                            listOf(
                                Resource.Error(cached = listOf(driver()), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                            ),
                    ),
                )
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()

            val ui = vm.driversState.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun vehicleFeedExposesBreadcrumbDisplayName() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.vehicleState.collect {} }
            advanceUntilIdle()
            assertEquals("Car 1", vm.vehicleState.value.data?.displayName)
        }

    // ── per-feed refresh semantics ───────────────────────────────────────────────────────────────────────────

    @Test
    fun refreshDriversReCollectsOnlyDriversFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(drivers = listOf(success(listOf(driver()))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.driversState.collect {} }
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            val driverReadsBefore = source.driverReads
            val invitationReadsBefore = source.invitationReads

            vm.refreshDrivers()
            advanceUntilIdle()

            assertEquals(1, source.refreshDriversCalls)
            assertTrue(source.driverReads > driverReadsBefore)
            assertEquals(invitationReadsBefore, source.invitationReads)
        }

    @Test
    fun refreshInvitationsReCollectsOnlyInvitationsFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(invitations = listOf(success(listOf(invitation()))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.driversState.collect {} }
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            val driverReadsBefore = source.driverReads
            val invitationReadsBefore = source.invitationReads

            vm.refreshInvitations()
            advanceUntilIdle()

            assertEquals(1, source.refreshInvitationsCalls)
            assertTrue(source.invitationReads > invitationReadsBefore)
            assertEquals(driverReadsBefore, source.driverReads)
        }

    @Test
    fun failedRefreshReCollectsNothing() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(drivers = listOf(success(listOf(driver())))).apply {
                    refreshDriversResult = Result.failure(ApiError.Network())
                }
            val vm = viewModel(source)
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()
            val driverReadsBefore = source.driverReads

            vm.refreshDrivers()
            advanceUntilIdle()

            assertEquals(1, source.refreshDriversCalls)
            assertEquals(driverReadsBefore, source.driverReads)
        }

    @Test
    fun createInvitationReCollectsInvitationsFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(invitations = listOf(success(listOf(invitation()))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            val invitationReadsBefore = source.invitationReads

            vm.createInvitation()
            advanceUntilIdle()

            assertEquals(1, source.createCalls)
            assertTrue(source.invitationReads > invitationReadsBefore)
        }

    // ── confirm dialog flows ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun removeDriverDialogOpensConfirmsAndReCollectsDrivers() =
        runTest(UnconfinedTestDispatcher()) {
            val target = driver(shareUserId = 42L)
            val source = FakeSource(drivers = listOf(success(listOf(target))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.driversState.collect {} }
            advanceUntilIdle()
            val driverReadsBefore = source.driverReads

            vm.requestRemoveDriver(target)
            assertEquals(target, vm.removeTarget.value)

            vm.confirmRemoveDriver()
            advanceUntilIdle()

            assertEquals(1, source.removeCalls)
            assertEquals(42L, source.lastRemovedShareUserId)
            assertTrue(source.driverReads > driverReadsBefore)
            assertNull(vm.removeTarget.value)
        }

    @Test
    fun removeDriverWithoutShareUserIdJustClosesDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val target = driver(shareUserId = null)
            val source = FakeSource(drivers = listOf(success(listOf(target))))
            val vm = viewModel(source)

            vm.requestRemoveDriver(target)
            vm.confirmRemoveDriver()
            advanceUntilIdle()

            assertEquals(0, source.removeCalls)
            assertNull(vm.removeTarget.value)
        }

    @Test
    fun cancelRemoveDriverClosesWithoutMutating() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.requestRemoveDriver(driver(shareUserId = 9L))
            vm.cancelRemoveDriver()

            assertNull(vm.removeTarget.value)
            assertEquals(0, source.removeCalls)
        }

    @Test
    fun revokeInvitationDialogOpensConfirmsAndReCollectsInvitations() =
        runTest(UnconfinedTestDispatcher()) {
            val target = invitation(invitationId = "inv-7")
            val source = FakeSource(invitations = listOf(success(listOf(target))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.invitationsState.collect {} }
            advanceUntilIdle()
            val invitationReadsBefore = source.invitationReads

            vm.requestRevokeInvitation(target)
            assertEquals(target, vm.revokeTarget.value)

            vm.confirmRevokeInvitation()
            advanceUntilIdle()

            assertEquals(1, source.revokeCalls)
            assertEquals("inv-7", source.lastRevokedInvitationId)
            assertTrue(source.invitationReads > invitationReadsBefore)
            assertNull(vm.revokeTarget.value)
        }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(VehicleAccessPageRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }

    // ── fakes / helpers ──────────────────────────────────────────────────────────────────────────────────────

    private class FakeSource(
        private val vehicle: List<Resource<Vehicle>> = listOf(Resource.Success(car(), 100L, false)),
        private val drivers: List<Resource<List<VehicleDriver>>> = listOf(Resource.Success(emptyList(), 100L, false)),
        private val invitations: List<Resource<List<VehicleInvitation>>> = listOf(Resource.Success(emptyList(), 100L, false)),
    ) : VehicleAccessPageSource {
        var driverReads = 0
            private set
        var invitationReads = 0
            private set
        var refreshDriversCalls = 0
            private set
        var refreshInvitationsCalls = 0
            private set
        var removeCalls = 0
            private set
        var createCalls = 0
            private set
        var revokeCalls = 0
            private set
        var lastRemovedShareUserId: Long? = null
            private set
        var lastRevokedInvitationId: String? = null
            private set

        var refreshDriversResult: Result<Unit> = Result.success(Unit)
        var refreshInvitationsResult: Result<Unit> = Result.success(Unit)
        var removeResult: Result<Unit> = Result.success(Unit)
        var createResult: Result<Unit> = Result.success(Unit)
        var revokeResult: Result<Unit> = Result.success(Unit)

        override fun vehicle(vehicleId: String): Flow<Resource<Vehicle>> = vehicle.asFlow()

        override fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> {
            driverReads++
            return drivers.asFlow()
        }

        override fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> {
            invitationReads++
            return invitations.asFlow()
        }

        override suspend fun refreshVehicleDrivers(vehicleId: String): Result<Unit> {
            refreshDriversCalls++
            return refreshDriversResult
        }

        override suspend fun refreshVehicleInvitations(vehicleId: String): Result<Unit> {
            refreshInvitationsCalls++
            return refreshInvitationsResult
        }

        override suspend fun removeVehicleDriver(
            vehicleId: String,
            shareUserId: Long,
        ): Result<Unit> {
            removeCalls++
            lastRemovedShareUserId = shareUserId
            return removeResult
        }

        override suspend fun createVehicleInvitation(vehicleId: String): Result<Unit> {
            createCalls++
            return createResult
        }

        override suspend fun revokeVehicleInvitation(
            vehicleId: String,
            invitationId: String,
        ): Result<Unit> {
            revokeCalls++
            lastRevokedInvitationId = invitationId
            return revokeResult
        }

        private companion object {
            fun car(): Vehicle =
                Vehicle(
                    createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                    displayName = "Car 1",
                    enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                    id = 1,
                    teslaId = 1001,
                    timezone = "UTC",
                    updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                    vin = "VIN1",
                )
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

    private fun TestScope.viewModel(
        source: VehicleAccessPageSource,
        logger: Logger = RecordingLogger(),
    ): VehicleAccessPageViewModel = VehicleAccessPageViewModel(source, vehicleId = "1", logger = logger, scope = backgroundScope)

    private fun driver(shareUserId: Long? = 7L): VehicleDriver =
        VehicleDriver(
            id = 1,
            vehicleId = 1,
            shareUserId = shareUserId,
            driverEmail = "ada@example.com",
            driverName = "Ada Lovelace",
            role = "driver",
            fetchedAt = "2024-05-10T09:00:00Z",
        )

    private fun invitation(invitationId: String = "inv-1"): VehicleInvitation =
        VehicleInvitation(
            id = 1,
            vehicleId = 1,
            invitationId = invitationId,
            inviteUrl = "https://example.com/invite/$invitationId",
            status = "pending",
            expiresAt = "2024-06-10T09:00:00Z",
            createdBy = "owner@example.com",
            fetchedAt = "2024-05-10T09:00:00Z",
            createdAt = "2024-05-10T08:00:00Z",
        )

    private fun <T> success(
        value: T,
        at: Long = 100L,
    ): Resource<T> = Resource.Success(value, fetchedAt = at, stale = false)
}
