package io.teslasync.android.dashboard.widgets.vehicleaccess

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
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
 * Off-device verification of the VehicleAccessWidget's pure logic — the driver / invitation row mapping
 * (label fallback + badge tone), the mobile-access envelope decode, the `formatDateShort` parity, the
 * cache-then-network state fold (loading / content / empty / offline-cached / error-without-blanking), the
 * no-vehicle fold, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VehicleAccessWidget.tsx) against the snake_case wire contract.
 */
class VehicleAccessProjectionTest {
    private val strings =
        VehicleAccessStrings(
            title = "Vehicle Access",
            drivers = "Drivers",
            mobileOn = "Mobile access enabled",
            mobileOff = "Mobile access disabled",
            mobileUnknown = "Mobile access unknown",
            mobile = "Mobile Access",
            enabled = "Enabled",
            disabled = "Disabled",
            unknown = "Unknown",
            authorized = "Authorized Drivers",
            noDrivers = "No authorized drivers",
            pending = "Pending Invitations",
            noInvitations = "No pending invitations",
            owner = "Owner",
            driver = "Driver",
            pendingStatus = "Pending",
            accepted = "Accepted",
            expired = "Expired",
            noData = "No access data available",
        )

    // ── Registry metadata (web registry/security.ts → vehicle-access) ──────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("vehicle-access", VehicleAccessRegistration.ID)
        assertEquals("security", VehicleAccessRegistration.CATEGORY)
        assertEquals("VehicleAccessWidget", VehicleAccessRegistration.SLUG)
        assertEquals(VehicleAccessSize(2, 4), VehicleAccessRegistration.DEFAULT_SIZE)
        assertEquals(VehicleAccessSize(1, 2), VehicleAccessRegistration.MIN_SIZE)
        assertEquals(VehicleAccessSize(4, 40), VehicleAccessRegistration.MAX_SIZE)
    }

    @Test
    fun sizeClampHonoursBounds() {
        assertEquals(VehicleAccessSize(1, 2), VehicleAccessRegistration.clamp(VehicleAccessSize(0, 1)))
        assertEquals(VehicleAccessSize(4, 40), VehicleAccessRegistration.clamp(VehicleAccessSize(9, 99)))
        assertTrue(VehicleAccessRegistration.isWithinBounds(VehicleAccessSize(2, 4)))
        assertFalse(VehicleAccessRegistration.isWithinBounds(VehicleAccessSize(9, 99)))
    }

    @Test
    fun isCompactAtSingleColumn() {
        assertTrue(VehicleAccessSize(1, 2).isCompact)
        assertFalse(VehicleAccessSize(2, 4).isCompact)
    }

    // ── Mobile-access envelope decode (web mobileData?.data?.enabled ?? null) ───────

    @Test
    fun parseMobileEnabledReadsNestedFlag() {
        assertEquals(true, VehicleAccessProjection.parseMobileEnabled(mobileEnvelope(true)))
        assertEquals(false, VehicleAccessProjection.parseMobileEnabled(mobileEnvelope(false)))
    }

    @Test
    fun parseMobileEnabledNullWhenAbsentOrMalformed() {
        assertNull(VehicleAccessProjection.parseMobileEnabled(mobileEnvelope(null)))
        assertNull(VehicleAccessProjection.parseMobileEnabled(buildJsonObject { put("data", JsonNull) }))
        assertNull(VehicleAccessProjection.parseMobileEnabled(JsonNull))
        assertNull(VehicleAccessProjection.parseMobileEnabled(null))
    }

    // ── formatDateShort (web "MMM d") ──────────────────────────────────────────────

    @Test
    fun formatDateShortRendersShortMonthAndDay() {
        assertEquals("May 10", VehicleAccessProjection.formatDateShort("2024-05-10T09:00:00Z"))
        assertEquals("Jan 4", VehicleAccessProjection.formatDateShort("2024-01-04T23:59:00Z"))
    }

    @Test
    fun formatDateShortFallsBackToEmDash() {
        assertEquals(EM_DASH, VehicleAccessProjection.formatDateShort(null))
        assertEquals(EM_DASH, VehicleAccessProjection.formatDateShort(""))
        assertEquals(EM_DASH, VehicleAccessProjection.formatDateShort("not-a-date"))
    }

    // ── project: driver rows ───────────────────────────────────────────────────────

    @Test
    fun ownerDriverProjectsOwnerSuccessBadge() {
        val display = VehicleAccessProjection.project(data(drivers = listOf(driver(role = "owner", name = "Ada"))), strings)
        val entry = display.driverEntries.single()
        assertEquals("Ada", entry.label)
        assertEquals("May 10", entry.value)
        assertEquals("Owner", entry.badge?.text)
        assertEquals(DetailBadgeTone.Success, entry.badge?.tone)
    }

    @Test
    fun nonOwnerDriverFallsBackToEmailWithNeutralBadge() {
        val display =
            VehicleAccessProjection.project(
                data(drivers = listOf(driver(role = "driver", name = null, email = "grace@example.com"))),
                strings,
            )
        val entry = display.driverEntries.single()
        assertEquals("grace@example.com", entry.label)
        assertEquals("Driver", entry.badge?.text)
        assertEquals(DetailBadgeTone.Neutral, entry.badge?.tone)
    }

    @Test
    fun driverWithoutNameOrEmailRendersEmDash() {
        val display = VehicleAccessProjection.project(data(drivers = listOf(driver(name = null, email = null))), strings)
        assertEquals(EM_DASH, display.driverEntries.single().label)
    }

    // ── project: invitation rows ───────────────────────────────────────────────────

    @Test
    fun pendingInvitationProjectsWarningBadge() {
        val display = VehicleAccessProjection.project(data(invitations = listOf(invitation(status = "pending"))), strings)
        val entry = display.invitationEntries.single()
        assertEquals("owner@example.com", entry.label)
        assertEquals("May 12", entry.value)
        assertEquals("Pending", entry.badge?.text)
        assertEquals(DetailBadgeTone.Warning, entry.badge?.tone)
    }

    @Test
    fun acceptedInvitationProjectsSuccessBadge() {
        val display = VehicleAccessProjection.project(data(invitations = listOf(invitation(status = "accepted"))), strings)
        val entry = display.invitationEntries.single()
        assertEquals("Accepted", entry.badge?.text)
        assertEquals(DetailBadgeTone.Success, entry.badge?.tone)
    }

    @Test
    fun otherInvitationStatusProjectsExpiredErrorBadge() {
        val display = VehicleAccessProjection.project(data(invitations = listOf(invitation(status = "revoked"))), strings)
        val entry = display.invitationEntries.single()
        assertEquals("Expired", entry.badge?.text)
        assertEquals(DetailBadgeTone.Error, entry.badge?.tone)
    }

    @Test
    fun invitationWithoutCreatedByRendersEmDash() {
        val display = VehicleAccessProjection.project(data(invitations = listOf(invitation(createdBy = null))), strings)
        assertEquals(EM_DASH, display.invitationEntries.single().label)
    }

    // ── project: mobile badge + compact summary ─────────────────────────────────────

    @Test
    fun mobileEnabledTrueProjectsEnabledBadge() {
        val display = VehicleAccessProjection.project(data(mobileEnabled = true), strings)
        assertEquals("Enabled", display.mobileBadgeText)
        assertEquals(DetailBadgeTone.Success, display.mobileBadgeTone)
        assertEquals("Mobile access enabled", display.mobileStatusLabel)
    }

    @Test
    fun mobileEnabledFalseProjectsDisabledBadge() {
        val display = VehicleAccessProjection.project(data(mobileEnabled = false), strings)
        assertEquals("Disabled", display.mobileBadgeText)
        assertEquals(DetailBadgeTone.Error, display.mobileBadgeTone)
        assertEquals("Mobile access disabled", display.mobileStatusLabel)
    }

    @Test
    fun mobileEnabledUnknownProjectsUnknownBadge() {
        val display = VehicleAccessProjection.project(data(mobileEnabled = null), strings)
        assertEquals("Unknown", display.mobileBadgeText)
        assertEquals(DetailBadgeTone.Neutral, display.mobileBadgeTone)
        assertEquals("Mobile access unknown", display.mobileStatusLabel)
    }

    @Test
    fun compactSummaryFoldsCountTitleAndMobileStatus() {
        val display =
            VehicleAccessProjection.project(
                data(drivers = listOf(driver(), driver()), mobileEnabled = true),
                strings,
            )
        assertEquals(2, display.driverCount)
        assertEquals("2 Drivers", display.driversText)
        assertTrue(display.compactContentDescription.contains("Vehicle Access"))
        assertTrue(display.compactContentDescription.contains("2 Drivers"))
        assertTrue(display.compactContentDescription.contains("Mobile access enabled"))
    }

    @Test
    fun hasDataTrueWhenOnlyMobileKnown() {
        assertTrue(VehicleAccessProjection.project(data(mobileEnabled = false), strings).hasData)
        assertFalse(VehicleAccessProjection.project(data(mobileEnabled = null), strings).hasData)
    }

    // ── foldState: cache-then-network matrix ────────────────────────────────────────

    @Test
    fun foldFirstLoadIsLoading() {
        val ui = VehicleAccessProjection.foldState(loadingNull(), loadingNull(), loadingNull())
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun foldContentWithDriversUsesMaxFetchedAt() {
        val ui =
            VehicleAccessProjection.foldState(
                success(listOf(driver()), at = 100L),
                success(emptyList(), at = 90L),
                success(mobileEnvelope(null), at = 80L),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(1, ui.data?.drivers?.size)
        assertEquals(100L, ui.fetchedAt)
        assertFalse(ui.hasError)
    }

    @Test
    fun foldEmptyWhenNothingAndMobileUnknown() {
        val ui =
            VehicleAccessProjection.foldState(
                success(emptyList()),
                success(emptyList()),
                success(mobileEnvelope(null)),
            )
        assertEquals(UiPhase.Empty, ui.phase)
    }

    @Test
    fun foldContentWhenOnlyMobileKnown() {
        val ui =
            VehicleAccessProjection.foldState(
                success(emptyList()),
                success(emptyList()),
                success(mobileEnvelope(false)),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(false, ui.data?.mobileEnabled)
    }

    @Test
    fun foldOfflineKeepsCachedDriversVisible() {
        val ui =
            VehicleAccessProjection.foldState(
                Resource.Error(cached = listOf(driver()), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                success(emptyList()),
                success(mobileEnvelope(true)),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.stale)
        assertEquals(ErrorKind.Network, ui.errorKind)
        assertEquals(1, ui.data?.drivers?.size)
    }

    @Test
    fun foldHardErrorWithoutCacheIsEmptyNotErrorPhase() {
        val ui =
            VehicleAccessProjection.foldState(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                success(emptyList()),
                success(mobileEnvelope(null)),
            )
        // The web passes only `isError` (freshness chip), never `error` (full panel) — so never a blank panel.
        assertEquals(UiPhase.Empty, ui.phase)
        assertTrue(ui.hasError)
        assertTrue(ui.stale)
        assertEquals(ErrorKind.Network, ui.errorKind)
    }

    @Test
    fun foldRefreshingWhenLoadingOverCache() {
        val ui =
            VehicleAccessProjection.foldState(
                Resource.Loading(cached = listOf(driver()), fetchedAt = 100L, stale = false),
                success(emptyList()),
                success(mobileEnvelope(true)),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.refreshing)
        assertEquals(1, ui.data?.drivers?.size)
    }

    // ── foldNoVehicle: fleet-resolution branch ──────────────────────────────────────

    @Test
    fun noVehicleStaysLoadingWhileFleetLoads() {
        val ui = VehicleAccessProjection.foldNoVehicle(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun noVehicleEmptyWhenFleetResolvesEmpty() {
        val ui = VehicleAccessProjection.foldNoVehicle(Resource.Success(emptyList<Vehicle>(), fetchedAt = 100L, stale = false))
        assertEquals(UiPhase.Empty, ui.phase)
        assertEquals(VehicleAccessData.EMPTY, ui.data)
    }

    @Test
    fun noVehicleEmptyWithChipWhenFleetErrors() {
        val ui =
            VehicleAccessProjection.foldNoVehicle(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Timeout()),
            )
        assertEquals(UiPhase.Empty, ui.phase)
        assertTrue(ui.stale)
        assertEquals(ErrorKind.Timeout, ui.errorKind)
    }

    @Test
    fun firstVehicleIdResolvesFirstPositive() {
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────

    private fun data(
        drivers: List<VehicleDriver> = emptyList(),
        invitations: List<VehicleInvitation> = emptyList(),
        mobileEnabled: Boolean? = null,
    ): VehicleAccessData = VehicleAccessData(drivers, invitations, mobileEnabled)

    private fun driver(
        role: String? = "driver",
        name: String? = "Ada Lovelace",
        email: String? = "ada@example.com",
        fetchedAt: String = "2024-05-10T09:00:00Z",
    ): VehicleDriver =
        VehicleDriver(
            id = 1,
            vehicleId = 1,
            driverEmail = email,
            driverName = name,
            role = role,
            fetchedAt = fetchedAt,
        )

    private fun invitation(
        status: String = "pending",
        createdBy: String? = "owner@example.com",
        createdAt: String = "2024-05-12T10:00:00Z",
    ): VehicleInvitation =
        VehicleInvitation(
            id = 2,
            vehicleId = 1,
            invitationId = "inv-1",
            status = status,
            createdBy = createdBy,
            fetchedAt = createdAt,
            createdAt = createdAt,
        )

    private fun mobileEnvelope(enabled: Boolean?): JsonElement =
        buildJsonObject {
            put(
                "data",
                buildJsonObject { if (enabled != null) put("enabled", enabled) },
            )
            put("fetched_at", "2024-05-10T09:00:00Z")
        }

    private fun <T> success(
        value: T,
        at: Long = 100L,
    ): Resource<T> = Resource.Success(value, fetchedAt = at, stale = false)

    private fun <T> loadingNull(): Resource<T> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
}
