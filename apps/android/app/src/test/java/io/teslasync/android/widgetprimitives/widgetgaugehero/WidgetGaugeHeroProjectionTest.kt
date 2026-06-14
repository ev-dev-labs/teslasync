package io.teslasync.android.widgetprimitives.widgetgaugehero

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetGaugeHero primitive's pure logic — the native mirror of every derivation
 * the web component makes before it paints (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx and the
 * `RadialGauge` it hands the gauge to): the `compact ? 70 : 100` size, the `!compact && stats.length > 0` stats
 * guard, the `!compact` children guard, the `Math.max(0, Math.min(value, max))` clamp, and the
 * `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())` decimal rule. Because the composable is a
 * thin render layer over [WidgetGaugeHeroProjection], these per-branch assertions double as the surface's
 * per-state snapshot; the stat-text checks additionally verify each cell stays TalkBack-readable. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetGaugeHeroProjectionTest {
    // ── Surface contract constants ────────────────────────────────────────────────

    @Test
    fun sizeAndPrecisionConstantsMatchTheWebSource() {
        assertEquals(70, WidgetGaugeHeroProjection.COMPACT_GAUGE_SIZE_DP)
        assertEquals(100, WidgetGaugeHeroProjection.STANDARD_GAUGE_SIZE_DP)
        // Web getGlobalPrecision() default (_globalPrecision = 2 in web/src/lib/numberFormat.ts).
        assertEquals(2, WidgetGaugeHeroProjection.FALLBACK_PRECISION)
    }

    // ── project(): the three prop-driven branches ─────────────────────────────────

    @Test
    fun standardWithStatsShowsTheGaugeStatsAndChildrenAtFullSize() {
        val layout = WidgetGaugeHeroProjection.project(compact = false, statCount = 3)

        assertEquals(100, layout.gaugeSizeDp)
        assertTrue("standard + non-empty stats shows the stats row", layout.showStats)
        assertTrue("standard shows the children slot", layout.showContent)
    }

    @Test
    fun standardWithoutStatsHidesOnlyTheStatsRow() {
        // Web `!compact && stats?.length > 0`: standard but no stats hides the row; children still render.
        val layout = WidgetGaugeHeroProjection.project(compact = false, statCount = 0)

        assertEquals(100, layout.gaugeSizeDp)
        assertFalse("an empty stats list hides the row", layout.showStats)
        assertTrue("children still render at the standard size", layout.showContent)
    }

    @Test
    fun compactNeverGrowsAndSuppressesStatsAndChildren() {
        // Web `compact`: size 70, and BOTH the stats row and the children slot are gated behind `!compact`.
        val withStats = WidgetGaugeHeroProjection.project(compact = true, statCount = 5)

        assertEquals(70, withStats.gaugeSizeDp)
        assertFalse("compact suppresses the stats row even with stats present", withStats.showStats)
        assertFalse("compact suppresses the children slot", withStats.showContent)
    }

    @Test
    fun aNegativeStatCountIsTreatedAsNoStats() {
        val layout = WidgetGaugeHeroProjection.project(compact = false, statCount = -1)
        assertFalse(layout.showStats)
    }

    // ── clampGaugeValue(): web RadialGauge `Math.max(0, Math.min(value, max))` ─────

    @Test
    fun anInRangeValuePassesThroughUnchanged() {
        assertEquals(72.0, WidgetGaugeHeroProjection.clampGaugeValue(72.0, 100.0), 0.0)
    }

    @Test
    fun anOverMaxValuePinsToTheCeiling() {
        assertEquals(100.0, WidgetGaugeHeroProjection.clampGaugeValue(130.0, 100.0), 0.0)
    }

    @Test
    fun aNegativeValuePinsToZero() {
        assertEquals(0.0, WidgetGaugeHeroProjection.clampGaugeValue(-5.0, 100.0), 0.0)
    }

    @Test
    fun aNonFiniteValueCollapsesToZeroSoTheGaugeNeverShowsNaN() {
        assertEquals(0.0, WidgetGaugeHeroProjection.clampGaugeValue(Double.NaN, 100.0), 0.0)
        assertEquals(0.0, WidgetGaugeHeroProjection.clampGaugeValue(Double.POSITIVE_INFINITY, 100.0), 0.0)
    }

    @Test
    fun aNonPositiveOrNonFiniteMaxStillFloorsAtZero() {
        // max <= 0: web min(value, max) then max(0, ...) ⇒ 0 for a positive value over a 0 ceiling.
        assertEquals(0.0, WidgetGaugeHeroProjection.clampGaugeValue(5.0, 0.0), 0.0)
        // A non-finite max uses the raw value as the ceiling, so a positive value floors at itself.
        assertEquals(5.0, WidgetGaugeHeroProjection.clampGaugeValue(5.0, Double.POSITIVE_INFINITY), 0.0)
    }

    // ── effectiveDecimals(): web `decimals ?? (isInteger(clamped) ? 0 : precision)` ─

    @Test
    fun anExplicitDecimalsOverrideAlwaysWins() {
        assertEquals(3, WidgetGaugeHeroProjection.effectiveDecimals(14.3, 30.0, override = 3))
        assertEquals(0, WidgetGaugeHeroProjection.effectiveDecimals(14.3, 30.0, override = 0))
    }

    @Test
    fun aWholeNumberValueRendersAtZeroDecimals() {
        assertEquals(0, WidgetGaugeHeroProjection.effectiveDecimals(72.0, 100.0, override = null))
    }

    @Test
    fun aFractionalValueRendersAtTheFallbackPrecision() {
        assertEquals(2, WidgetGaugeHeroProjection.effectiveDecimals(14.3, 30.0, override = null))
    }

    @Test
    fun theIntegerTestIsOnTheClampedValueNotTheRawValue() {
        // 130 clamps to 100 (a whole number) ⇒ 0 decimals, exactly like the web `Number.isInteger(clamped)`.
        assertEquals(0, WidgetGaugeHeroProjection.effectiveDecimals(130.0, 100.0, override = null))
        // -5 clamps to 0 (a whole number) ⇒ 0 decimals.
        assertEquals(0, WidgetGaugeHeroProjection.effectiveDecimals(-5.0, 100.0, override = null))
    }

    // ── statValueText() / statDescription(): the inline value + unit span ──────────

    @Test
    fun aStatWithAUnitJoinsTheValueAndUnitWithASpace() {
        val text = WidgetGaugeHeroProjection.statValueText(GaugeHeroStat("Range", "248", "mi"))
        assertEquals("248 mi", text)
    }

    @Test
    fun aStatWithoutAUnitIsJustTheValue() {
        assertEquals("312", WidgetGaugeHeroProjection.statValueText(GaugeHeroStat("Cycles", "312")))
        // A blank unit is treated as no unit (web `stat.unit && ...` falsiness).
        assertEquals("312", WidgetGaugeHeroProjection.statValueText(GaugeHeroStat("Cycles", "312", "")))
    }

    @Test
    fun theStatDescriptionNamesTheCellWithItsLabelAndValue() {
        val description = WidgetGaugeHeroProjection.statDescription(GaugeHeroStat("Range", "248", "mi"))
        assertEquals("Range: 248 mi", description)
    }

    @Test
    fun everyStatCellExposesANonBlankAccessibleDescription() {
        // Accessibility: each cell must read as one non-blank phrase to TalkBack in every shape.
        listOf(
            GaugeHeroStat("Range", "248", "mi"),
            GaugeHeroStat("Cycles", "312"),
            GaugeHeroStat("Health", "94", "%"),
        ).forEach { stat ->
            assertTrue(WidgetGaugeHeroProjection.statDescription(stat).isNotBlank())
        }
    }
}
