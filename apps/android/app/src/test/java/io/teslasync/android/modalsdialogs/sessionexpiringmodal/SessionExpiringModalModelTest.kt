// Off-device unit coverage for the SessionExpiringModal modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the `deriveSessionState` port (unknown / open / unauthenticated /
// expiring-soon / healthy / hard-expired / fallback / absolute-preferred), the `formatCountdown` `m:ss`
// formatting, the `open` visibility gate, the draft ordering/slicing/overflow, the `%1$s` argument
// substitution, the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.sessionexpiringmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionExpiringModalModelTest {
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

    private val now = 1_000_000L

    private fun session(
        authenticated: Boolean = true,
        expiresAtEpochSeconds: Long? = null,
        expiresInFallbackSeconds: Long? = null,
    ) = SessionSnapshot(
        mode = SessionMode.Session,
        authenticated = authenticated,
        expiresAtEpochSeconds = expiresAtEpochSeconds,
        expiresInFallbackSeconds = expiresInFallbackSeconds,
    )

    // ---- deriveSessionExpiry: mode short-circuits (web `mode === 'open'` / `!data`) -------------------

    @Test
    fun derive_unknownMode_shortCircuitsAllExpiryLogic() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(
                SessionSnapshot(SessionMode.Unknown, authenticated = false, expiresAtEpochSeconds = now - 5),
                now,
            )
        assertEquals(SessionMode.Unknown, state.mode)
        assertEquals(null, state.expiresInSeconds)
        assertFalse(state.isExpiringSoon)
        assertFalse(state.hasExpired)
    }

    @Test
    fun derive_openMode_shortCircuitsAllExpiryLogic() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(
                SessionSnapshot(SessionMode.Open, authenticated = true, expiresAtEpochSeconds = now + 10),
                now,
            )
        assertEquals(SessionMode.Open, state.mode)
        assertEquals(null, state.expiresInSeconds)
        assertFalse(state.isExpiringSoon)
        assertFalse(state.hasExpired)
    }

    // ---- deriveSessionExpiry: session-mode expiry classification ------------------------------------

    @Test
    fun derive_unauthenticatedSession_isExpired() {
        val state = SessionExpiringProjection.deriveSessionExpiry(session(authenticated = false), now)
        assertEquals(SessionMode.Session, state.mode)
        assertTrue(state.hasExpired)
        assertFalse(state.isExpiringSoon)
    }

    @Test
    fun derive_healthySession_isNeitherExpiringNorExpired() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(session(expiresAtEpochSeconds = now + 120), now)
        assertEquals(120L, state.expiresInSeconds)
        assertFalse(state.isExpiringSoon)
        assertFalse(state.hasExpired)
    }

    @Test
    fun derive_sessionUnderThreshold_isExpiringSoon() {
        val state = SessionExpiringProjection.deriveSessionExpiry(session(expiresAtEpochSeconds = now + 30), now)
        assertEquals(30L, state.expiresInSeconds)
        assertTrue(state.isExpiringSoon)
        assertFalse(state.hasExpired)
    }

    @Test
    fun derive_isExpiringSoon_isExclusiveOfTheThresholdItself() {
        val atThreshold =
            SessionExpiringProjection.deriveSessionExpiry(
                session(expiresAtEpochSeconds = now + SESSION_EXPIRING_THRESHOLD_S),
                now,
            )
        assertFalse("exactly the threshold is not yet expiring soon", atThreshold.isExpiringSoon)

        val justUnder =
            SessionExpiringProjection.deriveSessionExpiry(
                session(expiresAtEpochSeconds = now + SESSION_EXPIRING_THRESHOLD_S - 1),
                now,
            )
        assertTrue("one second under the threshold is expiring soon", justUnder.isExpiringSoon)
    }

    @Test
    fun derive_pastExpiry_isExpiredAndNotExpiringSoon() {
        val state = SessionExpiringProjection.deriveSessionExpiry(session(expiresAtEpochSeconds = now - 5), now)
        assertEquals(-5L, state.expiresInSeconds)
        assertTrue(state.hasExpired)
        assertFalse(state.isExpiringSoon)
    }

    @Test
    fun derive_zeroRemaining_isExpired() {
        val state = SessionExpiringProjection.deriveSessionExpiry(session(expiresAtEpochSeconds = now), now)
        assertEquals(0L, state.expiresInSeconds)
        assertTrue(state.hasExpired)
        assertFalse(state.isExpiringSoon)
    }

    @Test
    fun derive_usesFallbackWhenAbsoluteExpiryIsAbsent() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(
                session(expiresAtEpochSeconds = null, expiresInFallbackSeconds = 45),
                now,
            )
        assertEquals(45L, state.expiresInSeconds)
        assertTrue(state.isExpiringSoon)
    }

    @Test
    fun derive_prefersAbsoluteExpiryOverFallback() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(
                session(expiresAtEpochSeconds = now + 30, expiresInFallbackSeconds = 999),
                now,
            )
        assertEquals(30L, state.expiresInSeconds)
    }

    @Test
    fun derive_noExpiryInformation_leavesRemainingNullAndFlagsFalse() {
        val state =
            SessionExpiringProjection.deriveSessionExpiry(
                session(expiresAtEpochSeconds = null, expiresInFallbackSeconds = null),
                now,
            )
        assertEquals(null, state.expiresInSeconds)
        assertFalse(state.isExpiringSoon)
        assertFalse(state.hasExpired)
    }

    // ---- formatCountdown: web `m:ss` (`0:00` floor, zero-padded seconds) ----------------------------

    @Test
    fun formatCountdown_nonPositiveRendersZero() {
        assertEquals("0:00", SessionExpiringProjection.formatCountdown(0L))
        assertEquals("0:00", SessionExpiringProjection.formatCountdown(-15L))
    }

    @Test
    fun formatCountdown_padsSecondsToTwoDigits() {
        assertEquals("0:45", SessionExpiringProjection.formatCountdown(45L))
        assertEquals("0:05", SessionExpiringProjection.formatCountdown(5L))
    }

    @Test
    fun formatCountdown_rollsMinutes() {
        assertEquals("1:00", SessionExpiringProjection.formatCountdown(60L))
        assertEquals("2:05", SessionExpiringProjection.formatCountdown(125L))
    }

    // ---- isOpen: web `open = mode === 'session' && isExpiringSoon && !hasExpired` -------------------

    @Test
    fun isOpen_trueOnlyForExpiringActiveSession() {
        val open =
            SessionExpiryState(SessionMode.Session, expiresInSeconds = 30, isExpiringSoon = true, hasExpired = false)
        assertTrue(SessionExpiringProjection.isOpen(open))
    }

    @Test
    fun isOpen_falseWhenNotExpiringSoon() {
        val healthy =
            SessionExpiryState(SessionMode.Session, expiresInSeconds = 600, isExpiringSoon = false, hasExpired = false)
        assertFalse(SessionExpiringProjection.isOpen(healthy))
    }

    @Test
    fun isOpen_falseWhenHardExpired_yieldsToExpiredModal() {
        val expired =
            SessionExpiryState(SessionMode.Session, expiresInSeconds = -5, isExpiringSoon = false, hasExpired = true)
        assertFalse(SessionExpiringProjection.isOpen(expired))
    }

    @Test
    fun isOpen_falseInOpenMode() {
        val openMode =
            SessionExpiryState(SessionMode.Open, expiresInSeconds = null, isExpiringSoon = false, hasExpired = false)
        assertFalse(SessionExpiringProjection.isOpen(openMode))
    }

    // ---- projectDrafts: web `sort(...).slice(0, 5)` + `drafts.length - 5` ---------------------------

    @Test
    fun projectDrafts_emptyHasNoRowsAndNoOverflow() {
        val projection = SessionExpiringProjection.projectDrafts(emptyList())
        assertTrue(projection.visible.isEmpty())
        assertEquals(0, projection.overflowCount)
    }

    @Test
    fun projectDrafts_underLimitShowsAllWithNoOverflow() {
        val drafts = listOf(DraftSummary("a", 1L), DraftSummary("b", 2L), DraftSummary("c", 3L))
        val projection = SessionExpiringProjection.projectDrafts(drafts)
        assertEquals(3, projection.visible.size)
        assertEquals(0, projection.overflowCount)
    }

    @Test
    fun projectDrafts_overLimitCapsVisibleAndCountsOverflow() {
        val drafts = (1..8).map { DraftSummary("draft:$it", it.toLong()) }
        val projection = SessionExpiringProjection.projectDrafts(drafts)
        assertEquals(DRAFT_DISPLAY_LIMIT, projection.visible.size)
        assertEquals(3, projection.overflowCount)
    }

    @Test
    fun projectDrafts_ordersMostRecentFirst() {
        val drafts =
            listOf(
                DraftSummary("oldest", 100L),
                DraftSummary("newest", 300L),
                DraftSummary("middle", 200L),
            )
        val projection = SessionExpiringProjection.projectDrafts(drafts)
        assertEquals(listOf("newest", "middle", "oldest"), projection.visible.map { it.label })
    }

    @Test
    fun projectDrafts_treatsMissingTimestampAsOldest() {
        val drafts = listOf(DraftSummary("noTime", null), DraftSummary("hasTime", 50L))
        val projection = SessionExpiringProjection.projectDrafts(drafts)
        assertEquals(listOf("hasTime", "noTime"), projection.visible.map { it.label })
    }

    // ---- display: the single projection the composable reads ----------------------------------------

    @Test
    fun display_wiresOpenCountdownDraftsAndRefreshing() {
        val state =
            SessionExpiryState(SessionMode.Session, expiresInSeconds = 45, isExpiringSoon = true, hasExpired = false)
        val display =
            SessionExpiringProjection.display(
                state = state,
                drafts = listOf(DraftSummary("alertstudio:rule:42", 1L)),
                refreshing = true,
            )
        assertTrue(display.open)
        assertEquals("0:45", display.countdownText)
        assertEquals(1, display.drafts.visible.size)
        assertTrue(display.refreshing)
    }

    @Test
    fun display_closedWhenStateIsNotExpiring() {
        val state =
            SessionExpiryState(SessionMode.Session, expiresInSeconds = 600, isExpiringSoon = false, hasExpired = false)
        val display = SessionExpiringProjection.display(state, emptyList(), refreshing = false)
        assertFalse(display.open)
    }

    // ---- applyArg: web `t(key, { countdown })` / `t(key, { count })` interpolation ------------------

    @Test
    fun applyArg_substitutesTheCountdownIntoTheBody() {
        assertEquals(
            "You will be signed out in 0:45.",
            SessionExpiringProjection.applyArg("You will be signed out in %1\$s.", "0:45"),
        )
    }

    @Test
    fun applyArg_substitutesTheCountIntoTheOverflowRow() {
        assertEquals("+3 more", SessionExpiringProjection.applyArg("+%1\$s more", "3"))
    }

    // ---- Registry + diagnostics ---------------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("session-expiring-modal", SessionExpiringRegistration.ID)
        assertEquals("SessionExpiringModal", SessionExpiringRegistration.SLUG)
    }

    @Test
    fun recordSessionExpiringOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordSessionExpiringOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SessionExpiringModal"), fields)
        // The diagnostic must carry no countdown / remaining seconds / draft label — only the slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
