package io.teslasync.android.components.feedback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free feedback logic (countdown/retry windows, query-error
 * classification, skeleton + threshold math, version comparison, toast queue, step navigation,
 * goto routing, job-drawer visibility, draft ordering, byte formatting). These run in the
 * `:android:testDebugUnitTest` gate and cover the behavior the composables only render.
 */
class FeedbackLogicTest {
    // ── Countdown + retry ────────────────────────────────────────────────────────
    @Test
    fun remainingSecondsRoundsUpAndFloorsAtZero() {
        assertEquals(6, remainingSeconds(10_000L, 4_000L))
        assertEquals(1, remainingSeconds(10_500L, 10_000L))
        assertEquals(0, remainingSeconds(1_000L, 2_000L))
    }

    @Test
    fun retryEnabledOnlyWhenCooldownElapsed() {
        assertTrue(retryEnabled(0))
        assertTrue(retryEnabled(-1))
        assertFalse(retryEnabled(5))
    }

    @Test
    fun formatCountdownPadsSecondsAndClamps() {
        assertEquals("0:00", formatCountdown(0))
        assertEquals("0:00", formatCountdown(-5))
        assertEquals("0:45", formatCountdown(45))
        assertEquals("2:05", formatCountdown(125))
    }

    // ── Query-error classification ───────────────────────────────────────────────
    @Test
    fun classifyQueryErrorPrioritizesWaitingThenStatus() {
        assertEquals(QueryErrorKind.Waiting, classifyQueryError(500, online = true, transientWaiting = true))
        assertEquals(QueryErrorKind.NotFound, classifyQueryError(404, online = true, transientWaiting = false))
        assertEquals(QueryErrorKind.Unauthorized, classifyQueryError(401, online = true, transientWaiting = false))
        assertEquals(QueryErrorKind.Unauthorized, classifyQueryError(403, online = true, transientWaiting = false))
        assertEquals(QueryErrorKind.ServerError, classifyQueryError(503, online = true, transientWaiting = false))
        assertEquals(QueryErrorKind.Offline, classifyQueryError(0, online = true, transientWaiting = false))
        assertEquals(QueryErrorKind.Offline, classifyQueryError(null, online = false, transientWaiting = false))
        assertEquals(QueryErrorKind.Network, classifyQueryError(null, online = true, transientWaiting = false))
    }

    @Test
    fun autoRetryOnlyForOffline() {
        assertTrue(autoRetriesOnReconnect(QueryErrorKind.Offline))
        assertFalse(autoRetriesOnReconnect(QueryErrorKind.ServerError))
    }

    // ── Skeleton + threshold ──────────────────────────────────────────────────────
    @Test
    fun skeletonLineFractionShortensLastLineOnly() {
        assertEquals(1f, skeletonLineFraction(0, 3))
        assertEquals(0.6f, skeletonLineFraction(2, 3))
        assertEquals(1f, skeletonLineFraction(0, 1))
    }

    @Test
    fun thresholdMathReachedAndRemaining() {
        assertTrue(thresholdReached(30, 30))
        assertFalse(thresholdReached(29, 30))
        assertEquals(18, remainingToThreshold(12, 30))
        assertEquals(0, remainingToThreshold(40, 30))
    }

    // ── Version comparison ─────────────────────────────────────────────────────────
    @Test
    fun compareVersionsHandlesUnequalLengthsAndPrefixes() {
        assertTrue(compareVersions("1.3.0", "1.2.0") > 0)
        assertEquals(0, compareVersions("v1.2.0", "1.2.0"))
        assertTrue(compareVersions("1.2", "1.2.1") < 0)
        assertTrue(compareVersions("1.2.0-beta", "1.2.0") == 0)
    }

    @Test
    fun isNewerVersionStrictlyGreater() {
        assertTrue(isNewerVersion(current = "1.2.0", latest = "1.3.0"))
        assertFalse(isNewerVersion(current = "1.3.0", latest = "1.3.0"))
        assertFalse(isNewerVersion(current = "2.0.0", latest = "1.9.9"))
    }

    // ── Toast queue ──────────────────────────────────────────────────────────────
    @Test
    fun enqueueToastCapsAndDropsOldest() {
        val a = ToastItem(1, "a")
        val b = ToastItem(2, "b")
        val c = ToastItem(3, "c")
        val d = ToastItem(4, "d")
        val queue = enqueueToast(enqueueToast(enqueueToast(enqueueToast(emptyList(), a, 3), b, 3), c, 3), d, 3)
        assertEquals(listOf(2L, 3L, 4L), queue.map { it.id })
    }

