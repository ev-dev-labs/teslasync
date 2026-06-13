// Off-device unit coverage for the PageSkeleton surface's pure model (P3 acceptance: the adapter test).
// Exercises the registration slug the prompt mandates, the four web layout defaults, the per-region test
// tags that mirror the web `data-testid`s, the projection clamps that keep every shaped region renderable
// (the native guard the web `Array.from({ length })` lacks), and the PII-safe `view.opened` diagnostic. No
// Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the
// defaults + structure the web `PageSkeleton` building blocks produce.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Test

class PageSkeletonModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("page-skeleton", PageSkeletonRegistration.ID)
        assertEquals("PageSkeleton", PageSkeletonRegistration.SLUG)
    }

    // ── web layout defaults (THE spec: cards 4, height 320, table 8×4) ────────────────

    @Test
    fun layoutDefaultsMatchTheWebSource() {
        assertEquals(4, DEFAULT_STAT_CARDS)
        assertEquals(320, DEFAULT_CHART_HEIGHT_DP)
        assertEquals(8, DEFAULT_TABLE_ROWS)
        assertEquals(4, DEFAULT_TABLE_COLS)
    }

    // ── per-region test tags mirror the web data-testids ──────────────────────────────

    @Test
    fun regionTestTagsMirrorTheWebDataTestIds() {
        assertEquals("page-header-skeleton", PageSkeletonRegion.Header.testTag)
        assertEquals("stat-grid-skeleton", PageSkeletonRegion.StatGrid.testTag)
        assertEquals("chart-block-skeleton", PageSkeletonRegion.Chart.testTag)
        assertEquals("table-skeleton", PageSkeletonRegion.Table.testTag)
        assertEquals(4, PageSkeletonRegion.entries.size)
    }

    // ── projection clamps: defaults preserved, pathological inputs made safe ──────────

    @Test
    fun statCardsPreservesValidCountsAndClampsTheRest() {
        assertEquals(DEFAULT_STAT_CARDS, PageSkeletonProjection.statCards(DEFAULT_STAT_CARDS))
        assertEquals(MIN_BLOCK_COUNT, PageSkeletonProjection.statCards(0))
        assertEquals(MIN_BLOCK_COUNT, PageSkeletonProjection.statCards(-3))
        assertEquals(MAX_STAT_CARDS, PageSkeletonProjection.statCards(100))
        assertEquals(MAX_STAT_CARDS, PageSkeletonProjection.statCards(MAX_STAT_CARDS))
    }

    @Test
    fun chartHeightPreservesValidHeightsAndClampsTheRest() {
        assertEquals(DEFAULT_CHART_HEIGHT_DP, PageSkeletonProjection.chartHeightDp(DEFAULT_CHART_HEIGHT_DP))
        assertEquals(MIN_CHART_HEIGHT_DP, PageSkeletonProjection.chartHeightDp(0))
        assertEquals(MIN_CHART_HEIGHT_DP, PageSkeletonProjection.chartHeightDp(-50))
        assertEquals(MAX_CHART_HEIGHT_DP, PageSkeletonProjection.chartHeightDp(99_999))
    }

    @Test
    fun tableRowsAndColsPreserveValidCountsAndClampTheRest() {
        assertEquals(DEFAULT_TABLE_ROWS, PageSkeletonProjection.tableRows(DEFAULT_TABLE_ROWS))
        assertEquals(MIN_BLOCK_COUNT, PageSkeletonProjection.tableRows(0))
        assertEquals(MAX_TABLE_ROWS, PageSkeletonProjection.tableRows(1_000))

        assertEquals(DEFAULT_TABLE_COLS, PageSkeletonProjection.tableCols(DEFAULT_TABLE_COLS))
        assertEquals(MIN_BLOCK_COUNT, PageSkeletonProjection.tableCols(0))
        assertEquals(MAX_TABLE_COLS, PageSkeletonProjection.tableCols(50))
    }

    @Test
    fun specsCarryTheClampedCounts() {
        assertEquals(StatGridSpec(DEFAULT_STAT_CARDS), PageSkeletonProjection.statGridSpec(DEFAULT_STAT_CARDS))
        assertEquals(StatGridSpec(MIN_BLOCK_COUNT), PageSkeletonProjection.statGridSpec(0))

        assertEquals(TableSpec(DEFAULT_TABLE_ROWS, DEFAULT_TABLE_COLS), PageSkeletonProjection.tableSpec(8, 4))
        assertEquals(TableSpec(MIN_BLOCK_COUNT, MIN_BLOCK_COUNT), PageSkeletonProjection.tableSpec(0, -1))
        assertEquals(TableSpec(MAX_TABLE_ROWS, MAX_TABLE_COLS), PageSkeletonProjection.tableSpec(1_000, 99))
    }

    // ── diagnostics: one PII-safe view.opened (slug only) ─────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordPageSkeletonOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — a skeleton carries no caller value, so nothing else can leak.
        assertEquals(mapOf("surface" to "PageSkeleton"), records[0].fields)
    }
}
