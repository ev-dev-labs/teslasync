// Off-device unit tests for the AchievementUnlockListener pure model: the de-dup/bound/dismiss queue reducer
// (web `useAchievementUnlocks.setRecent`), the toast projection + icon fallback, the three-branch surface
// classifier (disabled / idle / celebrating), the opt-in chime decision, and the merged a11y announcement.
// These cover every reproduced web state + the TalkBack label off-device; run by the :android:testReleaseUnitTest
// gate. No Compose, no Android, no HTTP.

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class AchievementUnlockListenerModelTest {
    // ── queue reducer (web setRecent) ───────────────────────────────────────────────
    @Test
    fun enqueuePrependsNewestFirst() {
        val queue = enqueueUnlock(enqueueUnlock(emptyList(), unlock("a")), unlock("b"))
        assertEquals(listOf("b", "a"), queue.map { it.achievement.id })
    }

    @Test
    fun enqueueDedupesByIdAndReturnsSameInstance() {
        val first = enqueueUnlock(emptyList(), unlock("a"))
        val second = enqueueUnlock(first, unlock("a", name = "renamed"))
        assertSame(first, second)
        assertEquals(1, second.size)
        // The de-duped re-broadcast must NOT overwrite the original entry (name stays "Name", not "renamed").
        assertEquals("Name", second.first().achievement.name)
    }

    @Test
    fun enqueueBoundsToMaxRecent() {
        var queue = emptyList<AchievementUnlock>()
        repeat(MAX_RECENT_UNLOCKS + 10) { i -> queue = enqueueUnlock(queue, unlock("a$i")) }
        assertEquals(MAX_RECENT_UNLOCKS, queue.size)
        // Newest-first + bounded: the most recent insert is at the head, the oldest are dropped.
        assertEquals("a${MAX_RECENT_UNLOCKS + 9}", queue.first().achievement.id)
    }

    @Test
    fun dismissRemovesById() {
        val queue = listOf(unlock("a"), unlock("b"))
        assertEquals(listOf("b"), dismissUnlock(queue, "a").map { it.achievement.id })
    }

    @Test
    fun dismissIsNoopWhenAbsent() {
        val queue = listOf(unlock("a"))
        assertEquals(queue, dismissUnlock(queue, "missing"))
    }

    // ── toast projection ─────────────────────────────────────────────────────────────
    @Test
    fun toToastMapsRenderedFields() {
        val toast = unlock("a", name = "Road Warrior", description = "10,000 km", icon = "🏆").toToast()
        assertEquals(AchievementToast("a", "🏆", "Road Warrior", "10,000 km"), toast)
    }

    @Test
    fun toToastFallsBackOnBlankIcon() {
        assertEquals(FALLBACK_ACHIEVEMENT_ICON, unlock("a", icon = "  ").toToast().icon)
    }

    // ── classifier (web's three branches) ────────────────────────────────────────────
    @Test
    fun classifyDisabledWhenToastsOff() {
        val state =
            AchievementListenerState(
                prefs = AchievementCelebrationPrefs(showToasts = false),
                queue = listOf(unlock("a")),
            )
        assertEquals(ListenerSurface.Disabled, classifyListener(state))
    }

    @Test
    fun classifyIdleWhenQueueEmpty() {
        assertEquals(ListenerSurface.Idle, classifyListener(AchievementListenerState()))
    }

    @Test
    fun classifyCelebratingProjectsNewestFirst() {
        val state = AchievementListenerState(queue = listOf(unlock("b"), unlock("a")))
        val surface = classifyListener(state)
        assertTrue(surface is ListenerSurface.Celebrating)
        assertEquals(
            listOf("b", "a"),
            (surface as ListenerSurface.Celebrating).toasts.map { it.achievementId },
        )
    }

    // ── chime decision (web playSound + recent.length growth) ────────────────────────
    @Test
    fun shouldChimeOnlyWhenSoundOnAndQueueGrew() {
        val soundOn = AchievementCelebrationPrefs(playSound = true)
        val soundOff = AchievementCelebrationPrefs(playSound = false)
        assertTrue(shouldChime(soundOn, previousCount = 0, nextCount = 1))
        assertFalse(shouldChime(soundOn, previousCount = 1, nextCount = 1))
        assertFalse(shouldChime(soundOff, previousCount = 0, nextCount = 1))
    }

    // ── accessibility announcement ───────────────────────────────────────────────────
    @Test
    fun achievementToastLabelComposesParts() {
        assertEquals(
            "Achievement Unlocked: Road Warrior. Drove 10,000 km",
            achievementToastLabel("Achievement Unlocked", "Road Warrior", "Drove 10,000 km"),
        )
    }

    private fun unlock(
        id: String,
        name: String = "Name",
        description: String = "Description",
        icon: String = "🏆",
    ): AchievementUnlock =
        AchievementUnlock(
            vehicleId = 1L,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement = Achievement(id = id, name = name, description = description, icon = icon),
        )
}
