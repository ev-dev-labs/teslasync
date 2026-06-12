package io.teslasync.android.featureviews.environmentslide

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the EnvironmentSlide's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/review/EnvironmentSlide.tsx): the
 * `Math.round(co2_offset_kg / 21)` equivalent-tree count, the `Math.min(treesPlanted, 30)` grid cap, and the
 * `treesPlanted > 30` overflow chip. Because the surface is purely presentational each
 * [EnvironmentSlideDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class EnvironmentSlideProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    // ── treesPlanted (web `Math.round(co2_offset_kg / 21)`) ────────────────────────

    @Test
    fun treesPlantedRoundsCo2OverTwentyOneToTheNearestWholeTree() {
        assertEquals(0, EnvironmentSlideProjection.treesPlanted(0.0))
        assertEquals(1, EnvironmentSlideProjection.treesPlanted(21.0))
        assertEquals(2, EnvironmentSlideProjection.treesPlanted(42.0))
        assertEquals(24, EnvironmentSlideProjection.treesPlanted(504.0))
        assertEquals(50, EnvironmentSlideProjection.treesPlanted(1050.0))
    }

    @Test
    fun treesPlantedRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        // 10.5 / 21 = 0.5 -> 1; 31.5 / 21 = 1.5 -> 2 (JS Math.round + Kotlin roundToInt agree on ties).
        assertEquals(1, EnvironmentSlideProjection.treesPlanted(10.5))
        assertEquals(2, EnvironmentSlideProjection.treesPlanted(31.5))
    }

    // ── Projection branches ────────────────────────────────────────────────────────

    @Test
    fun belowCapShowsEveryTreeWithNoOverflow() {
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = 504.0))

        assertEquals(504.0, display.co2OffsetKg, 0.0)
        assertEquals(24, display.treesPlanted)
        assertEquals(24, display.treeIconCount)
        assertFalse(display.hasOverflow)
        assertEquals(0, display.overflowCount)
    }

    @Test
    fun exactlyThirtyTreesFillsTheGridWithNoOverflow() {
        // 630 / 21 = 30: the grid is full but the cap (`treesPlanted > 30`) is not yet exceeded.
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = 630.0))

        assertEquals(30, display.treesPlanted)
        assertEquals(EnvironmentSlideProjection.MAX_TREE_ICONS, display.treeIconCount)
        assertFalse(display.hasOverflow)
        assertEquals(0, display.overflowCount)
    }

    @Test
    fun thirtyOneTreesCapsTheGridAndOverflowsByOne() {
        // 651 / 21 = 31: the grid stays at 30 glyphs and the "+1 more" chip appears.
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = 651.0))

        assertEquals(31, display.treesPlanted)
        assertEquals(30, display.treeIconCount)
        assertTrue(display.hasOverflow)
        assertEquals(1, display.overflowCount)
    }

    @Test
    fun farAboveCapReportsTheFullSurplus() {
        // 1050 / 21 = 50: 30 glyphs + "+20 more".
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = 1050.0))

        assertEquals(50, display.treesPlanted)
        assertEquals(30, display.treeIconCount)
        assertTrue(display.hasOverflow)
        assertEquals(20, display.overflowCount)
    }

    @Test
    fun zeroOffsetProjectsTheFriendlyNoImpactSurface() {
        // The empty/no-impact case still renders (0 kg hero + empty grid) — never a blank box.
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = 0.0))

        assertEquals(0.0, display.co2OffsetKg, 0.0)
        assertEquals(0, display.treesPlanted)
        assertEquals(0, display.treeIconCount)
        assertFalse(display.hasOverflow)
        assertEquals(0, display.overflowCount)
    }

    @Test
    fun negativeOffsetFloorsTheGridAtZeroIcons() {
        // Defensive parity with JS `Array.from({ length: <negative> })` -> empty array (ToLength clamps to 0).
        val display = EnvironmentSlideProjection.project(EnvironmentSlideData(co2OffsetKg = -42.0))

        assertEquals(-2, display.treesPlanted)
        assertEquals(0, display.treeIconCount)
        assertFalse(display.hasOverflow)
        assertEquals(0, display.overflowCount)
    }

    // ── Decode (the data-adapter path: cached API JSON -> projection) ──────────────

    @Test
    fun projectsStraightOffTheCachedYearReviewJsonIgnoringUnknownColumns() {
        // The owning deck caches the raw /analytics/year-review response, which carries far more columns than
        // this slide reads. Decoding the `co2_offset_kg` slice + projecting must yield the rendered view.
        val json =
            """
            {
              "year": 2026,
              "total_drives": 320,
              "total_distance_km": 18450.5,
              "total_energy_kwh": 3720.2,
              "co2_offset_kg": 504.0,
              "fastest_speed_kmh": 168.0,
              "monthly_stats": []
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<EnvironmentSlideData>(json)

        assertEquals(504.0, decoded.co2OffsetKg, 0.0)

        val display = EnvironmentSlideProjection.project(decoded)
        assertEquals(24, display.treesPlanted)
        assertEquals(24, display.treeIconCount)
        assertFalse(display.hasOverflow)
    }

    @Test
    fun absentCo2FieldDecodesToZeroOffset() {
        // A partial/still-loading payload without `co2_offset_kg` decodes via the field default (web `?? 0`).
        val decoded = lenientJson.decodeFromString<EnvironmentSlideData>("""{ "year": 2026 }""")

        assertEquals(0.0, decoded.co2OffsetKg, 0.0)
        assertEquals(0, EnvironmentSlideProjection.project(decoded).treeIconCount)
    }
}
