package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RecentlyUnlockedAchievements widget's pure logic — the achievements decode
 * out of the raw `/analytics/lifetime` JSON, the `unlocked && unlocked_at` filter, the `unlocked_at desc`
 * sort, the footprint slice (web `isWide ? 5 : 3`), the per-badge fields + `viewNamed` content description,
 * and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RecentlyUnlockedAchievements.tsx).
 */
class RecentlyUnlockedProjectionTest {
    private val strings =
        RecentlyUnlockedStrings(
            title = "Recently Unlocked",
            disabled = "Recently unlocked achievements are hidden in your settings.",
            noneYet = "Drive, charge, and explore",
            unlocked = "\u2713 Unlocked",
            viewNamed = { name -> "View achievement: $name" },
        )

    private fun project(
        json: JsonElement?,
        size: RecentlyUnlockedSize = RecentlyUnlockedAchievementsRegistration.defaultSize,
    ): RecentlyUnlockedDisplay = RecentlyUnlockedProjection.project(parseAchievements(json), size, strings)

    @Test
    fun parseHandlesNonObjectMissingKeyAndArray() {
        assertTrue(parseAchievements(null).isEmpty())
        assertTrue(parseAchievements(JsonPrimitive("nope")).isEmpty())
        assertTrue(parseAchievements(buildJsonObject { put("other", 1) }).isEmpty())
        assertEquals(1, parseAchievements(lifetimeJson(ach("a", "A", unlocked = true, unlockedAt = NEW))).size)
    }

    @Test
    fun filterExcludesLockedAndUndatedAchievements() {
        val json =
            lifetimeJson(
                ach("locked", "Locked", unlocked = false, unlockedAt = NEW),
                ach("nodate", "No Date", unlocked = true, unlockedAt = null),
                ach("blank", "Blank", unlocked = true, unlockedAt = "   "),
                ach("ok", "Unlocked One", unlocked = true, unlockedAt = NEW),
            )
        val display = project(json)
        assertTrue(display.hasItems)
        assertEquals(1, display.badges.size)
        assertEquals("ok", display.badges.single().id)
    }

    @Test
    fun sortsNewestFirstByUnlockedAt() {
        val json =
            lifetimeJson(
                ach("old", "Old", unlocked = true, unlockedAt = OLD),
                ach("new", "New", unlocked = true, unlockedAt = NEW),
                ach("mid", "Mid", unlocked = true, unlockedAt = MID),
            )
        assertEquals(listOf("new", "mid", "old"), project(json).badges.map { it.id })
    }

    @Test
    fun capsAtThreeWhenNarrowAndFiveWhenWide() {
        val json =
            lifetimeJson(
                ach("a", "A", unlocked = true, unlockedAt = "2024-01-01T00:00:00Z"),
                ach("b", "B", unlocked = true, unlockedAt = "2024-02-01T00:00:00Z"),
                ach("c", "C", unlocked = true, unlockedAt = "2024-03-01T00:00:00Z"),
                ach("d", "D", unlocked = true, unlockedAt = "2024-04-01T00:00:00Z"),
                ach("e", "E", unlocked = true, unlockedAt = "2024-05-01T00:00:00Z"),
                ach("f", "F", unlocked = true, unlockedAt = "2024-06-01T00:00:00Z"),
            )
        assertEquals(3, project(json, RecentlyUnlockedSize(cols = 2, rows = 2)).badges.size)
        assertEquals(5, project(json, RecentlyUnlockedSize(cols = 3, rows = 2)).badges.size)
        assertEquals(5, project(json, RecentlyUnlockedSize(cols = 4, rows = 4)).badges.size)
        // Newest five, narrowed to three: f, e, d are the most recent.
        assertEquals(listOf("f", "e", "d"), project(json, RecentlyUnlockedSize(cols = 2, rows = 2)).badges.map { it.id })
    }

    @Test
    fun badgeCarriesIconNameStatusAndViewNamedDescription() {
        val json = lifetimeJson(ach("first-drive", "First Drive", unlocked = true, unlockedAt = NEW, icon = "\uD83C\uDFC1"))
        val badge = project(json).badges.single()
        assertEquals("first-drive", badge.id)
        assertEquals("\uD83C\uDFC1", badge.icon)
        assertEquals("First Drive", badge.name)
        assertEquals("\u2713 Unlocked", badge.unlockedLabel)
        assertEquals("View achievement: First Drive", badge.contentDescription)
    }

