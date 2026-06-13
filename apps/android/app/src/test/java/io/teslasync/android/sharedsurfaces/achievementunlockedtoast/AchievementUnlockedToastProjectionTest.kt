// Off-device verification of the AchievementUnlockedToast pure adapter — the native mirror of every decision
// the web stack makes between the `useAchievementUnlocks` queue + the live wire and the rendered toasts
// (web/src/components/feedback/AchievementUnlockedToast.tsx). Because the composable is a thin render layer
// over [AchievementUnlockedToastProjection], the per-branch assertions here double as the surface's state
// "snapshot": content / empty / loading / error plus the stale + offline freshness flags. Runs in the
// :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.presentation.achievementunlocks.AchievementUnlockedEvent
import io.teslasync.shared.core.presentation.achievementunlocks.LifetimeAchievement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AchievementUnlockedToastProjectionTest {
    private fun event(
        id: String,
        name: String = "First Drive",
        description: String = "Complete your first recorded drive",
        icon: String = "\uD83C\uDFC1",
    ): AchievementUnlockedEvent =
        AchievementUnlockedEvent(
            vehicleId = 0,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement =
                LifetimeAchievement(
                    id = id,
                    name = name,
                    description = description,
                    icon = icon,
                    unlocked = true,
                    unlockedAt = "2026-01-01T00:00:00Z",
                    progress = 1.0,
                    target = 1.0,
                    current = 1.0,
                ),
        )

    private fun project(
        unlocks: List<AchievementUnlockedEvent>,
        connection: LiveConnectionStatus,
        stale: Boolean = false,
        lastMessageAtMillis: Long? = null,
    ) = AchievementUnlockedToastProjection.project(unlocks, connection, stale, lastMessageAtMillis)

    // ── Cold-start seed ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun loadingSeedIsAColdNeverConnectedSurfaceWithNoToasts() {
        val feed = AchievementUnlockedToastProjection.loading()
        assertEquals(AchievementToastPhase.Loading, feed.phase)
        assertTrue(feed.toasts.isEmpty())
        assertEquals(LiveConnectionStatus.Unknown, feed.connection)
        assertFalse(feed.stale)
        assertFalse(feed.offline)
    }

    // ── Empty-queue branches: the wire decides the chrome ────────────────────────────────────────────

    @Test
    fun liveWireWithEmptyQueueIsEmpty() {
        assertEquals(AchievementToastPhase.Empty, project(emptyList(), LiveConnectionStatus.Connected).phase)
    }

    @Test
    fun downWireWithEmptyQueueIsError() {
        assertEquals(AchievementToastPhase.Error, project(emptyList(), LiveConnectionStatus.Disconnected).phase)
    }

    @Test
    fun reconnectingWireWithEmptyQueueIsLoading() {
        assertEquals(AchievementToastPhase.Loading, project(emptyList(), LiveConnectionStatus.Reconnecting).phase)
    }

    @Test
    fun unknownWireWithEmptyQueueIsLoading() {
        assertEquals(AchievementToastPhase.Loading, project(emptyList(), LiveConnectionStatus.Unknown).phase)
    }

    // ── Populated queue is always content, regardless of wire ────────────────────────────────────────

    @Test
    fun aQueuedUnlockIsContentOnALiveWire() {
        val feed = project(listOf(event("a")), LiveConnectionStatus.Connected)
        assertEquals(AchievementToastPhase.Content, feed.phase)
        assertEquals(1, feed.toasts.size)
        assertFalse(feed.stale)
        assertFalse(feed.offline)
    }

    @Test
    fun queuedUnlocksStayContentEvenWhenTheWireIsDown() {
        val feed = project(listOf(event("a"), event("b")), LiveConnectionStatus.Disconnected)
        assertEquals(AchievementToastPhase.Content, feed.phase)
        assertEquals(2, feed.toasts.size)
        assertTrue("a down wire with cached toasts is the offline surface", feed.offline)
    }

    @Test
    fun reconnectingWithCachedToastsIsOfflineAndRefreshing() {
        val feed = project(listOf(event("a")), LiveConnectionStatus.Reconnecting)
        assertEquals(AchievementToastPhase.Content, feed.phase)
        assertTrue(feed.offline)
        assertTrue(feed.refreshing)
        assertTrue(feed.showFreshnessChip)
    }

    // ── Stale window ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun staleAppliesOnlyWhileCachedToastsShow() {
        val withToasts = project(listOf(event("a")), LiveConnectionStatus.Connected, stale = true)
        assertTrue(withToasts.stale)
        assertFalse("a stale-but-live wire with cached toasts is not offline", withToasts.offline)
        assertTrue(withToasts.showFreshnessChip)

        val empty = project(emptyList(), LiveConnectionStatus.Connected, stale = true)
        assertEquals(AchievementToastPhase.Empty, empty.phase)
        assertFalse("stale has no meaning with no content to flag", empty.stale)
    }

    // ── Offline flag is gated on content ─────────────────────────────────────────────────────────────

    @Test
    fun offlineIsNeverSetWithoutContent() {
        assertFalse(project(emptyList(), LiveConnectionStatus.Disconnected).offline)
        assertFalse(project(emptyList(), LiveConnectionStatus.Reconnecting).offline)
    }

    // ── Toast mapping carries the achievement payload + last-message stamp ────────────────────────────

    @Test
    fun toastsCarryTheAchievementPayloadNewestFirst() {
        val feed =
            project(
                listOf(event("a", name = "Road Tripper"), event("b")),
                LiveConnectionStatus.Connected,
                lastMessageAtMillis = 1_700_000_000_000L,
            )
        val first = feed.toasts.first()
        assertEquals("a", first.id)
        assertEquals("a", first.achievement.id)
        assertEquals("Road Tripper", first.achievement.name)
        assertTrue(first.achievement.unlocked)
        assertEquals(1_700_000_000_000L, feed.lastMessageAtMillis)
    }
}
