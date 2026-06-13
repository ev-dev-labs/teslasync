package io.teslasync.android.sharedsurfaces.chartcontainer

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage for the pure [ChartContainerModel] derivations behind the ChartContainer shared surface
 * — the a11y fallback-table projection, the host body-status selection, the annotation cache-then-network
 * feed classifier (loading / content / empty / stale / offline / hard-error), the hidden-toggle gate, the
 * hidden-series legend state, the timestamp formatter, and the a11y label/announcement derivations. Run by the
 * `:android:testReleaseUnitTest` gate, keeping the composable a thin render layer.
 */
class ChartContainerProjectionTest {
    // ── a11y fallback table ───────────────────────────────────────────────────────
    @Test
    fun headerReadsColumnLabels() {
        val columns = listOf(ChartDataColumn("month", "Month"), ChartDataColumn("cost", "Cost ($)"))
        assertEquals(listOf("Month", "Cost ($)"), chartTableHeader(columns))
    }

    @Test
    fun rowsApplyFormatterAndEmDashForNull() {
        val columns =
            listOf(
                ChartDataColumn("month", "Month"),
                ChartDataColumn("cost", "Cost") { v -> "$" + (v ?: 0) },
            )
        val rows: List<ChartDataRow> = listOf(mapOf("month" to "2026-05", "cost" to 42), mapOf("month" to null))
        val out = chartTableRows(rows, columns)
        assertEquals(listOf("2026-05", "$42"), out[0])
        // null month coerces to the em dash; absent cost runs the formatter over null.
        assertEquals(EM_DASH, out[1][0])
        assertEquals("$0", out[1][1])
    }

    @Test
    fun formatCellCoercesWithoutFormatter() {
        assertEquals("7", formatChartCell(7, null))
        assertEquals(EM_DASH, formatChartCell(null, null))
        assertEquals("x", formatChartCell("ignored") { "x" })
    }

    @Test
    fun hasFallbackTableRequiresBothDataAndColumns() {
        val cols = listOf(ChartDataColumn("a", "A"))
        val data: List<ChartDataRow> = listOf(mapOf("a" to 1))
        assertTrue(hasFallbackTable(data, cols))
        assertFalse(hasFallbackTable(null, cols))
        assertFalse(hasFallbackTable(data, null))
        assertFalse(hasFallbackTable(emptyList(), cols))
        assertFalse(hasFallbackTable(data, emptyList()))
    }

    @Test
    fun accessibleDescriptionMergesLabelAndDescription() {
        assertEquals("Daily energy", composeAccessibleDescription("Daily energy", null))
        assertEquals("Daily energy", composeAccessibleDescription("Daily energy", "  "))
        assertEquals("Daily energy. Ranged 380–410 V", composeAccessibleDescription("Daily energy", "Ranged 380–410 V"))
    }

    // ── chart body status (host loading / error / empty / content) ─────────────────
    @Test
    fun bodyStatusPrefersLoadingThenErrorThenEmpty() {
        assertEquals(ChartBodyStatus.Loading, chartBodyStatus(loading = true, error = true, empty = true))
        assertEquals(ChartBodyStatus.Error, chartBodyStatus(loading = false, error = true, empty = true))
        assertEquals(ChartBodyStatus.Empty, chartBodyStatus(loading = false, error = false, empty = true))
        assertEquals(ChartBodyStatus.Content, chartBodyStatus(loading = false, error = false, empty = false))
    }

    // ── annotation feed classification (every P3 state) ────────────────────────────
    @Test
    fun feedLoadingWhenFirstLoadNoCache() {
        assertEquals(AnnotationFeed.Loading, classifyAnnotationFeed(UiState.loading()))
    }

    @Test
    fun feedReadyWhenContent() {
        val feed = classifyAnnotationFeed(UiState(UiPhase.Content, data = listOf(annotation("1")), fetchedAt = 1L))
        assertTrue(feed is AnnotationFeed.Ready)
        assertEquals(1, (feed as AnnotationFeed.Ready).annotations.size)
    }

