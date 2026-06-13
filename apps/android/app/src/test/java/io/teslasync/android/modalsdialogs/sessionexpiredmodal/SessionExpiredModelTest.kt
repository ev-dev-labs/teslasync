// Off-device unit coverage for the SessionExpiredModal modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the projection's `mode === 'open'` suppression guard, the
// `hasExpired || eventTriggered` open condition (both web activation paths), the [sessionMonitorFrom] bridge
// from every [AuthUiState] variant onto the (mode, hasExpired) snapshot, the registry identifiers, and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.sessionexpiredmodal

import io.teslasync.android.auth.AuthUiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionExpiredModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Projection: web `mode === 'open' ? null : hasExpired || eventTriggered` --------------------

    @Test
    fun project_openModeSuppressesAndNeverOpens() {
        // Even with hasExpired AND eventTriggered, open mode renders nothing (web `return null`).
        val display =
            SessionExpiredProjection.project(
                SessionMonitorSnapshot(SessionMonitorMode.Open, hasExpired = true),
                eventTriggered = true,
            )
        assertTrue("open mode must be suppressed", display.suppressed)
        assertFalse("suppressed surface must never report open", display.open)
    }

    @Test
    fun project_sessionModeOpensWhenExpired() {
        val display =
            SessionExpiredProjection.project(
                SessionMonitorSnapshot(SessionMonitorMode.Session, hasExpired = true),
                eventTriggered = false,
            )
        assertFalse(display.suppressed)
        assertTrue("a fully expired session is a hard block", display.open)
    }

    @Test
    fun project_sessionModeOpensFromTheEventLatch() {
        // The web second activation path: a 401 dispatched `teslasync:session-expired` before the poll observed
        // expiry. hasExpired is still false, but the latch opens the hard block.
        val display =
            SessionExpiredProjection.project(
                SessionMonitorSnapshot(SessionMonitorMode.Session, hasExpired = false),
                eventTriggered = true,
            )
        assertFalse(display.suppressed)
        assertTrue("the session-expired event latch must open the hard block", display.open)
    }

    @Test
    fun project_sessionModeStaysClosedWhenLiveAndNoEvent() {
        val display =
            SessionExpiredProjection.project(
                SessionMonitorSnapshot(SessionMonitorMode.Session, hasExpired = false),
                eventTriggered = false,
            )
        assertFalse(display.suppressed)
        assertFalse("a live session is not a hard block", display.open)
    }

    @Test
    fun project_unknownModeStaysClosed() {
        // Cold start, session state unresolved (web `mode === 'unknown'`): never a hard block.
        val display =
            SessionExpiredProjection.project(
                SessionMonitorSnapshot(SessionMonitorMode.Unknown, hasExpired = false),
                eventTriggered = false,
            )
        assertFalse(display.suppressed)
        assertFalse(display.open)
    }

    // ---- sessionMonitorFrom: AuthUiState (P1/S8) -> SessionMonitorSnapshot --------------------------

    @Test
    fun sessionMonitorFrom_reauthRequiredIsTheExpiredHardBlock() {
        val snapshot = sessionMonitorFrom(AuthUiState.ReauthRequired)
        assertEquals(SessionMonitorMode.Session, snapshot.mode)
        assertTrue("ReauthRequired is the native 'session expired, sign in again' state", snapshot.hasExpired)
    }

    @Test
    fun sessionMonitorFrom_authorizingIsUnknownAndNotExpired() {
        val snapshot = sessionMonitorFrom(AuthUiState.Authorizing)
        assertEquals(SessionMonitorMode.Unknown, snapshot.mode)
        assertFalse(snapshot.hasExpired)
    }

    @Test
    fun sessionMonitorFrom_liveAndTransientStatesAreNotExpired() {
        // Authenticated, transparently refreshing, the transient token-expired state whose silent refresh is in
        // flight, a fresh sign-out, and a sign-in error are all NOT the fully-expired hard block.
        val notExpired =
            listOf(
                AuthUiState.Authenticated,
                AuthUiState.Refreshing,
                AuthUiState.Expired,
                AuthUiState.SignedOut,
                AuthUiState.Error("boom"),
            )
        for (state in notExpired) {
            val snapshot = sessionMonitorFrom(state)
            assertEquals(SessionMonitorMode.Session, snapshot.mode)
            assertFalse("$state must not be a hard block", snapshot.hasExpired)
        }
    }

    @Test
    fun sessionMonitorFrom_feedsTheProjectionEndToEnd() {
        // The live binding: ReauthRequired -> open; every other state -> closed (eventTriggered always false).
        val open = SessionExpiredProjection.project(sessionMonitorFrom(AuthUiState.ReauthRequired), false)
        assertTrue(open.open)
        val closed = SessionExpiredProjection.project(sessionMonitorFrom(AuthUiState.Authenticated), false)
        assertFalse(closed.open)
    }

    // ---- Registry + diagnostics -------------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("session-expired-modal", SessionExpiredRegistration.ID)
        assertEquals("SessionExpiredModal", SessionExpiredRegistration.SLUG)
    }

    @Test
    fun recordSessionExpiredOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordSessionExpiredOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SessionExpiredModal"), fields)
        // The diagnostic must carry no session token, expiry, or user id — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
