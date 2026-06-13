// Off-device verification of the deployment watcher — the native mirror of the web `useVersionWatcher`
// boot-capture + latest-tracking + divergence logic (web/src/hooks/useVersionWatcher.ts). Pure fold semantics, no
// coroutines/UI. Runs in the :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NewVersionBannerWatchTest {
    // ── fold: a null / blank identity is "nothing known yet" and never disturbs the captured state ───────────

    @Test
    fun foldIgnoresNullAndBlankIdentities() {
        assertEquals(VersionWatcherState.Initial, VersionWatch.fold(VersionWatcherState.Initial, null))
        assertEquals(VersionWatcherState.Initial, VersionWatch.fold(VersionWatcherState.Initial, ""))
        assertEquals(VersionWatcherState.Initial, VersionWatch.fold(VersionWatcherState.Initial, "   "))
    }

    // ── fold: the first known identity is captured as boot, ONCE (web boot probe) ────────────────────────────

    @Test
    fun foldCapturesBootOnce() {
        val afterFirst = VersionWatch.fold(VersionWatcherState.Initial, "v1")
        assertEquals("v1", afterFirst.bootVersion)
        assertEquals("v1", afterFirst.latestVersion)
        assertFalse(afterFirst.newVersionAvailable)

        // A later identity tracks latest but NEVER overwrites the captured boot.
        val afterSecond = VersionWatch.fold(afterFirst, "v2")
        assertEquals("v1", afterSecond.bootVersion)
        assertEquals("v2", afterSecond.latestVersion)
    }

    // ── fold: divergence from boot is the web `latestVersion !== bootVersion` redeploy signal ────────────────

    @Test
    fun foldFlagsNewVersionOnDivergence() {
        val state = VersionWatch.fold(VersionWatch.fold(VersionWatcherState.Initial, "v1"), "v2")
        assertTrue(state.newVersionAvailable)
    }

    @Test
    fun foldDoesNotFlagWhenIdentityIsUnchanged() {
        val state = VersionWatch.fold(VersionWatch.fold(VersionWatcherState.Initial, "v1"), "v1")
        assertFalse(state.newVersionAvailable)
    }

    @Test
    fun foldClearsTheFlagWhenIdentityReturnsToBoot() {
        val diverged = VersionWatch.fold(VersionWatch.fold(VersionWatcherState.Initial, "v1"), "v2")
        assertTrue(diverged.newVersionAvailable)
        val backToBoot = VersionWatch.fold(diverged, "v1")
        assertFalse("latest == boot again clears the signal", backToBoot.newVersionAvailable)
    }

    // ── rebaseline: the native effect of the web "Reload" — boot is realigned to latest, banner clears ───────

    @Test
    fun rebaselineAlignsBootToLatestAndClearsTheFlag() {
        val diverged = VersionWatch.fold(VersionWatch.fold(VersionWatcherState.Initial, "v1"), "v2")
        val rebaselined = diverged.rebaselined()
        assertEquals("v2", rebaselined.bootVersion)
        assertEquals("v2", rebaselined.latestVersion)
        assertFalse(rebaselined.newVersionAvailable)
    }

    @Test
    fun rebaselineIsANoopWhenNoIdentityIsKnown() {
        assertNull(VersionWatcherState.Initial.rebaselined().latestVersion)
        assertFalse(VersionWatcherState.Initial.rebaselined().newVersionAvailable)
    }
}