    @Test
    fun feedEmptyWhenResolvedEmpty() {
        assertEquals(AnnotationFeed.Empty, classifyAnnotationFeed(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 1L)))
    }

    @Test
    fun feedOfflineKeepsLastKnownAndFlagsNetwork() {
        val state =
            UiState(
                UiPhase.Content,
                data = listOf(annotation("1"), annotation("2")),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            )
        val feed = classifyAnnotationFeed(state)
        assertTrue(feed is AnnotationFeed.Offline)
        feed as AnnotationFeed.Offline
        assertTrue(feed.offline)
        assertEquals(2, feed.annotations.size)
        assertTrue(feed.canRetry())
    }

    @Test
    fun feedStaleNonNetworkIsOfflineNotFlaggedOffline() {
        val state = UiState(UiPhase.Content, data = listOf(annotation("1")), fetchedAt = 1L, stale = true, errorKind = ErrorKind.Timeout)
        val feed = classifyAnnotationFeed(state)
        assertTrue(feed is AnnotationFeed.Offline)
        assertFalse((feed as AnnotationFeed.Offline).offline)
    }

    @Test
    fun feedFailedWhenHardErrorNoCache() {
        val feed = classifyAnnotationFeed(UiState(UiPhase.Error, errorKind = ErrorKind.Http))
        assertTrue(feed is AnnotationFeed.Failed)
        assertFalse((feed as AnnotationFeed.Failed).offline)
        assertTrue(feed.canRetry())
    }

    @Test
    fun fetchedReadsRowsForReadyAndOfflineOnly() {
        assertEquals(1, AnnotationFeed.Ready(listOf(annotation("1"))).fetched().size)
        assertEquals(2, AnnotationFeed.Offline(listOf(annotation("1"), annotation("2")), offline = true).fetched().size)
        assertTrue(AnnotationFeed.Loading.fetched().isEmpty())
        assertTrue(AnnotationFeed.Empty.fetched().isEmpty())
        assertTrue(AnnotationFeed.Failed(offline = false).fetched().isEmpty())
    }

    // ── hidden toggle gate + marker row ────────────────────────────────────────────
    @Test
    fun visibleAnnotationsRespectEnabledAndHidden() {
        val rows = listOf(annotation("1"))
        assertEquals(rows, visibleAnnotations(enabled = true, hidden = false, fetched = rows))
        assertTrue(visibleAnnotations(enabled = true, hidden = true, fetched = rows).isEmpty())
        assertTrue(visibleAnnotations(enabled = false, hidden = false, fetched = rows).isEmpty())
    }

    @Test
    fun markerRowOnlyWhenEnabledVisibleAndNotHidden() {
        val rows = listOf(annotation("1"))
        assertTrue(showMarkerRow(enabled = true, hidden = false, visible = rows))
        assertFalse(showMarkerRow(enabled = true, hidden = true, visible = rows))
        assertFalse(showMarkerRow(enabled = false, hidden = false, visible = rows))
        assertFalse(showMarkerRow(enabled = true, hidden = false, visible = emptyList()))
    }

    // ── hidden-series legend state ─────────────────────────────────────────────────
    @Test
    fun hiddenSeriesTogglesMembership() {
        val initial = ChartHiddenSeries()
        assertFalse(initial.isHidden("cost"))
        val hiddenOnce = initial.toggle("cost")
        assertTrue(hiddenOnce.isHidden("cost"))
        assertFalse(hiddenOnce.toggle("cost").isHidden("cost"))
    }

    // ── timestamp formatter ────────────────────────────────────────────────────────
    @Test
    fun formatAnnotationDateNormalisesIsoToDate() {
        assertEquals("2026-05-01", formatAnnotationDate("2026-05-01T12:34:56Z"))
        assertEquals("2026-05-01", formatAnnotationDate("2026-05-01"))
        // An offset instant is read in UTC (web `getUTCFullYear` baseline): midnight +02:00 is the prior UTC day.
        assertEquals("2026-04-30", formatAnnotationDate("2026-05-01T00:00:00+02:00"))
    }

    @Test
    fun formatAnnotationDateFallsBackToRawWhenUnparseable() {
        assertEquals("not-a-date", formatAnnotationDate("not-a-date"))
        assertEquals("", formatAnnotationDate(""))
    }

    // ── a11y announcement ──────────────────────────────────────────────────────────
    @Test
    fun announcementIsNullForLoadingReadyEmpty() {
        val labels = AnnotationFeedLabels(stale = "Stale", offline = "Offline", error = "Failed")
        assertNull(annotationFeedAnnouncement(AnnotationFeed.Loading, labels))
        assertNull(annotationFeedAnnouncement(AnnotationFeed.Ready(emptyList()), labels))
        assertNull(annotationFeedAnnouncement(AnnotationFeed.Empty, labels))
    }

    @Test
    fun announcementPicksOfflineStaleErrorCopy() {
        val labels = AnnotationFeedLabels(stale = "Stale", offline = "Offline", error = "Failed")
        assertEquals("Offline", annotationFeedAnnouncement(AnnotationFeed.Offline(emptyList(), offline = true), labels))
        assertEquals("Stale", annotationFeedAnnouncement(AnnotationFeed.Offline(emptyList(), offline = false), labels))
        assertEquals("Failed", annotationFeedAnnouncement(AnnotationFeed.Failed(offline = true), labels))
    }

    // ── config ─────────────────────────────────────────────────────────────────────
    @Test
    fun configListParamsAndHiddenKey() {
        val config = ChartAnnotationsConfig(scope = "cost", vehicleId = 7L, chartId = "monthly-cost")
        assertEquals(7L, config.listParams().vehicleId)
        assertEquals("cost", config.listParams().scope)
        assertEquals("monthly-cost", config.hiddenStorageKey("Monthly Cost"))
        // Falls back to the title when no chartId is set (web `chartId ?? title`).
        assertEquals("Monthly Cost", ChartAnnotationsConfig(scope = "cost").hiddenStorageKey("Monthly Cost"))
    }

    private fun annotation(id: String): DataAnnotation =
        DataAnnotation(
            id = id,
            timestamp = "2026-05-01T00:00:00Z",
            label = "Annotation $id",
            description = null,
            category = "milestone",
            context = "cost",
            vehicleId = 1L,
            createdAt = "2026-05-01T00:00:00Z",
        )
}
