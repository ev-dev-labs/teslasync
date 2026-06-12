// Off-device unit coverage for the cost-analysis LoadingSkeleton variant (prompt A-0115). Mirrors the
// charging-curve LoadingSkeletonModelTest (prompt A-0088): the "adapter" under test is the projection
// of the web JSX into the [COST_ANALYSIS_SKELETON_SPEC] bar geometry; "per-state" is the responsive
// grid column fold across the three window-size classes the single render path adapts to; and the
// a11y label is the loading announcement resolved through the i18n facade. No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.loadingskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CostAnalysisLoadingSkeletonModelTest {
    private val spec = LoadingSkeletonProjection.costAnalysisParity

    @Test
    fun costAnalysisParityIsTheExportedSpec() {
        assertEquals(COST_ANALYSIS_SKELETON_SPEC, spec)
    }

    @Test
    fun variantEnumExposesBothCollidingCompositions() {
        assertEquals(
            listOf(LoadingSkeletonVariant.ChargingCurve, LoadingSkeletonVariant.CostAnalysis),
            LoadingSkeletonVariant.entries.toList(),
        )
    }

    @Test
    fun headerProjectsFixedTitleStackBesideARoundedAction() {
        assertEquals(
            listOf(
                SkeletonBar(heightDp = 28, widthDp = 220),
                SkeletonBar(heightDp = 16, widthDp = 340),
            ),
            spec.header.titleStack,
        )
        assertEquals(SkeletonBar(heightDp = 36, widthDp = 200, rounded = true), spec.header.action)
        assertTrue("the action bar is the only rounded bar (web `rounded`)", spec.header.action.rounded)
        assertFalse(spec.header.titleStack[0].rounded)
        assertFalse(spec.header.titleStack[1].rounded)
    }

    @Test
    fun cardGridProjectsSixThreeBarTilesWithFractionalWidthsAndColumns() {
        assertEquals(6, spec.cardCount)
        assertEquals(SkeletonBar(heightDp = 14, widthFraction = 0.6f), spec.card.label)
        assertEquals(SkeletonBar(heightDp = 24, widthFraction = 0.8f), spec.card.value)
        assertEquals(SkeletonBar(heightDp = 12, widthFraction = 0.4f), spec.card.caption)
        assertEquals(GridColumns(compact = 2, medium = 3, expanded = 6), spec.cardColumns)
    }

    @Test
    fun chartGridProjectsTwoIdenticalFractionalTitlePanels() {
        assertEquals(2, spec.charts.size)
        spec.charts.forEach { chart ->
            assertEquals(SkeletonBar(heightDp = 16, widthFraction = 0.4f), chart.title)
            assertEquals(200, chart.blockHeightDp)
        }
        assertEquals(GridColumns(compact = 1, medium = 2, expanded = 2), spec.chartColumns)
    }

    @Test
    fun tableProjectsAFractionalTitleOverFiveRows() {
        assertEquals(SkeletonBar(heightDp = 16, widthFraction = 0.3f), spec.table.title)
        assertEquals(5, spec.table.rowCount)
        assertEquals(32, spec.table.rowHeightDp)
    }

    @Test
    fun blockAndRowBarsFillParentWidth() {
        // The chart block + table-row bars carry neither a fixed nor a fractional width (web `w-full`),
        // so the renderer fills the parent.
        val block = SkeletonBar(heightDp = spec.charts[0].blockHeightDp)
        val row = SkeletonBar(heightDp = spec.table.rowHeightDp)
        assertNull(block.widthDp)
        assertNull(block.widthFraction)
        assertNull(row.widthDp)
        assertNull(row.widthFraction)
    }

    @Test
    fun cardColumnsTrackWindowSizeClasses() {
        assertEquals(2, LoadingSkeletonProjection.columnsFor(360f, spec.cardColumns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(720f, spec.cardColumns))
        assertEquals(6, LoadingSkeletonProjection.columnsFor(1280f, spec.cardColumns))
    }

    @Test
    fun chartColumnsCollapseToSingleColumnOnCompact() {
        assertEquals(1, LoadingSkeletonProjection.columnsFor(360f, spec.chartColumns))
        assertEquals(2, LoadingSkeletonProjection.columnsFor(720f, spec.chartColumns))
        assertEquals(2, LoadingSkeletonProjection.columnsFor(1280f, spec.chartColumns))
    }

    @Test
    fun columnBreakpointLowerBoundsAreInclusive() {
        // Exactly at a breakpoint promotes to the next class (compact < 600 ≤ medium < 840 ≤ expanded).
        assertEquals(2, LoadingSkeletonProjection.columnsFor(MEDIUM_MIN_WIDTH_DP - 1f, spec.cardColumns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(MEDIUM_MIN_WIDTH_DP, spec.cardColumns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(EXPANDED_MIN_WIDTH_DP - 1f, spec.cardColumns))
        assertEquals(6, LoadingSkeletonProjection.columnsFor(EXPANDED_MIN_WIDTH_DP, spec.cardColumns))
    }

    @Test
    fun cardsDivideEvenlyAcrossEveryColumnClass() {
        // Six cards fill 2 / 3 / 6 columns with no ragged trailing cell at any class.
        for (width in listOf(360f, 720f, 1280f)) {
            val cols = LoadingSkeletonProjection.columnsFor(width, spec.cardColumns)
            assertEquals(0, spec.cardCount % cols)
        }
    }

    @Test
    fun fractionalWidthsAreProperFractions() {
        val fractions =
            listOf(
                spec.card.label.widthFraction,
                spec.card.value.widthFraction,
                spec.card.caption.widthFraction,
                spec.charts[0].title.widthFraction,
                spec.table.title.widthFraction,
            )
        assertTrue(fractions.all { it != null && it > 0f && it <= 1f })
    }

    @Test
    fun everyBarHasAPositiveHeight() {
        val allBars =
            spec.header.titleStack +
                spec.header.action +
                listOf(spec.card.label, spec.card.value, spec.card.caption) +
                spec.charts.map { it.title } +
                listOf(spec.table.title)
        assertTrue(allBars.all { it.heightDp > 0 })
        assertTrue(spec.charts.all { it.blockHeightDp > 0 })
        assertTrue(spec.table.rowHeightDp > 0)
    }

    @Test
    fun accessibilityLabelResolvesLoadingKeyThroughFacade() {
        assertEquals("a11y.loading", A11Y_LOADING_KEY)
        val resolved =
            LoadingSkeletonProjection.accessibilityLabel { key ->
                if (key == A11Y_LOADING_KEY) "Loading" else "UNRESOLVED:$key"
            }
        assertEquals("Loading", resolved)
    }
}
