// Off-device unit coverage for the LoadingSkeleton feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). The web source is a purely presentational loading scaffold with no
// data and no i18n, so the "adapter" under test is the projection of its JSX into the
// [LOADING_SKELETON_SPEC] bar geometry; "per-state" is the responsive grid column fold across the
// three window-size classes the single render path adapts to; and the a11y label is the loading
// announcement resolved through the i18n facade. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.loadingskeleton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoadingSkeletonModelTest {
    private val spec = LoadingSkeletonProjection.webParity

    @Test
    fun registrationIdentifiersMatchSurfaceSlug() {
        assertEquals("loading-skeleton", LoadingSkeletonRegistration.ID)
        assertEquals("LoadingSkeleton", LoadingSkeletonRegistration.SLUG)
    }

    @Test
    fun webParityIsTheExportedSpec() {
        assertEquals(LOADING_SKELETON_SPEC, spec)
    }

    @Test
    fun headerProjectsTitleAndSubtitleBars() {
        assertEquals(
            listOf(
                SkeletonBar(heightDp = 32, widthDp = 192),
                SkeletonBar(heightDp = 16, widthDp = 288),
            ),
            spec.header,
        )
    }

    @Test
    fun filterRowProjectsTwoFixedWidthControls() {
        assertEquals(
            listOf(
                SkeletonBar(heightDp = 40, widthDp = 192),
                SkeletonBar(heightDp = 40, widthDp = 256),
            ),
            spec.filters,
        )
    }

    @Test
    fun topStatGridProjectsSixTilesWithWebGeometryAndColumns() {
        assertEquals(6, spec.topStats.count)
        assertEquals(SkeletonBar(heightDp = 12, widthDp = 64), spec.topStats.tile.label)
        assertEquals(SkeletonBar(heightDp = 28, widthDp = 80), spec.topStats.tile.value)
        assertEquals(GridColumns(compact = 2, medium = 3, expanded = 6), spec.topStats.columns)
    }

    @Test
    fun chartPanelsProjectTitleBarsOverFullWidthBlocks() {
        assertEquals(2, spec.chartPanels.size)
        assertEquals(SkeletonChartPanelSpec(SkeletonBar(heightDp = 20, widthDp = 160), blockHeightDp = 256), spec.chartPanels[0])
        assertEquals(SkeletonChartPanelSpec(SkeletonBar(heightDp = 20, widthDp = 224), blockHeightDp = 208), spec.chartPanels[1])
    }

    @Test
    fun splitRegionProjectsTwoIdenticalPanels() {
        assertEquals(2, spec.splitPanels.count)
        assertEquals(SkeletonBar(heightDp = 20, widthDp = 176), spec.splitPanels.panel.title)
        assertEquals(192, spec.splitPanels.panel.blockHeightDp)
        assertEquals(GridColumns(compact = 1, medium = 2, expanded = 2), spec.splitPanels.columns)
    }

    @Test
    fun bottomStatGridProjectsFourTilesWithWebGeometryAndColumns() {
        assertEquals(4, spec.bottomStats.count)
        assertEquals(SkeletonBar(heightDp = 12, widthDp = 80), spec.bottomStats.tile.label)
        assertEquals(SkeletonBar(heightDp = 28, widthDp = 64), spec.bottomStats.tile.value)
        assertEquals(GridColumns(compact = 2, medium = 4, expanded = 4), spec.bottomStats.columns)
    }

    @Test
    fun blockBarsFillParentWidth() {
        // The chart/block bars carry no fixed width (web `w-full`), so the renderer fills the parent.
        assertNull(SkeletonBar(heightDp = spec.chartPanels[0].blockHeightDp).widthDp)
        assertNull(SkeletonBar(heightDp = spec.splitPanels.panel.blockHeightDp).widthDp)
    }

    @Test
    fun statGridColumnsTrackWindowSizeClasses() {
        val columns = spec.topStats.columns
        assertEquals(2, LoadingSkeletonProjection.columnsFor(360f, columns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(720f, columns))
        assertEquals(6, LoadingSkeletonProjection.columnsFor(1280f, columns))
    }

    @Test
    fun splitColumnsCollapseToSingleColumnOnCompact() {
        val columns = spec.splitPanels.columns
        assertEquals(1, LoadingSkeletonProjection.columnsFor(360f, columns))
        assertEquals(2, LoadingSkeletonProjection.columnsFor(720f, columns))
        assertEquals(2, LoadingSkeletonProjection.columnsFor(1280f, columns))
    }

    @Test
    fun bottomStatColumnsGoTwoThenFour() {
        val columns = spec.bottomStats.columns
        assertEquals(2, LoadingSkeletonProjection.columnsFor(360f, columns))
        assertEquals(4, LoadingSkeletonProjection.columnsFor(720f, columns))
        assertEquals(4, LoadingSkeletonProjection.columnsFor(1280f, columns))
    }

    @Test
    fun columnBreakpointLowerBoundsAreInclusive() {
        val columns = spec.topStats.columns
        // Exactly at a breakpoint promotes to the next class (compact < 600 ≤ medium < 840 ≤ expanded).
        assertEquals(2, LoadingSkeletonProjection.columnsFor(MEDIUM_MIN_WIDTH_DP - 1f, columns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(MEDIUM_MIN_WIDTH_DP, columns))
        assertEquals(3, LoadingSkeletonProjection.columnsFor(EXPANDED_MIN_WIDTH_DP - 1f, columns))
        assertEquals(6, LoadingSkeletonProjection.columnsFor(EXPANDED_MIN_WIDTH_DP, columns))
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

    @Test
    fun statTilesDivideEvenlyAcrossEveryColumnClass() {
        // Six top tiles fill 2 / 3 / 6 columns and four bottom tiles fill 2 / 4 columns with no
        // ragged trailing cells at any class — the rows stay full at every breakpoint.
        for (width in listOf(360f, 720f, 1280f)) {
            val topCols = LoadingSkeletonProjection.columnsFor(width, spec.topStats.columns)
            assertEquals(0, spec.topStats.count % topCols)
            val bottomCols = LoadingSkeletonProjection.columnsFor(width, spec.bottomStats.columns)
            assertEquals(0, spec.bottomStats.count % bottomCols)
        }
    }

    @Test
    fun everyBarHasAPositiveHeight() {
        val allBars =
            spec.header +
                spec.filters +
                listOf(spec.topStats.tile.label, spec.topStats.tile.value) +
                spec.chartPanels.map { it.title } +
                listOf(spec.splitPanels.panel.title) +
                listOf(spec.bottomStats.tile.label, spec.bottomStats.tile.value)
        assertTrue(allBars.all { it.heightDp > 0 })
    }
}
