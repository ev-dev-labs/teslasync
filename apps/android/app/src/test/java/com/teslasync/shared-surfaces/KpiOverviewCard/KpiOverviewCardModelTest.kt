// Off-device unit coverage for the KpiOverviewCard surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Pins the responsive column count to the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`
// breakpoints, the period strip, the content / empty classifier, the merged TalkBack summary, the surface slug,
// and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KpiOverviewCardModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── Surface metadata mirrors the prompt-mandated slug ────────────────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("KpiOverviewCard", KPI_OVERVIEW_CARD_SLUG)
    }

    // ── Responsive columns mirror the web grid-cols-2 sm:3 lg:6 template ──────────────

    @Test
    fun columnConstantsMatchWebTemplate() {
        assertEquals(2, KPI_COLUMNS_COMPACT)
        assertEquals(3, KPI_COLUMNS_MEDIUM)
        assertEquals(6, KPI_COLUMNS_EXPANDED)
    }

    @Test
    fun kpiColumnsForWidthMapsMaterialBreakpoints() {
        // Compact (< 600dp) → 2 columns, inclusive of the zero/narrow edge.
        assertEquals(2, kpiColumnsForWidth(0))
        assertEquals(2, kpiColumnsForWidth(360))
        assertEquals(2, kpiColumnsForWidth(599))
        // Medium (600..839dp) → 3 columns.
        assertEquals(3, kpiColumnsForWidth(600))
        assertEquals(3, kpiColumnsForWidth(839))
        // Expanded (>= 840dp) → 6 columns.
        assertEquals(6, kpiColumnsForWidth(840))
        assertEquals(6, kpiColumnsForWidth(1280))
    }

    // ── Period strip (web ComparisonHeader current · prior) ──────────────────────────

    @Test
    fun periodLabelJoinsCurrentAndComparison() {
        val header = KpiHeaderModel("Overview", "Last 30 days", "vs prior 30 days")
        assertEquals("Last 30 days \u00b7 vs prior 30 days", kpiPeriodLabel(header))
    }

    @Test
    fun periodLabelIsCurrentOnlyWhenNoComparison() {
        assertEquals("Last 30 days", kpiPeriodLabel(KpiHeaderModel("Overview", "Last 30 days")))
    }

    // ── Content vs empty classifier ──────────────────────────────────────────────────

    @Test
    fun hasKpiTilesIsFalseForEmptyAndTrueForContent() {
        assertFalse(hasKpiTiles(KpiOverviewData.EMPTY))
        val content = KpiOverviewData(KpiHeaderModel("a", "b"), listOf(KpiTile("Drives", "42")))
        assertTrue(hasKpiTiles(content))
    }

    @Test
    fun emptyZeroValueHasAnonymousHeaderAndNoTiles() {
        assertEquals("", KpiOverviewData.EMPTY.header.title)
        assertEquals("", KpiOverviewData.EMPTY.header.currentLabel)
        assertTrue(KpiOverviewData.EMPTY.tiles.isEmpty())
    }

    // ── Merged TalkBack summary (a11y label) ─────────────────────────────────────────

    @Test
    fun accessibilityLabelFoldsTitlePeriodTilesAndSecondary() {
        val data =
            KpiOverviewData(
                header = KpiHeaderModel("Overview", "Last 30 days", "vs prior 30 days"),
                tiles = listOf(KpiTile("Drives", "42"), KpiTile("Distance", "1,204")),
                secondary = "Top speed 152 mph",
            )
        assertEquals(
            "Overview, Last 30 days \u00b7 vs prior 30 days, Drives 42, Distance 1,204, Top speed 152 mph",
            kpiOverviewAccessibilityLabel(data),
        )
    }

    @Test
    fun accessibilityLabelOmitsAbsentTilesAndSecondary() {
        val data = KpiOverviewData(KpiHeaderModel("Overview", "Last 30 days"), emptyList())
        assertEquals("Overview, Last 30 days", kpiOverviewAccessibilityLabel(data))
    }

    @Test
    fun accessibilityLabelIsBlankForTheZeroValue() {
        assertEquals("", kpiOverviewAccessibilityLabel(KpiOverviewData.EMPTY))
    }

    // ── PII-safe view.opened diagnostic ──────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        recordKpiOverviewCardOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "KpiOverviewCard"), record.fields)
    }
}
