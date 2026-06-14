package io.teslasync.android.sharedsurfaces.uptimeheatmap

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the pure [UptimeHeatmapProjection] + model — the cached → projection adapter
 * test the prompt mandates. Covers the web component's uptime-% fold
 * (`(healthy + maintenance) / total * 100`, `null` when empty), the caption threshold tone
 * (`>= 99` good / `>= 95` warn / else bad), the `fmtPercent(pct, 2)` formatting, the empty-window predicate,
 * the cache-then-network freshness fold (live/stale/offline), the shared QueryError recovery bucket, the
 * localized heading/day/uptime templates, and the presence of every accessibility label. No Android, no
 * coroutines.
 */
class UptimeHeatmapProjectionTest {
    @Test
    fun uptimePercentFoldsHealthyAndMaintenanceOverTheWindow() {
        assertNull(UptimeHeatmapProjection.uptimePercent(emptyList()))

        val days =
            listOf(
                day(UptimeStatus.Healthy),
                day(UptimeStatus.Maintenance),
                day(UptimeStatus.Degraded),
                day(UptimeStatus.Unhealthy),
            )
        // healthy + maintenance = 2 of 4 ⇒ 50%.
        assertEquals(50.0, UptimeHeatmapProjection.uptimePercent(days)!!, EPSILON)

        assertEquals(100.0, UptimeHeatmapProjection.uptimePercent(listOf(day(UptimeStatus.Healthy)))!!, EPSILON)
        assertEquals(0.0, UptimeHeatmapProjection.uptimePercent(listOf(day(UptimeStatus.Unknown)))!!, EPSILON)
    }

    @Test
    fun pctToneMatchesTheWebColorThresholds() {
        assertEquals(UptimePctTone.Good, UptimeHeatmapProjection.pctTone(100.0))
        assertEquals(UptimePctTone.Good, UptimeHeatmapProjection.pctTone(99.0))
        assertEquals(UptimePctTone.Warn, UptimeHeatmapProjection.pctTone(98.99))
        assertEquals(UptimePctTone.Warn, UptimeHeatmapProjection.pctTone(95.0))
        assertEquals(UptimePctTone.Bad, UptimeHeatmapProjection.pctTone(94.99))
        assertEquals(UptimePctTone.Bad, UptimeHeatmapProjection.pctTone(0.0))
    }

    @Test
    fun formatPercentMatchesFmtPercentWithTwoDecimals() {
        assertEquals("99.50%", UptimeHeatmapProjection.formatPercent(99.5, Locale.US))
        assertEquals("100.00%", UptimeHeatmapProjection.formatPercent(100.0, Locale.US))
        assertEquals("0.00%", UptimeHeatmapProjection.formatPercent(0.0, Locale.US))
    }

    @Test
    fun isEmptyIsTrueOnlyForAnEmptyWindow() {
        assertTrue(UptimeHeatmapProjection.isEmpty(UptimeWindow(emptyList())))
        assertFalse(UptimeHeatmapProjection.isEmpty(UptimeWindow(listOf(day(UptimeStatus.Healthy)))))
    }

    @Test
    fun freshnessFoldsLiveStaleAndOffline() {
        val window = UptimeWindow(listOf(day(UptimeStatus.Healthy)))
        val live = UiState(UiPhase.Content, data = window, fetchedAt = STAMP)
        assertEquals(UptimeHeatmapFreshness.Live, UptimeHeatmapProjection.freshness(live))

        val stale = UiState(UiPhase.Content, data = window, fetchedAt = STAMP, stale = true, refreshing = true)
        assertEquals(UptimeHeatmapFreshness.Stale, UptimeHeatmapProjection.freshness(stale))

        val offline = UiState(UiPhase.Content, data = window, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network)
        assertEquals(UptimeHeatmapFreshness.Offline, UptimeHeatmapProjection.freshness(offline))
    }

    @Test
    fun queryErrorKindMapsEveryFailureBucket() {
        assertEquals(QueryErrorKind.Waiting, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.CircuitOpen)))
        assertEquals(QueryErrorKind.Network, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Timeout)))
        assertEquals(QueryErrorKind.Unauthorized, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Http, status = 401)))
        assertEquals(QueryErrorKind.Unauthorized, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Http, status = 403)))
        assertEquals(QueryErrorKind.NotFound, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Http, status = 404)))
        assertEquals(QueryErrorKind.ServerError, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Http, status = 500)))
        assertEquals(QueryErrorKind.ServerError, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Decode)))
        assertEquals(QueryErrorKind.ServerError, UptimeHeatmapProjection.queryErrorKind(error(ErrorKind.Unknown)))
    }

    @Test
    fun headingDayAndUptimeTemplatesInterpolate() {
        val labels = strings()
        assertEquals("Uptime — last 30 days", labels.heading(30))
        assertEquals("Uptime — last 0 days", labels.heading(0))
        assertEquals("2026-05-01: Operational", labels.dayLabel("2026-05-01", UptimeStatus.Healthy))
        assertEquals("Outage", labels.statusLabel(UptimeStatus.Unhealthy))
        assertEquals("99.50% uptime", labels.uptimeCaption("99.50%"))
    }

    @Test
    fun stringsExposeAccessibilityLabelsForEveryStatusAndLandmark() {
        val labels = strings()
        assertTrue(labels.hasAccessibilityLabels)
        UptimeStatus.entries.forEach { assertTrue(labels.statusLabel(it).isNotBlank()) }

        assertFalse(labels.copy(surfaceLabel = "").hasAccessibilityLabels)
        assertFalse(labels.copy(listLabel = "").hasAccessibilityLabels)
        assertFalse(labels.copy(statusLabels = labels.statusLabels - UptimeStatus.Unknown).hasAccessibilityLabels)
    }

    @Test
    fun registrationPinsTheDiagnosticsSlugAndThresholds() {
        assertEquals("UptimeHeatmap", UptimeHeatmapRegistration.SLUG)
        assertEquals(99.0, UptimeHeatmapRegistration.GOOD_THRESHOLD, EPSILON)
        assertEquals(95.0, UptimeHeatmapRegistration.WARN_THRESHOLD, EPSILON)
    }

    private fun day(status: UptimeStatus): UptimeDay = UptimeDay(date = "2026-05-01", status = status)

    private fun error(
        kind: ErrorKind,
        status: Int? = null,
    ): UiState<UptimeWindow> = UiState(UiPhase.Error, errorKind = kind, httpStatus = status)

    private fun strings(): UptimeHeatmapStrings =
        UptimeHeatmapStrings(
            titleTemplate = "Uptime — last %1\$s days",
            uptimeTemplate = "%1\$s uptime",
            listLabel = "Daily status history",
            dayLabelTemplate = "%1\$s: %2\$s",
            surfaceLabel = "Uptime — daily status heatmap",
            statusLabels =
                mapOf(
                    UptimeStatus.Healthy to "Operational",
                    UptimeStatus.Degraded to "Degraded",
                    UptimeStatus.Unhealthy to "Outage",
                    UptimeStatus.Unknown to "Unknown",
                    UptimeStatus.Maintenance to "Maintenance",
                ),
            emptyTitle = "No uptime data",
            emptyMessage = "No status history to show yet.",
            resourceName = "Uptime history",
            stale = "Stale",
            offline = "Offline",
            loadingLabel = "Loading",
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val EPSILON = 1e-6
    }
}
