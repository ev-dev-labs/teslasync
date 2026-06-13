// Off-device verification of the NewVersionBanner pure adapter — the native mirror of every decision the web
// component makes before rendering (or returning null) (web/src/components/feedback/NewVersionBanner.tsx), folded
// onto the wired version feed (ADR-013): the loading / error / prompt / resolved phases, the up-to-date vs
// deferred resolved copy, the re-surface-on-newer-deploy guard, and the TTL-stale vs offline freshness chips.
// Because the composable is a thin render layer over [NewVersionBannerProjection], the per-branch assertions here
// double as the surface's state "snapshot". Runs in the :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NewVersionBannerProjectionTest {
    private val stamp = 1_700_000_000_000L

    private fun content(
        version: String,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<String> =
        UiState(
            phase = UiPhase.Content,
            data = version,
            fetchedAt = stamp,
            stale = stale,
            errorKind = errorKind,
        )

    private fun watcher(
        newVersionAvailable: Boolean,
        boot: String = "v1",
        latest: String = if (newVersionAvailable) "v2" else "v1",
    ): VersionWatcherState = VersionWatcherState(bootVersion = boot, latestVersion = latest, newVersionAvailable = newVersionAvailable)

    // ── loading: the feed is loading with nothing cached → the loading surface (web hidden during load) ──────

    @Test
    fun loadingFeedIsTheLoadingPhase() {
        val r = NewVersionBannerProjection.render(UiState.loading(), VersionWatcherState.Initial, dismissedVersion = null)
        assertEquals(NewVersionPhase.Loading, r.phase)
        assertTrue(r.showLoading)
        assertFalse(r.showPrompt)
        assertFalse(r.showStaleChip)
        assertFalse(r.showOfflineChip)
    }

    @Test
    fun loadingSeedHelperIsTheLoadingSurface() {
        val r = NewVersionBannerProjection.loading()
        assertEquals(NewVersionPhase.Loading, r.phase)
        assertEquals(VersionWatcherState.Initial, r.watcher)
    }

    // ── error: a hard fetch failure with no cache → the error surface + retry (web hides; platform shows) ────

    @Test
    fun errorFeedWithNoCacheIsTheErrorPhase() {
        val errored = UiState<String>(phase = UiPhase.Error, data = null, errorKind = ErrorKind.Network)
        val r = NewVersionBannerProjection.render(errored, VersionWatcherState.Initial, dismissedVersion = null)
        assertEquals(NewVersionPhase.Error, r.phase)
        assertTrue(r.showError)
        assertEquals(ErrorKind.Network, r.errorKind)
        assertFalse(r.showPrompt)
    }

    // ── prompt: newVersionAvailable && not deferred → the active banner (the web's only rendered state) ──────

    @Test
    fun newVersionNotDeferredIsThePrompt() {
        val r = NewVersionBannerProjection.render(content("v2"), watcher(newVersionAvailable = true), dismissedVersion = null)
        assertEquals(NewVersionPhase.Prompt, r.phase)
        assertTrue(r.showPrompt)
        assertTrue(r.watcher.newVersionAvailable)
    }

    @Test
    fun aDeferralForADifferentVersionStillShowsThePrompt() {
        // Deferred "v1" but the latest is now "v2" — the web reset: the dismissal does not carry forward.
        val r =
            NewVersionBannerProjection.render(
                content("v2"),
                watcher(newVersionAvailable = true, latest = "v2"),
                dismissedVersion = "v1",
            )
        assertEquals(NewVersionPhase.Prompt, r.phase)
        assertTrue(r.showPrompt)
    }

    // ── resolved: up to date OR deferred → the recorded-state panel (the native web `return null`) ───────────

    @Test
    fun noNewVersionIsResolvedUpToDate() {
        val r = NewVersionBannerProjection.render(content("v1"), watcher(newVersionAvailable = false), dismissedVersion = null)
        assertEquals(NewVersionPhase.Resolved, r.phase)
        assertEquals(ResolvedReason.UpToDate, r.resolvedReason)
        assertFalse(r.showPrompt)
    }

    @Test
    fun newVersionDeferredForLatestIsResolvedDeferred() {
        val r =
            NewVersionBannerProjection.render(
                content("v2"),
                watcher(newVersionAvailable = true, latest = "v2"),
                dismissedVersion = "v2",
            )
        assertEquals(NewVersionPhase.Resolved, r.phase)
        assertEquals(ResolvedReason.Deferred, r.resolvedReason)
        assertFalse("a deferred banner is not the active prompt", r.showPrompt)
    }

    // ── stale vs offline: a TTL-stale feed shows the Stale chip; a cache-after-failure shows offline + retry ─

    @Test
    fun ttlStaleFeedShowsStaleChipNotOffline() {
        val staleFeed = content("v2", stale = true)
        val r = NewVersionBannerProjection.render(staleFeed, watcher(newVersionAvailable = true), dismissedVersion = null)
        assertTrue("a TTL-stale feed shows the stale chip", r.showStaleChip)
        assertFalse("a TTL-stale feed is not offline", r.showOfflineChip)
        assertTrue("the last-known prompt is still rendered", r.showPrompt)
    }

    @Test
    fun offlineFeedShowsOfflineChipAndRetainsTheLastKnownPrompt() {
        val offline = content("v2", stale = true, errorKind = ErrorKind.Network)
        val r = NewVersionBannerProjection.render(offline, watcher(newVersionAvailable = true), dismissedVersion = null)
        assertTrue("a cache-after-failure feed shows the offline chip", r.showOfflineChip)
        assertFalse("offline is distinct from the TTL-stale chip", r.showStaleChip)
        assertTrue("the last-known prompt stays visible while offline", r.showPrompt)
    }

    @Test
    fun freshContentShowsNoFreshnessChips() {
        val r = NewVersionBannerProjection.render(content("v2"), watcher(newVersionAvailable = true), dismissedVersion = null)
        assertFalse(r.showStaleChip)
        assertFalse(r.showOfflineChip)
    }
}