    @Test
    fun emptyWhenNoUnlocksProjectsNoneYetMessage() {
        val json = lifetimeJson(ach("locked", "Locked", unlocked = false, unlockedAt = null))
        val display = project(json)
        assertFalse(display.hasItems)
        assertTrue(display.badges.isEmpty())
        assertEquals("Drive, charge, and explore", display.emptyMessage)
    }

    @Test
    fun hasRecentUnlocksMatchesTheFilter() {
        assertFalse(hasRecentUnlocks(parseAchievements(lifetimeJson(ach("l", "L", unlocked = false, unlockedAt = NEW)))))
        assertFalse(hasRecentUnlocks(parseAchievements(lifetimeJson(ach("n", "N", unlocked = true, unlockedAt = null)))))
        assertTrue(hasRecentUnlocks(parseAchievements(lifetimeJson(ach("u", "U", unlocked = true, unlockedAt = NEW)))))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("recently-unlocked-achievements", RecentlyUnlockedAchievementsRegistration.ID)
        assertEquals("analytics", RecentlyUnlockedAchievementsRegistration.CATEGORY)
        assertEquals("RecentlyUnlockedAchievements", RecentlyUnlockedAchievementsRegistration.SLUG)
        assertEquals(RecentlyUnlockedSize(cols = 2, rows = 2), RecentlyUnlockedAchievementsRegistration.defaultSize)
        assertEquals(RecentlyUnlockedSize(cols = 1, rows = 2), RecentlyUnlockedAchievementsRegistration.minSize)
        assertEquals(RecentlyUnlockedSize(cols = 4, rows = 4), RecentlyUnlockedAchievementsRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(RecentlyUnlockedSize(cols = 4, rows = 4), RecentlyUnlockedAchievementsRegistration.clamp(RecentlyUnlockedSize(9, 9)))
        assertEquals(RecentlyUnlockedSize(cols = 1, rows = 2), RecentlyUnlockedAchievementsRegistration.clamp(RecentlyUnlockedSize(0, 0)))
        assertTrue(RecentlyUnlockedAchievementsRegistration.isWithinBounds(RecentlyUnlockedSize(2, 2)))
        assertFalse(RecentlyUnlockedAchievementsRegistration.isWithinBounds(RecentlyUnlockedSize(5, 2)))
    }

    @Test
    fun sizeWidthBranchFollowsColumnCount() {
        assertFalse(RecentlyUnlockedSize(cols = 2, rows = 4).isWide)
        assertEquals(3, RecentlyUnlockedSize(cols = 2, rows = 4).limit)
        assertTrue(RecentlyUnlockedSize(cols = 3, rows = 4).isWide)
        assertEquals(5, RecentlyUnlockedSize(cols = 3, rows = 4).limit)
        assertEquals(5, RecentlyUnlockedSize(cols = 4, rows = 4).limit)
    }

    private data class Ach(
        val id: String,
        val name: String,
        val unlocked: Boolean,
        val unlockedAt: String?,
        val icon: String = "\uD83C\uDFC6",
    )

    private fun ach(
        id: String,
        name: String,
        unlocked: Boolean,
        unlockedAt: String?,
        icon: String = "\uD83C\uDFC6",
    ): Ach = Ach(id, name, unlocked, unlockedAt, icon)

    private fun lifetimeJson(vararg achievements: Ach): JsonObject =
        buildJsonObject {
            putJsonArray("achievements") {
                achievements.forEach { a ->
                    addJsonObject {
                        put("id", a.id)
                        put("name", a.name)
                        put("icon", a.icon)
                        put("unlocked", a.unlocked)
                        if (a.unlockedAt != null) put("unlocked_at", a.unlockedAt)
                        put("progress", 1.0)
                        put("target", 1.0)
                        put("current", 1.0)
                    }
                }
            }
        }

    private companion object {
        const val OLD = "2024-01-15T10:00:00Z"
        const val MID = "2024-02-10T10:00:00Z"
        const val NEW = "2024-03-20T10:00:00Z"
    }
}
