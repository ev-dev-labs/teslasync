package io.teslasync.android.featureviews.achievementbadge

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AchievementBadge's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/analytics/components/AchievementBadge.tsx): the
 * `size = 'md'` default + typed union ([AchievementBadgeSize.fromRaw]), the `Math.round(progress * 100)`
 * percentage, the `!unlocked && progress >= 0.8` near-complete emphasis, and the unlocked/locked branch
 * (gold status + no ring when earned, gray ring + `{pct}%` while in progress). Because the surface is
 * purely presentational each [AchievementBadgeDisplay] is exactly what the thin composable renders, so
 * these assertions double as the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class AchievementBadgeProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun achievement(
        unlocked: Boolean,
        progress: Double,
    ) = AchievementData(
        id = "a1",
        name = "First Drive",
        description = "Complete your first recorded drive",
        icon = "🏁",
        unlocked = unlocked,
        progress = progress,
        target = 1.0,
        current = if (unlocked) 1.0 else progress,
    )

    // ── Size classification (web `size` typed union, default 'md') ─────────────────

    @Test
    fun fromRawMapsEveryKnownSizeKey() {
        assertEquals(AchievementBadgeSize.Sm, AchievementBadgeSize.fromRaw("sm"))
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw("md"))
        assertEquals(AchievementBadgeSize.Lg, AchievementBadgeSize.fromRaw("lg"))
    }

    @Test
    fun fromRawFoldsAbsentOrUnknownSizeToMedium() {
        // Web parity: the `size = 'md'` default applies for a missing prop, and the typed union never
        // produces an out-of-set value, so anything unrecognised folds to the medium default.
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw(null))
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw(""))
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw("medium"))
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw("XL"))
    }

    @Test
    fun fromRawIsCaseSensitiveLikeTheWebUnion() {
        // The web keys are exact lowercase; a differently-cased value misses and folds to the default.
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw("SM"))
        assertEquals(AchievementBadgeSize.Md, AchievementBadgeSize.fromRaw("Lg"))
    }

    // ── Percentage (web `Math.round(progress * 100)`) ──────────────────────────────

    @Test
    fun percentRoundsProgressToTheNearestWholePercent() {
        assertEquals(0, AchievementBadgeProjection.percent(0.0))
        assertEquals(10, AchievementBadgeProjection.percent(0.1))
        assertEquals(45, AchievementBadgeProjection.percent(0.45))
        assertEquals(46, AchievementBadgeProjection.percent(0.456))
        assertEquals(80, AchievementBadgeProjection.percent(0.8))
        assertEquals(100, AchievementBadgeProjection.percent(1.0))
    }

    @Test
    fun percentRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        // 0.125 * 100 = 12.5 -> 13; 0.875 * 100 = 87.5 -> 88 (JS Math.round + Kotlin roundToInt agree).
        assertEquals(13, AchievementBadgeProjection.percent(0.125))
        assertEquals(88, AchievementBadgeProjection.percent(0.875))
    }

    // ── Projection branches ────────────────────────────────────────────────────────

    @Test
    fun unlockedAchievementHidesTheRingAndIsNeverNearComplete() {
        val display = AchievementBadgeProjection.project(achievement(unlocked = true, progress = 1.0))

        assertTrue(display.unlocked)
        // Web renders the ring only when `!unlocked`, and `isNearComplete` requires `!unlocked`.
        assertFalse(display.showProgressRing)
        assertFalse(display.isNearComplete)
        assertEquals(100, display.percent)
        assertEquals("First Drive", display.name)
        assertEquals("🏁", display.icon)
    }

    @Test
    fun inProgressAchievementShowsTheRingAndProjectsItsPercent() {
        val display = AchievementBadgeProjection.project(achievement(unlocked = false, progress = 0.45))

        assertFalse(display.unlocked)
        assertTrue(display.showProgressRing)
        assertFalse(display.isNearComplete)
        assertEquals(45, display.percent)
    }

    @Test
    fun nearCompleteIsInclusiveAtTheEightyPercentThreshold() {
        // Web `progress >= 0.8`.
        assertTrue(AchievementBadgeProjection.project(achievement(unlocked = false, progress = 0.8)).isNearComplete)
        assertFalse(AchievementBadgeProjection.project(achievement(unlocked = false, progress = 0.799)).isNearComplete)
        val high = AchievementBadgeProjection.project(achievement(unlocked = false, progress = 0.9))
        assertTrue(high.isNearComplete)
        assertEquals(90, high.percent)
    }

    @Test
    fun unlockedAchievementIsNotNearCompleteEvenAboveTheThreshold() {
        // `isNearComplete` is `!unlocked && progress >= 0.8`: an earned achievement is celebrated as
        // unlocked, never "near complete".
        val display = AchievementBadgeProjection.project(achievement(unlocked = true, progress = 0.95))
        assertFalse(display.isNearComplete)
    }

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        // The data-adapter path: the owning page caches the raw API response, whose achievement rows carry
        // more columns than this surface reads (and `unlocked_at` is snake_case on the wire). Decoding +
        // projecting must yield the rendered view.
        val json =
            """
            {
              "id": "supercharged",
              "name": "Supercharged",
              "description": "Use 50 Supercharger sessions",
              "icon": "⚡",
              "unlocked": false,
              "unlocked_at": null,
              "progress": 0.9,
              "target": 50,
              "current": 45,
              "category": "charging",
              "rarity": "rare"
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<AchievementData>(json)

        assertEquals("Supercharged", decoded.name)
        assertEquals(null, decoded.unlockedAt)

        val display = AchievementBadgeProjection.project(decoded)
        assertFalse(display.unlocked)
        assertTrue(display.showProgressRing)
        assertTrue(display.isNearComplete)
        assertEquals(90, display.percent)
        assertEquals("⚡", display.icon)
    }

    @Test
    fun decodesTheUnlockedTimestampWireField() {
        val json =
            """{ "id": "x", "name": "X", "unlocked": true, "unlocked_at": "2026-01-01T00:00:00Z", "progress": 1 }"""
        val decoded = lenientJson.decodeFromString<AchievementData>(json)

        assertEquals("2026-01-01T00:00:00Z", decoded.unlockedAt)
        assertTrue(AchievementBadgeProjection.project(decoded).unlocked)
    }
}
