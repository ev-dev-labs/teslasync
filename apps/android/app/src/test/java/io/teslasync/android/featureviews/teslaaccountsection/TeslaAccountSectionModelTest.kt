package io.teslasync.android.featureviews.teslaaccountsection

import io.teslasync.shared.core.presentation.settings.AuthStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device coverage of the [TeslaAccountSection] data adapter (the prompt's "adapter unit test: cached →
 * projection") — the pure derivations the composable renders: the connected / not-connected / expired
 * status branch (web `auth?.authenticated && !pillDisconnected`), the connect-vs-manage action branch (web
 * `!auth?.authenticated`), the token-expiry parse (web `new Date(expires_at)` + `Number.isNaN` guard), and
 * the "expires within 7 days" soft-warning math (web `expiringSoon`). Pinned to a fixed clock for
 * determinism. Mirrors the web component
 * (web/src/features/settings/components/TeslaAccountSection.tsx).
 */
class TeslaAccountSectionModelTest {
    private val now: Long = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()

    private fun isoIn(days: Long): String = Instant.ofEpochMilli(now + days * TeslaAccountView.DAY_MS).toString()

    // ── TeslaAccountView.from — status + action branch ─────────────────────────────

    @Test
    fun notAuthenticatedShowsConnectActionAndNotConnectedStatus() {
        val view = TeslaAccountView.from(AuthStatus(authenticated = false), reauthNeeded = false, nowMs = now)
        assertFalse(view.connected)
        assertFalse(view.showDisconnectedPill)
        assertTrue(view.showConnectAction)
        assertNull(view.expiringSoonDays)
    }

    @Test
    fun nullAuthIsTreatedAsNotAuthenticated() {
        val view = TeslaAccountView.from(auth = null, reauthNeeded = false, nowMs = now)
        assertFalse(view.connected)
        assertTrue(view.showConnectAction)
    }

    @Test
    fun authenticatedAndNotReauthIsConnectedWithManageActions() {
        val view =
            TeslaAccountView.from(
                AuthStatus(authenticated = true, expiresAt = isoIn(days = 60)),
                reauthNeeded = false,
                nowMs = now,
            )
        assertTrue(view.connected)
        assertFalse(view.showDisconnectedPill)
        assertFalse(view.showConnectAction)
        assertNull(view.expiringSoonDays)
    }

    @Test
    fun authenticatedButReauthNeededShowsDisconnectedPillYetKeepsManageActions() {
        // Web edge: the server still reports authenticated but the re-auth signal forces the expired view;
        // the action row stays the manage set (it depends on `authenticated` alone, not `pillDisconnected`).
        val view =
            TeslaAccountView.from(
                AuthStatus(authenticated = true, expiresAt = isoIn(days = 60)),
                reauthNeeded = true,
                nowMs = now,
            )
        assertFalse(view.connected)
        assertTrue(view.showDisconnectedPill)
        assertFalse(view.showConnectAction)
    }

    // ── expiringSoonDays — the 7-day soft-warning window ───────────────────────────

    @Test
    fun expiringSoonWithinWindowReportsWholeDaysCeiled() {
        val view =
            TeslaAccountView.from(
                AuthStatus(authenticated = true, expiresAt = isoIn(days = 3)),
                reauthNeeded = false,
                nowMs = now,
            )
        assertEquals(3, view.expiringSoonDays)
    }

    @Test
    fun expiringSoonCeilsPartialDays() {
        // 2.5 days remaining → ceil → 3.
        val expiresAt = Instant.ofEpochMilli(now + (TeslaAccountView.DAY_MS * 5 / 2)).toString()
        val days =
            TeslaAccountView.expiringSoonDays(
                authenticated = true,
                expiresAtMillis = Instant.parse(expiresAt).toEpochMilli(),
                nowMs = now,
            )
        assertEquals(3, days)
    }

    @Test
    fun expiringSoonFloorsAtOneDayForImminentExpiry() {
        // A token expiring in an hour is still "Expires in 1d", never 0 (web `Math.max(1, …)`).
        val expiresAt = now + 60L * 60L * 1000L
        assertEquals(1, TeslaAccountView.expiringSoonDays(authenticated = true, expiresAtMillis = expiresAt, nowMs = now))
    }

    @Test
    fun expiringSoonIncludesExactlySevenDayBoundary() {
        assertEquals(
            7,
            TeslaAccountView.expiringSoonDays(authenticated = true, expiresAtMillis = now + TeslaAccountView.SEVEN_DAYS_MS, nowMs = now),
        )
    }

    @Test
    fun expiringSoonNullBeyondWindow() {
        val view =
            TeslaAccountView.from(
                AuthStatus(authenticated = true, expiresAt = isoIn(days = 8)),
                reauthNeeded = false,
                nowMs = now,
            )
        assertNull(view.expiringSoonDays)
    }

    @Test
    fun expiringSoonNullWhenAlreadyExpired() {
        assertNull(TeslaAccountView.expiringSoonDays(authenticated = true, expiresAtMillis = now - 1L, nowMs = now))
        assertNull(TeslaAccountView.expiringSoonDays(authenticated = true, expiresAtMillis = now, nowMs = now))
    }

    @Test
    fun expiringSoonNullWhenNotAuthenticatedOrNoExpiry() {
        assertNull(TeslaAccountView.expiringSoonDays(authenticated = false, expiresAtMillis = now + TeslaAccountView.DAY_MS, nowMs = now))
        assertNull(TeslaAccountView.expiringSoonDays(authenticated = true, expiresAtMillis = null, nowMs = now))
    }

    // ── parseExpiry — the token-expiry parse ───────────────────────────────────────

    @Test
    fun parseExpiryReturnsMillisForValidIso() {
        assertEquals(Instant.parse("2027-01-01T00:00:00Z").toEpochMilli(), TeslaAccountView.parseExpiry("2027-01-01T00:00:00Z"))
    }

    @Test
    fun parseExpiryNullForBlankOrUnparseable() {
        assertNull(TeslaAccountView.parseExpiry(null))
        assertNull(TeslaAccountView.parseExpiry(""))
        assertNull(TeslaAccountView.parseExpiry("   "))
        assertNull(TeslaAccountView.parseExpiry("not-a-date"))
    }

    @Test
    fun expiresAtMillisIsParsedIntoTheView() {
        val view =
            TeslaAccountView.from(
                AuthStatus(authenticated = true, expiresAt = "2027-01-01T00:00:00Z"),
                reauthNeeded = false,
                nowMs = now,
            )
        assertEquals(Instant.parse("2027-01-01T00:00:00Z").toEpochMilli(), view.expiresAtMillis)
    }

    @Test
    fun registrationSlugMatchesTheDiagnosticsContract() {
        assertEquals("TeslaAccountSection", TeslaAccountSectionRegistration.SLUG)
    }
}