    @Test
    fun dismissToastRemovesById() {
        val queue = listOf(ToastItem(1, "a"), ToastItem(2, "b"))
        assertEquals(listOf(2L), dismissToast(queue, 1).map { it.id })
    }

    // ── Step navigation ────────────────────────────────────────────────────────────
    @Test
    fun stepNavigationClampsBothEnds() {
        assertEquals(0, clampStepIndex(-3, 4))
        assertEquals(3, clampStepIndex(9, 4))
        assertEquals(0, clampStepIndex(0, 0))
        assertEquals(2, nextStepIndex(1, 4))
        assertEquals(3, nextStepIndex(3, 4))
        assertEquals(0, prevStepIndex(0))
        assertTrue(isFirstStep(0))
        assertTrue(isLastStep(3, 4))
        assertFalse(isLastStep(2, 4))
    }

    @Test
    fun stepProgressIsFractional() {
        assertEquals(1f / 3f, stepProgress(0, 3), 1e-6f)
        assertEquals(1f, stepProgress(2, 3), 1e-6f)
        assertEquals(0f, stepProgress(0, 0), 1e-6f)
    }

    // ── Goto routing ───────────────────────────────────────────────────────────────
    @Test
    fun appendGotoKeyKeepsTail() {
        assertEquals("gd", appendGotoKey("g", 'd', 3))
        assertEquals("bcd", appendGotoKey("abc", 'd', 3))
    }

    @Test
    fun matchGotoRouteLooksUpSequence() {
        val routes = mapOf("gd" to "/drives", "gc" to "/charging")
        assertEquals("/drives", matchGotoRoute("gd", routes))
        assertNull(matchGotoRoute("gx", routes))
    }

    // ── Job drawer ─────────────────────────────────────────────────────────────────
    @Test
    fun jobActivityAndBuckets() {
        val jobs =
            listOf(
                JobSummary("1", "A", JobStatus.Processing),
                JobSummary("2", "B", JobStatus.Ready),
                JobSummary("3", "C", JobStatus.Queued),
                JobSummary("4", "D", JobStatus.Failed),
            )
        assertTrue(isJobActive(JobStatus.Queued))
        assertFalse(isJobActive(JobStatus.Ready))
        assertEquals(listOf("1", "3"), activeJobs(jobs).map { it.id })
        assertEquals(listOf("2"), recentJobs(jobs, 1).map { it.id })
    }

    @Test
    fun drawerVisibilityAndHiding() {
        assertEquals(DrawerVisibility.Minimized, resolveDrawerVisibility(DrawerVisibility.Dismissed, 2))
        assertEquals(DrawerVisibility.Dismissed, resolveDrawerVisibility(DrawerVisibility.Dismissed, 0))
        assertTrue(drawerHidden(DrawerVisibility.Dismissed, 0, 0, loading = false))
        assertTrue(drawerHidden(DrawerVisibility.Minimized, 0, 0, loading = false))
        assertFalse(drawerHidden(DrawerVisibility.Open, 0, 0, loading = true))
        assertFalse(drawerHidden(DrawerVisibility.Open, 1, 3, loading = false))
    }

    // ── Drafts + bytes ──────────────────────────────────────────────────────────────
    @Test
    fun sortedDraftsMostRecentFirst() {
        val drafts = listOf(DraftSummary("a", 100L), DraftSummary("b", null), DraftSummary("c", 300L))
        assertEquals(listOf("c", "a", "b"), sortedDrafts(drafts).map { it.label })
    }

    @Test
    fun formatBytesHumanizes() {
        assertNull(formatBytes(null))
        assertNull(formatBytes(-1L))
        assertEquals("512 B", formatBytes(512L))
        assertEquals("2.0 KB", formatBytes(2_048L))
        assertEquals("2.3 MB", formatBytes(2_400_000L))
    }

    // ── Tone glyphs ────────────────────────────────────────────────────────────────
    @Test
    fun toneGlyphResolvesForEveryTone() {
        assertEquals(4, Tone.entries.size)
        Tone.entries.forEach { tone ->
            assertEquals("each tone maps to a non-blank glyph", true, toneGlyph(tone).name.isNotEmpty())
        }
    }
}
