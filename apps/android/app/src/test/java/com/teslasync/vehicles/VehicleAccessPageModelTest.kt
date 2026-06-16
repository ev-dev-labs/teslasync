// Off-device unit coverage for the framework-free VehicleAccessPage model — the native folds the composable renders
// from: the invitation status → web StatusBadge token map (pending → online, revoked → offline, else → asleep), the
// revocable predicate (web `status === 'pending'`), the `expires_at` → absolute timestamp fold (web `<TimeStamp>`,
// "—" for null/unparseable), the breadcrumb label fold (web `vehicle?.display_name ?? \`Vehicle #${id}\``), the "—"
// row fallback (web `value ?? '—'`), the page-level loading predicate (web `driversLoading || invitationsLoading`),
// and the PII-safe `view.opened` diagnostic. Pure functions only — no Compose / Android / HTTP — so this runs in
// :android:testDebugUnitTest. Reference values are the strings + behaviour the web page produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicleaccess

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VehicleAccessPageModelTest {
    // ── invitation status token (web StatusBadge status fold) ────────────────────────────────────────────────

    @Test
    fun pendingInvitationFoldsToOnlineToken() {
        assertEquals("online", invitationStatusToken("pending"))
    }

    @Test
    fun revokedInvitationFoldsToOfflineToken() {
        assertEquals("offline", invitationStatusToken("revoked"))
    }

    @Test
    fun otherInvitationStatusesFoldToAsleepToken() {
        assertEquals("asleep", invitationStatusToken("accepted"))
        assertEquals("asleep", invitationStatusToken("expired"))
        assertEquals("asleep", invitationStatusToken(""))
    }

    @Test
    fun onlyPendingInvitationsAreRevocable() {
        assertTrue(invitationIsRevocable("pending"))
        assertFalse(invitationIsRevocable("revoked"))
        assertFalse(invitationIsRevocable("accepted"))
    }

    // ── expires_at fold (web <TimeStamp>) ────────────────────────────────────────────────────────────────────

    @Test
    fun nullOrBlankExpiryRendersEmDash() {
        assertEquals(VEHICLE_ACCESS_EM_DASH, formatInvitationExpiry(null))
        assertEquals(VEHICLE_ACCESS_EM_DASH, formatInvitationExpiry(""))
        assertEquals(VEHICLE_ACCESS_EM_DASH, formatInvitationExpiry("   "))
    }

    @Test
    fun unparseableExpiryRendersEmDash() {
        assertEquals(VEHICLE_ACCESS_EM_DASH, formatInvitationExpiry("not-a-date"))
    }

    @Test
    fun parseableExpiryRendersANonDashValue() {
        val formatted = formatInvitationExpiry("2024-05-10T09:00:00Z")
        assertNotEquals(VEHICLE_ACCESS_EM_DASH, formatted)
        assertTrue(formatted.isNotBlank())
    }

    @Test
    fun offsetlessExpiryStillParses() {
        val formatted = formatInvitationExpiry("2024-05-10T09:00:00")
        assertNotEquals(VEHICLE_ACCESS_EM_DASH, formatted)
    }

    // ── breadcrumb label (web vehicle?.display_name ?? `Vehicle #id`) ─────────────────────────────────────────

    @Test
    fun breadcrumbUsesDisplayNameWhenPresent() {
        assertEquals("Model 3", vehicleBreadcrumbLabel("Model 3", "7"))
    }

    @Test
    fun breadcrumbFallsBackToVehicleIdWhenNameMissing() {
        assertEquals("Vehicle #7", vehicleBreadcrumbLabel(null, "7"))
        assertEquals("Vehicle #7", vehicleBreadcrumbLabel("  ", "7"))
    }

    // ── row "—" fallback (web value ?? '—') ──────────────────────────────────────────────────────────────────

    @Test
    fun orDashReplacesNullAndBlank() {
        assertEquals(VEHICLE_ACCESS_EM_DASH, orDash(null))
        assertEquals(VEHICLE_ACCESS_EM_DASH, orDash(""))
        assertEquals("ada@example.com", orDash("ada@example.com"))
    }

    // ── page-level loading (web driversLoading || invitationsLoading) ─────────────────────────────────────────

    @Test
    fun pageIsLoadingWhenEitherFeedIsLoading() {
        val loading = UiState.loading<List<String>>()
        val content = UiState(UiPhase.Content, data = listOf("x"))
        assertTrue(pageIsLoading(loading, content))
        assertTrue(pageIsLoading(content, loading))
        assertTrue(pageIsLoading(loading, loading))
    }

    @Test
    fun pageIsNotLoadingWhenBothFeedsResolved() {
        val content = UiState(UiPhase.Content, data = listOf("x"))
        val empty = UiState<List<String>>(UiPhase.Empty, data = emptyList())
        assertFalse(pageIsLoading(content, empty))
        assertFalse(pageIsLoading(empty, content))
    }

    // ── diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun viewOpenedEmitsSlugWithNoVehicleId() {
        val logger = RecordingLogger()
        recordVehicleAccessPageOpened(logger)

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        assertEquals(VehicleAccessPageRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
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
}
