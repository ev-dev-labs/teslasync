package io.teslasync.android.sharedsurfaces.datafreshness

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DataFreshness pure adapter — the native mirror of every decision the web
 * `DataFreshness` makes between a `useQuery()` result and the rendered chip
 * (web/src/components/data-display/DataFreshness.tsx): the cache-then-network UiState → freshness fold, the
 * status precedence (error > fetching > stale > fresh, with the offline split), the `formatRelativeTime`
 * buckets, the `title` tooltip, and the `forceStaleAfterMs` window. Because the composable is a thin render
 * layer over [DataFreshnessProjection], the per-branch assertions here double as the surface's state
 * "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class DataFreshnessProjectionTest {
    private val base = 1_000_000_000_000L

    private fun content(
        rows: List<Int> = listOf(1),
        fetchedAt: Long? = base,
        stale: Boolean = false,
        refreshing: Boolean = false,
        errorKind: ErrorKind? = null,
    ) = UiState(
        phase = if (rows.isEmpty()) UiPhase.Empty else UiPhase.Content,
        data = rows,
        fetchedAt = fetchedAt,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
    )

    // ── toFreshnessSnapshot: UiState → freshness signals (PII-free) ───────────────────────────────────

    @Test
    fun loadingWithNoCacheFoldsToFetchingFirstLoad() {
        val snap = UiState.loading<List<Int>>().toFreshnessSnapshot()
        assertEquals(null, snap.updatedAtMs)
        assertTrue(snap.fetching)
        assertFalse(snap.hasData)
        assertFalse(snap.hardError)
        assertFalse(snap.offline)
    }

    @Test
    fun successContentFoldsToFreshSignals() {
        val snap = content(fetchedAt = base).toFreshnessSnapshot()
        assertEquals(base, snap.updatedAtMs)
        assertFalse(snap.fetching)
        assertFalse(snap.stale)
        assertFalse(snap.hardError)
        assertFalse(snap.offline)
        assertTrue(snap.hasData)
        assertFalse(snap.empty)
    }

    @Test
    fun refreshOverCacheFoldsToFetchingWithData() {
        val snap = content(refreshing = true).toFreshnessSnapshot()
        assertTrue(snap.fetching)
        assertTrue(snap.hasData)
    }

    @Test
    fun hardErrorWithNoCacheFoldsToHardError() {
        val snap =
            UiState<List<Int>>(phase = UiPhase.Error, fetchedAt = null, errorKind = ErrorKind.Network)
                .toFreshnessSnapshot()
        assertTrue(snap.hardError)
        assertFalse(snap.offline)
        assertFalse(snap.hasData)
    }

    @Test
    fun errorWithCacheFoldsToOfflineLastKnown() {
        val snap = content(stale = true, errorKind = ErrorKind.Network).toFreshnessSnapshot()
        assertFalse("an error that still has cache is not a hard error", snap.hardError)
        assertTrue("it is the honest offline / last-known surface", snap.offline)
        assertTrue(snap.hasData)
        assertTrue(snap.stale)
    }

    @Test
    fun resolvedEmptyRowsFoldsToEmptyButFresh() {
        val snap = content(rows = emptyList()).toFreshnessSnapshot()
        assertTrue(snap.empty)
        assertTrue("an empty list is still data", snap.hasData)
        assertFalse(snap.hardError)
        assertEquals(FreshnessStatus.Fresh, DataFreshnessProjection.statusFor(snap, effectiveStale = false))
    }

    // ── statusFor: web precedence error > fetching > stale > fresh (+ offline split) ───────────────────

    @Test
    fun statusFollowsTheWebPrecedence() {
        val both =
            FreshnessSnapshot(
                updatedAtMs = base,
                fetching = true,
                stale = true,
                hardError = true,
                offline = false,
                hasData = false,
                empty = false,
            )
        assertEquals("hard error wins", FreshnessStatus.Error, DataFreshnessProjection.statusFor(both, true))

        val offline = both.copy(hardError = false, offline = true)
        assertEquals("offline beats fetching", FreshnessStatus.Offline, DataFreshnessProjection.statusFor(offline, true))

        val fetching = offline.copy(offline = false)
        assertEquals("fetching beats stale", FreshnessStatus.Fetching, DataFreshnessProjection.statusFor(fetching, true))

        val stale = fetching.copy(fetching = false)
        assertEquals(FreshnessStatus.Stale, DataFreshnessProjection.statusFor(stale, true))

        val fresh = stale.copy(stale = false)
        assertEquals(FreshnessStatus.Fresh, DataFreshnessProjection.statusFor(fresh, false))
    }

    // ── relativeLabel: web formatRelativeTime buckets ─────────────────────────────────────────────────

    @Test
    fun relativeLabelHoldsJustNowForTheFirstMinute() {
        val snap = content().toFreshnessSnapshot()
        assertEquals(RelativeLabel(RelativeUnit.JustNow), DataFreshnessProjection.relativeLabel(snap, base + 30_000L))
    }

    @Test
    fun relativeLabelBucketsMinutesHoursDaysWeeks() {
        val snap = content().toFreshnessSnapshot()
        assertEquals(RelativeLabel(RelativeUnit.Minutes, 5), DataFreshnessProjection.relativeLabel(snap, base + 5 * 60_000L))
        assertEquals(RelativeLabel(RelativeUnit.Hours, 2), DataFreshnessProjection.relativeLabel(snap, base + 2 * 3_600_000L))
        assertEquals(RelativeLabel(RelativeUnit.Days, 3), DataFreshnessProjection.relativeLabel(snap, base + 3 * 86_400_000L))
        assertEquals(RelativeLabel(RelativeUnit.Weeks, 2), DataFreshnessProjection.relativeLabel(snap, base + 2 * 604_800_000L))
    }

    @Test
    fun relativeLabelIsUpdatingWhileFetchingAndErrorWhenHardError() {
        val fetching = UiState.loading<List<Int>>().toFreshnessSnapshot()
        assertEquals(RelativeLabel(RelativeUnit.Updating), DataFreshnessProjection.relativeLabel(fetching, base))

        val hardError =
            UiState<List<Int>>(phase = UiPhase.Error, fetchedAt = null, errorKind = ErrorKind.Network)
                .toFreshnessSnapshot()
        assertEquals(RelativeLabel(RelativeUnit.Error), DataFreshnessProjection.relativeLabel(hardError, base))
    }

    @Test
    fun relativeLabelIsNoneWhenNeverUpdated() {
        val never =
            FreshnessSnapshot(
                updatedAtMs = null,
                fetching = false,
                stale = false,
                hardError = false,
                offline = false,
                hasData = false,
                empty = false,
            )
        assertEquals(RelativeLabel(RelativeUnit.None), DataFreshnessProjection.relativeLabel(never, base))
    }

    @Test
    fun negativeClockSkewClampsToJustNow() {
        val snap = content().toFreshnessSnapshot()
        assertEquals(RelativeLabel(RelativeUnit.JustNow), DataFreshnessProjection.relativeLabel(snap, base - 5_000L))
    }

    // ── tooltipFor: web title ─────────────────────────────────────────────────────────────────────────

    @Test
    fun tooltipIsUpdatingOnlyUnderReducedMotionWhileFetching() {
        val fetching = UiState.loading<List<Int>>().toFreshnessSnapshot()
        assertEquals(TooltipKind.Updating, DataFreshnessProjection.tooltipFor(fetching, reduceMotion = true).kind)
        // Without reduced motion a fetching surface with no stamp announces "never updated".
        assertEquals(TooltipKind.NeverUpdated, DataFreshnessProjection.tooltipFor(fetching, reduceMotion = false).kind)
    }

    @Test
    fun tooltipIsLastUpdatedWhenAStampExists() {
        val snap = content(fetchedAt = base).toFreshnessSnapshot()
        val tooltip = DataFreshnessProjection.tooltipFor(snap, reduceMotion = false)
        assertEquals(TooltipKind.LastUpdated, tooltip.kind)
        assertEquals(base, tooltip.atMs)
    }

    @Test
    fun tooltipIsNeverUpdatedWithNoStamp() {
        val never =
            FreshnessSnapshot(null, fetching = false, stale = false, hardError = false, offline = false, hasData = false, empty = false)
        assertEquals(TooltipKind.NeverUpdated, DataFreshnessProjection.tooltipFor(never, reduceMotion = false).kind)
    }

    // ── isForcedStale: web DataFreshnessAuto.forceStaleAfterMs ─────────────────────────────────────────

    @Test
    fun forcedStaleOnlyOncePastTheWindow() {
        assertTrue(DataFreshnessProjection.isForcedStale(base, base + 10_000L, 5_000L))
        assertFalse(DataFreshnessProjection.isForcedStale(base, base + 1_000L, 5_000L))
        assertFalse("null window never forces", DataFreshnessProjection.isForcedStale(base, base + 10_000L, null))
        assertFalse("null stamp never forces", DataFreshnessProjection.isForcedStale(null, base, 5_000L))
        assertFalse("non-positive window never forces", DataFreshnessProjection.isForcedStale(base, base + 10_000L, 0L))
    }

    @Test
    fun renderForcesStaleTierOnAnAgedFreshValue() {
        val snap = content(fetchedAt = base).toFreshnessSnapshot()
        val render =
            DataFreshnessProjection.render(
                snapshot = snap,
                nowMs = base + 10_000L,
                reduceMotion = true,
                refetchable = true,
                forceStaleAfterMs = 5_000L,
            )
        assertEquals(FreshnessStatus.Stale, render.status)
    }

    // ── render: animation gating + refreshability ─────────────────────────────────────────────────────

    @Test
    fun reducedMotionSuppressesEveryAnimation() {
        val fetching = UiState.loading<List<Int>>().toFreshnessSnapshot()
        val render = DataFreshnessProjection.render(fetching, base, reduceMotion = true, refetchable = true)
        assertFalse(render.showPing)
        assertFalse(render.showPulse)
        assertFalse(render.spin)
    }

    @Test
    fun fetchingAnimatesRingAndSpinButPulsesOnlyWithCachedData() {
        val firstLoad = UiState.loading<List<Int>>().toFreshnessSnapshot()
        val first = DataFreshnessProjection.render(firstLoad, base, reduceMotion = false, refetchable = true)
        assertTrue(first.showPing)
        assertTrue(first.spin)
        assertFalse("no background pulse without cached data", first.showPulse)

        val backgroundRefetch = content(refreshing = true).toFreshnessSnapshot()
        val background = DataFreshnessProjection.render(backgroundRefetch, base, reduceMotion = false, refetchable = true)
        assertTrue(background.showPulse)
    }

    @Test
    fun refreshableOnlyWhenToggledAndNotFetching() {
        val fresh = content().toFreshnessSnapshot()
        assertTrue(DataFreshnessProjection.render(fresh, base, reduceMotion = true, refetchable = true).refreshable)
        assertFalse(DataFreshnessProjection.render(fresh, base, reduceMotion = true, refetchable = false).refreshable)

        val fetching = UiState.loading<List<Int>>().toFreshnessSnapshot()
        assertFalse(
            "a fetch in flight is never refreshable (web onRefresh && !isFetching)",
            DataFreshnessProjection.render(fetching, base, reduceMotion = true, refetchable = true).refreshable,
        )
    }

    @Test
    fun statusSlugsAreTheStablePiiFreeStateWords() {
        assertEquals("fresh", FreshnessStatus.Fresh.slug)
        assertEquals("fetching", FreshnessStatus.Fetching.slug)
        assertEquals("stale", FreshnessStatus.Stale.slug)
        assertEquals("error", FreshnessStatus.Error.slug)
        assertEquals("offline", FreshnessStatus.Offline.slug)
    }
}
