package io.teslasync.android.sharedsurfaces.installprompt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the InstallPrompt's pure logic — the native mirror of every decision the web component
 * makes (web/src/components/feedback/InstallPrompt.tsx): the 14-day sticky-dismissal window (`wasDismissedRecently`),
 * and the `isStandaloneMode() || wasDismissedRecently()` → render-nothing classification (plus the install-path gate).
 * Because the composable is a thin render layer over [classifyInstallPrompt], the per-branch assertions here double as
 * the surface's per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class InstallPromptModelTest {
    private companion object {
        const val NOW: Long = 1_700_000_000_000L
        const val DAY_MS: Long = 86_400_000L
    }

    // ── constants carried verbatim from the web ──────────────────────────────────────────────────────

    @Test
    fun dismissalWindowMatchesTheWebContract() {
        assertEquals("InstallPrompt", INSTALL_PROMPT_SLUG)
        assertEquals(14, INSTALL_DISMISS_WINDOW_DAYS)
        assertEquals(14L * DAY_MS, INSTALL_DISMISS_WINDOW_MS)
        assertEquals("teslasync-pwa-install-dismissed", INSTALL_DISMISS_STORAGE_KEY)
    }

    // ── wasDismissedRecently (web `wasDismissedRecently()`) ───────────────────────────────────────────

    @Test
    fun aMissingTimestampIsNotDismissed() {
        // Web: no localStorage value → `false`.
        assertFalse(wasDismissedRecently(dismissedAtMs = null, nowMs = NOW))
    }

    @Test
    fun aRecentTimestampIsDismissed() {
        // Web: `Date.now() - ts < DISMISS_DAYS * 86_400_000`.
        assertTrue(wasDismissedRecently(dismissedAtMs = NOW - DAY_MS, nowMs = NOW))
    }

    @Test
    fun aTimestampOlderThanTheWindowIsNotDismissed() {
        assertFalse(wasDismissedRecently(dismissedAtMs = NOW - 15L * DAY_MS, nowMs = NOW))
    }

    @Test
    fun theWindowBoundaryIsExclusive() {
        // Exactly DISMISS_DAYS old → not recent (the web `<` comparison); one ms inside → recent.
        assertFalse(wasDismissedRecently(dismissedAtMs = NOW - INSTALL_DISMISS_WINDOW_MS, nowMs = NOW))
        assertTrue(wasDismissedRecently(dismissedAtMs = NOW - INSTALL_DISMISS_WINDOW_MS + 1, nowMs = NOW))
    }

    // ── classifyInstallPrompt: the per-state snapshot ────────────────────────────────────────────────

    @Test
    fun classifyShowsActiveWhenSupportedNotInstalledAndNotDismissed() {
        // Web "renders the prompt once `beforeinstallprompt` fires and it is neither standalone nor dismissed".
        assertEquals(
            InstallPromptSurface.Active,
            classifyInstallPrompt(installSupported = true, alreadyInstalled = false, dismissedRecently = false),
        )
    }

    @Test
    fun classifyHidesWhenNoInstallPathExists() {
        // Web "never shows without a `beforeinstallprompt` event".
        assertEquals(
            InstallPromptSurface.Hidden,
            classifyInstallPrompt(installSupported = false, alreadyInstalled = false, dismissedRecently = false),
        )
    }

    @Test
    fun classifyHidesWhenAlreadyInstalled() {
        // Web `isStandaloneMode()` → never show.
        assertEquals(
            InstallPromptSurface.Hidden,
            classifyInstallPrompt(installSupported = true, alreadyInstalled = true, dismissedRecently = false),
        )
    }

    @Test
    fun classifyHidesWhenDismissedRecently() {
        // Web `wasDismissedRecently()` → never show.
        assertEquals(
            InstallPromptSurface.Hidden,
            classifyInstallPrompt(installSupported = true, alreadyInstalled = false, dismissedRecently = true),
        )
    }

    // ── accessibility label (TalkBack announcement) ──────────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndSubtitle() {
        assertEquals(
            "Install TeslaSync. Add to home screen for native experience",
            installPromptAccessibilityLabel(
                "Install TeslaSync",
                "Add to home screen for native experience",
            ),
        )
    }
}
