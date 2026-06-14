package io.teslasync.android.widgetprimitives.widgetrankedlist

import io.teslasync.android.components.ui.BadgeVariant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetRankedList ranking logic — the native mirror of the decisions the web
 * component makes (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx) before Compose paints anything:
 * the row budget ([rankedListLimit]), the bars-hidden guard ([rankedListBarsHidden]), the sort/slice/bar-fraction
 * projection ([widgetRankedListProjection]), the badge variant map ([toBadgeVariant]), and the merged
 * accessibility label ([rankedRowDescription]). Because the composable is a thin render layer over these
 * projections, the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetRankedListModelTest {
    // ── rankedListLimit: web `maxItems ?? (compact ? 3 : 5)` ───────────────────────────────────────────────

    @Test
    fun nonCompactDefaultsToFiveRows() {
        assertEquals(RANKED_LIST_DEFAULT_LIMIT, rankedListLimit(maxItems = null, compact = false))
        assertEquals(5, rankedListLimit(maxItems = null, compact = false))
    }

    @Test
    fun compactDefaultsToThreeRows() {
        assertEquals(RANKED_LIST_COMPACT_LIMIT, rankedListLimit(maxItems = null, compact = true))
        assertEquals(3, rankedListLimit(maxItems = null, compact = true))
    }

    @Test
    fun explicitMaxItemsAlwaysWins() {
        assertEquals(2, rankedListLimit(maxItems = 2, compact = false))
        assertEquals(8, rankedListLimit(maxItems = 8, compact = true))
        // web `slice(0, 0)` shows nothing — an explicit zero is honoured, not replaced by the default.
        assertEquals(0, rankedListLimit(maxItems = 0, compact = false))
    }

    // ── rankedListBarsHidden: web `hideBars = compact || !showBars` ────────────────────────────────────────

    @Test
    fun barsHiddenWhenCompactRegardlessOfShowBars() {
        assertTrue(rankedListBarsHidden(compact = true, showBars = true))
        assertTrue(rankedListBarsHidden(compact = true, showBars = false))
    }

    @Test
    fun barsHiddenWhenShowBarsFalse() {
        assertTrue(rankedListBarsHidden(compact = false, showBars = false))
    }

    @Test
    fun barsShownOnlyWhenNonCompactAndShowBars() {
        assertFalse(rankedListBarsHidden(compact = false, showBars = true))
    }

    // ── widgetRankedListProjection: sort + slice + bar fraction (the per-state snapshot) ────────────────────

    @Test
    fun emptyInputProjectsToTheEmptyState() {
        val projection = project(items = emptyList())
        assertTrue(projection.isEmpty)
        assertTrue(projection.rows.isEmpty())
    }

    @Test
    fun sortsByValueDescendingAndStampsOneBasedRanks() {
        val projection =
            project(
                items =
                    listOf(
                        item(id = "a", label = "A", value = 10.0),
                        item(id = "c", label = "C", value = 30.0),
                        item(id = "b", label = "B", value = 20.0),
                    ),
            )
        assertEquals(listOf("C", "B", "A"), projection.rows.map { it.item.label })
        assertEquals(listOf(1, 2, 3), projection.rows.map { it.rank })
    }

    @Test
    fun equalValuesKeepInputOrderStableSort() {
        // web `[...items].sort((a, b) => b.value - a.value)` is stable on ties; Kotlin's sort matches.
        val projection =
            project(
                items =
                    listOf(
                        item(id = "first", label = "First", value = 5.0),
                        item(id = "second", label = "Second", value = 5.0),
                        item(id = "third", label = "Third", value = 5.0),
                    ),
            )
        assertEquals(listOf("First", "Second", "Third"), projection.rows.map { it.item.label })
    }

    @Test
    fun nonCompactSlicesToFiveByDefault() {
        val projection = project(items = (1..9).map { item(id = "$it", label = "L$it", value = it.toDouble()) })
        assertEquals(5, projection.rows.size)
        // the five largest (9..5) survive, in descending order.
        assertEquals(listOf("L9", "L8", "L7", "L6", "L5"), projection.rows.map { it.item.label })
    }

    @Test
    fun compactSlicesToThreeByDefault() {
        val projection =
            project(
                items = (1..9).map { item(id = "$it", label = "L$it", value = it.toDouble()) },
                compact = true,
            )
        assertEquals(3, projection.rows.size)
        assertEquals(listOf("L9", "L8", "L7"), projection.rows.map { it.item.label })
    }

    @Test
    fun explicitMaxItemsLimitsTheRows() {
        val projection =
            project(
                items = (1..9).map { item(id = "$it", label = "L$it", value = it.toDouble()) },
                maxItems = 2,
            )
        assertEquals(2, projection.rows.size)
        assertEquals(listOf("L9", "L8"), projection.rows.map { it.item.label })
    }

    @Test
    fun negativeMaxItemsClampsToAnEmptySlice() {
        // web `slice(0, n<0)` returns []; the projection clamps the limit so `take(n<0)` cannot throw.
        val projection =
            project(
                items = listOf(item(id = "a", label = "A", value = 1.0)),
                maxItems = -3,
            )
        assertTrue(projection.isEmpty)
    }

    @Test
    fun barFractionScalesByMaxValueWithTheLeaderFull() {
        val projection =
            project(
                items =
                    listOf(
                        item(id = "a", label = "A", value = 100.0),
                        item(id = "b", label = "B", value = 50.0),
                        item(id = "c", label = "C", value = 25.0),
                    ),
            )
        assertEquals(1.0f, projection.rows[0].barFraction, FRACTION_TOLERANCE)
        assertEquals(0.5f, projection.rows[1].barFraction, FRACTION_TOLERANCE)
        assertEquals(0.25f, projection.rows[2].barFraction, FRACTION_TOLERANCE)
    }

    @Test
    fun allZeroValuesYieldZeroWidthBars() {
        // web `maxValue > 0 ? ... : 0` — a reduce starting at 0 keeps maxValue at 0 for an all-zero slice.
        val projection =
            project(
                items =
                    listOf(
                        item(id = "a", label = "A", value = 0.0),
                        item(id = "b", label = "B", value = 0.0),
                    ),
            )
        assertTrue(projection.rows.all { it.barFraction == 0f })
    }

    @Test
    fun negativeValuesNeverProduceANegativeWidthBar() {
        // web `reduce(max, 0)` keeps maxValue >= 0; a negative entry's `value / maxValue` is clamped to 0.
        val projection =
            project(
                items =
                    listOf(
                        item(id = "a", label = "A", value = 40.0),
                        item(id = "b", label = "B", value = -10.0),
                    ),
            )
        assertEquals(1.0f, projection.rows[0].barFraction, FRACTION_TOLERANCE)
        assertEquals(0f, projection.rows[1].barFraction, FRACTION_TOLERANCE)
    }

    @Test
    fun barsVisibleMirrorsTheHideBarsGuard() {
        val items = listOf(item(id = "a", label = "A", value = 1.0))
        assertTrue(project(items = items).barsVisible)
        assertFalse(project(items = items, compact = true).barsVisible)
        assertFalse(project(items = items, showBars = false).barsVisible)
        // the fraction is still computed even when the bars are not drawn (web computes barPct regardless).
        assertEquals(1.0f, project(items = items, showBars = false).rows[0].barFraction, FRACTION_TOLERANCE)
    }

    // ── rankedRowDescription: merged TalkBack label ────────────────────────────────────────────────────────

    @Test
    fun rowDescriptionWithoutBadgeIsRankLabelValue() {
        val row = project(items = listOf(item(id = "a", label = "Home", value = 12.0, formatted = "12 kWh"))).rows[0]
        assertEquals("1. Home, 12 kWh", row.contentDescription)
    }

    @Test
    fun rowDescriptionAppendsTheBadgeText() {
        val badged =
            item(id = "a", label = "Home", value = 12.0, formatted = "12 kWh")
                .copy(badge = RankedBadge(text = "Top", variant = RankedBadgeVariant.Success))
        val row = project(items = listOf(badged)).rows[0]
        assertEquals("1. Home, 12 kWh, Top", row.contentDescription)
    }

    // ── toBadgeVariant: web `badgeVariantMap` (success/warning/error->danger/neutral) ──────────────────────

    @Test
    fun badgeVariantMapMatchesTheWebMapping() {
        assertEquals(BadgeVariant.Success, RankedBadgeVariant.Success.toBadgeVariant())
        assertEquals(BadgeVariant.Warning, RankedBadgeVariant.Warning.toBadgeVariant())
        assertEquals(BadgeVariant.Danger, RankedBadgeVariant.Error.toBadgeVariant())
        assertEquals(BadgeVariant.Neutral, RankedBadgeVariant.Neutral.toBadgeVariant())
    }

    @Test
    fun everyBadgeVariantHasAMapping() {
        // exhaustiveness guard: a new web variant must be mapped here, not silently dropped.
        RankedBadgeVariant.entries.forEach { variant -> variant.toBadgeVariant() }
        assertEquals(4, RankedBadgeVariant.entries.size)
    }

    // ── registration / slug contract ───────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetRankedList", WIDGET_RANKED_LIST_SLUG)
        assertEquals("WidgetRankedList", WidgetRankedListRegistration.SLUG)
        assertEquals("widget-ranked-list", WidgetRankedListRegistration.ID)
    }

    private fun project(
        items: List<RankedItem>,
        maxItems: Int? = null,
        compact: Boolean = false,
        showBars: Boolean = true,
    ): WidgetRankedListProjection = widgetRankedListProjection(items, maxItems, compact, showBars)

    private fun item(
        id: String,
        label: String,
        value: Double,
        formatted: String = value.toString(),
    ): RankedItem = RankedItem(id = id, label = label, value = value, formattedValue = formatted)

    private companion object {
        private const val FRACTION_TOLERANCE = 0.0001f
    }
}
