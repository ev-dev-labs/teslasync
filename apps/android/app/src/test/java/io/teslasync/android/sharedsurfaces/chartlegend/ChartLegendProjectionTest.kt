package io.teslasync.android.sharedsurfaces.chartlegend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChartLegend's pure adapter — the native mirror of every decision the web
 * `ChartLegend` makes between its resolved toggle source and the rendered legend entries
 * (web/src/components/charts/ChartLegend.tsx): the `pickKey` series-key resolution, the per-entry
 * dim/interactive projection (`resolved?.isHidden(key) ?? false`), and the `toggle` add/remove math.
 * Because the composable is a thin render layer over [ChartLegendProjection], the per-branch assertions
 * here double as the surface's state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class ChartLegendProjectionTest {
    private val series =
        listOf(
            LegendSeries(key = "speed", label = "Speed", colorArgb = 0xFF2DD4BFL),
            LegendSeries(key = "power", label = "Power", colorArgb = 0xFFF59E0BL),
            LegendSeries(key = "range", label = "Range", colorArgb = 0xFF818CF8L),
        )

    // ── project: order, identity, color carried through ─────────────────────────────────────────────

    @Test
    fun projectPreservesOrderLabelsAndColors() {
        val items = ChartLegendProjection.project(series, hidden = emptySet(), interactive = true)
        assertEquals(listOf("speed", "power", "range"), items.map { it.key })
        assertEquals(listOf("Speed", "Power", "Range"), items.map { it.label })
        assertEquals(listOf(0xFF2DD4BFL, 0xFFF59E0BL, 0xFF818CF8L), items.map { it.colorArgb })
    }

    @Test
    fun projectOfEmptySeriesIsEmpty() {
        assertTrue(ChartLegendProjection.project(emptyList(), hidden = setOf("speed"), interactive = true).isEmpty())
    }

    // ── project: interactive legend dims only the hidden keys (web `isHidden`) ───────────────────────

    @Test
    fun interactiveProjectionMarksHiddenKeysOnly() {
        val items = ChartLegendProjection.project(series, hidden = setOf("power"), interactive = true)
        val byKey = items.associateBy { it.key }
        assertFalse("a shown series is not hidden", byKey.getValue("speed").hidden)
        assertTrue("a hidden series is dimmed", byKey.getValue("power").hidden)
        assertFalse(byKey.getValue("range").hidden)
        assertTrue("interactive legend entries are tappable", items.all { it.interactive })
    }

    // ── project: passive legend never dims, never toggles (web "no resolved source" branch) ──────────

    @Test
    fun passiveProjectionNeverHidesEvenWhenKeyInHiddenSet() {
        // Web: with no resolved toggle source `isHidden` short-circuits to false, so a passive legend
        // shows every series at full opacity regardless of any stored hidden set.
        val items = ChartLegendProjection.project(series, hidden = setOf("power", "speed"), interactive = false)
        assertTrue("no entry dims in a passive legend", items.none { it.hidden })
        assertTrue("no entry is tappable in a passive legend", items.none { it.interactive })
    }

    // ── toggleHidden: add when absent, remove when present (web `toggle`) ────────────────────────────

    @Test
    fun toggleAddsAnAbsentKey() {
        assertEquals(setOf("speed"), ChartLegendProjection.toggleHidden(emptySet(), "speed"))
    }

    @Test
    fun toggleRemovesAPresentKey() {
        assertEquals(emptySet<String>(), ChartLegendProjection.toggleHidden(setOf("speed"), "speed"))
    }

    @Test
    fun toggleLeavesOtherKeysUntouched() {
        assertEquals(setOf("power"), ChartLegendProjection.toggleHidden(setOf("speed", "power"), "speed"))
    }

    @Test
    fun toggleIsItsOwnInverse() {
        val once = ChartLegendProjection.toggleHidden(setOf("range"), "speed")
        val twice = ChartLegendProjection.toggleHidden(once, "speed")
        assertEquals(setOf("range"), twice)
    }

    // ── pickSeriesKey: web `pickKey` precedence (dataKey → payload.dataKey → fallback value) ──────────

    @Test
    fun pickSeriesKeyPrefersTheTopLevelDataKey() {
        assertEquals("speed", pickSeriesKey(dataKey = "speed", payloadDataKey = "inner", fallback = "Speed"))
    }

    @Test
    fun pickSeriesKeyFallsBackToTheNestedPayloadDataKey() {
        assertEquals("inner", pickSeriesKey(dataKey = null, payloadDataKey = "inner", fallback = "Speed"))
    }

    @Test
    fun pickSeriesKeyFallsBackToTheValueWhenNoStableKey() {
        // Web: a function dataKey (a computed accessor) has no stable identity — modelled as null — so the
        // legend value is used as the last resort.
        assertEquals("Speed", pickSeriesKey(dataKey = null, payloadDataKey = null, fallback = "Speed"))
    }
}
