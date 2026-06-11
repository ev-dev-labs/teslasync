package io.teslasync.android.dashboardwidgets.notificationstats

import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Pure unit tests for the Notification Stats model + projection — the data adapter the prompt
 * requires. Covers the delivery-rate derivation, the four-tile `coreStats` projection (values,
 * units, trend chips, the failed-danger flag), the newest-first recent-log cap, status→badge
 * mapping, relative-time bucketing, the TalkBack row description, the per-state surface decision
 * (the loading/error/empty branches the snapshot/UI test renders), the error-kind mapping, and the
 * registry metadata/bounds. These run in the `:app:testReleaseUnitTest` gate with no device.
 */
class NotificationStatsWidgetModelTest {
    private val locale = Locale.US

    private fun stats(
        totalSent: Long = 0,
        sent: Long = 0,
        failed: Long = 0,
        enabledChannels: Long = 0,
    ): NotificationStats = NotificationStats(totalSent = totalSent, sent = sent, failed = failed, enabledChannels = enabledChannels)

    // ── Summary: delivery-rate derivation ───────────────────────────────────────

    @Test
    fun summaryComputesDeliveryRateWhenSent() {
        val summary = NotificationStatsSummary.from(stats(totalSent = 200, sent = 196, failed = 4, enabledChannels = 3))
        assertEquals(200L, summary.totalSent)
        assertEquals(196L, summary.sent)
        assertEquals(4L, summary.failed)
        assertEquals(3L, summary.enabledChannels)
        assertEquals(98.0, summary.deliveryRate, TOLERANCE)
    }

    @Test
    fun summaryDeliveryRateIsZeroWhenNothingSent() {
        val summary = NotificationStatsSummary.from(stats(totalSent = 0, sent = 0))
        assertEquals(0.0, summary.deliveryRate, TOLERANCE)
    }

    // ── Adapter: stats → core stat tiles (web coreStats) ─────────────────────────

    @Test
    fun tilesMatchWebCoreStatsOrderValuesAndTrends() {
        val summary = NotificationStatsSummary.from(stats(totalSent = 100, sent = 98, failed = 2, enabledChannels = 3))
        val tiles = NotificationStatsProjection.tiles(summary, locale)

        assertEquals(4, tiles.size)

        assertEquals(NotificationStatKind.TotalSent, tiles[0].kind)
        assertEquals("100", tiles[0].value)
        assertNull(tiles[0].unit)
        assertEquals(
            NotificationStatTrend(DeltaArrow.Up, NotificationStatTrendLabel.Count("100"), positive = true),
            tiles[0].trend,
        )

        assertEquals(NotificationStatKind.DeliveryRate, tiles[1].kind)
        assertEquals("98.0", tiles[1].value)
        assertEquals("%", tiles[1].unit)
        assertEquals(
            NotificationStatTrend(DeltaArrow.Up, NotificationStatTrendLabel.Healthy, positive = true),
            tiles[1].trend,
        )

        assertEquals(NotificationStatKind.Failed, tiles[2].kind)
        assertEquals("2", tiles[2].value)
        assertTrue(tiles[2].danger)
        assertEquals(
            NotificationStatTrend(DeltaArrow.Down, NotificationStatTrendLabel.NeedsAttention, positive = false),
            tiles[2].trend,
        )

        assertEquals(NotificationStatKind.ActiveChannels, tiles[3].kind)
        assertEquals("3", tiles[3].value)
        assertNull(tiles[3].trend)
        assertFalse(tiles[3].danger)
    }

    @Test
    fun tilesDropTrendsAtZeroOrBelowHealthyThreshold() {
        val summary = NotificationStatsSummary.from(stats(totalSent = 10, sent = 5, failed = 0, enabledChannels = 0))
        val tiles = NotificationStatsProjection.tiles(summary, locale)

        // totalSent > 0 → still an up/count trend.
        assertEquals(DeltaArrow.Up, tiles[0].trend?.direction)
        // 50% delivery (< 95) → no "Healthy" trend chip (web `>= 95 ? 'Healthy' : undefined`).
        assertEquals("50.0", tiles[1].value)
        assertNull(tiles[1].trend)
        // failed == 0 → no danger, no trend.
        assertFalse(tiles[2].danger)
        assertNull(tiles[2].trend)
    }

    @Test
    fun tilesAllZeroRenderZeroesWithNoTrends() {
        val tiles = NotificationStatsProjection.tiles(NotificationStatsSummary.from(stats()), locale)
        assertEquals("0", tiles[0].value)
        assertNull(tiles[0].trend)
        assertEquals("0.0", tiles[1].value)
        assertNull(tiles[1].trend)
        assertEquals("0", tiles[2].value)
        assertFalse(tiles[2].danger)
        assertEquals("0", tiles[3].value)
    }

    @Test
    fun formatCountAppliesLocaleGrouping() {
        assertEquals("1,284", NotificationStatsProjection.formatCount(1284, locale))
        assertEquals("98.5", NotificationStatsProjection.formatRate(98.46, locale))
    }

    // ── Adapter: recent delivery log ─────────────────────────────────────────────

    @Test
    fun recentLogsSortNewestFirstAndCapPerLayout() {
        val logs = (1..8).map { NotificationLog(id = it.toLong(), createdAt = "2024-01-%02dT00:00:00Z".format(it)) }
        assertEquals(listOf(8L, 7L, 6L, 5L, 4L), NotificationStatsProjection.recentLogs(logs, compact = false).map { it.id })
        assertEquals(listOf(8L, 7L, 6L), NotificationStatsProjection.recentLogs(logs, compact = true).map { it.id })
    }

    @Test
    fun parseTimestampToleratesZoneVariantsAndRejectsGarbage() {
        val expected = 1_704_067_200_000L
        assertEquals(expected, NotificationStatsProjection.parseTimestampMillis("2024-01-01T00:00:00Z"))
        assertEquals(expected, NotificationStatsProjection.parseTimestampMillis("2024-01-01T00:00:00+00:00"))
        assertEquals(expected, NotificationStatsProjection.parseTimestampMillis("2024-01-01T00:00:00"))
        assertNull(NotificationStatsProjection.parseTimestampMillis(""))
        assertNull(NotificationStatsProjection.parseTimestampMillis("   "))
        assertNull(NotificationStatsProjection.parseTimestampMillis("not-a-timestamp"))
        assertNull(NotificationStatsProjection.parseTimestampMillis(null))
    }

    // ── Status badge + relative time + a11y ──────────────────────────────────────

    @Test
    fun statusVariantMapsWebStatusVariantWithWarningDefault() {
        assertEquals(BadgeVariant.Success, notificationStatusVariant("sent"))
        assertEquals(BadgeVariant.Danger, notificationStatusVariant("failed"))
        assertEquals(BadgeVariant.Warning, notificationStatusVariant("pending"))
        assertEquals(BadgeVariant.Warning, notificationStatusVariant("queued"))
        assertEquals(BadgeVariant.Warning, notificationStatusVariant(""))
    }

    @Test
    fun logTimeBucketsLikeWebFormatLogTime() {
        val now = 1_704_067_200_000L
        assertEquals(NotificationLogTime.JustNow, notificationLogTime(now - 30_000L, now))
        assertEquals(NotificationLogTime.MinutesAgo(5), notificationLogTime(now - 5L * 60_000L, now))
        assertEquals(NotificationLogTime.HoursAgo(2), notificationLogTime(now - 2L * 3_600_000L, now))
        assertEquals(NotificationLogTime.Absolute(now - 3L * 86_400_000L), notificationLogTime(now - 3L * 86_400_000L, now))
        assertEquals(NotificationLogTime.Unknown, notificationLogTime(null, now))
    }

    @Test
    fun rowDescriptionComposesChannelTypeStatusAndTime() {
        val description = notificationLogRowDescription("Email", "Battery low", "sent", "5m ago")
        assertEquals("Email, Battery low, sent, 5m ago", description)
        assertTrue(description.isNotBlank())
    }

    // ── Per-state surface + error-kind mapping ───────────────────────────────────

    @Test
    fun surfaceCombinesStatsAndLogsLikeWebShell() {
        val content = UiState(phase = UiPhase.Content, data = stats(totalSent = 1))
        val emptyLogs = UiState(phase = UiPhase.Content, data = emptyList<NotificationLog>())
        val loadingLogs = UiState<List<NotificationLog>>(phase = UiPhase.Loading)

        assertEquals(
            NotificationStatsSurface.Loading,
            notificationStatsSurface(UiState<NotificationStats>(UiPhase.Loading), emptyLogs, compact = false),
        )
        // Non-compact: a first-load of the logs feed gates the whole panel (web isLoading || logsLoading).
        assertEquals(NotificationStatsSurface.Loading, notificationStatsSurface(content, loadingLogs, compact = false))
        // Compact: the log table is never rendered, so logs loading does not gate (web `isCompact`).
        assertEquals(NotificationStatsSurface.Content, notificationStatsSurface(content, loadingLogs, compact = true))
        assertEquals(
            NotificationStatsSurface.Error,
            notificationStatsSurface(UiState<NotificationStats>(UiPhase.Error, errorKind = ErrorKind.Network), emptyLogs, false),
        )
        assertEquals(
            NotificationStatsSurface.Empty,
            notificationStatsSurface(UiState<NotificationStats>(UiPhase.Empty), emptyLogs, compact = false),
        )
        assertEquals(NotificationStatsSurface.Content, notificationStatsSurface(content, emptyLogs, compact = false))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, notificationStatsErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, notificationStatsErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, notificationStatsErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, notificationStatsErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, notificationStatsErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.ServerError, notificationStatsErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, notificationStatsErrorKind(ErrorKind.Unknown, null))
    }

    // ── Registry + footprint constraints ─────────────────────────────────────────

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("notification-stats", NotificationStatsRegistration.ID)
        assertEquals("alerts", NotificationStatsRegistration.CATEGORY)
        assertEquals("NotificationStatsWidget", NotificationStatsRegistration.SLUG)
        assertEquals(NotificationStatsSize(2, 2), NotificationStatsRegistration.DEFAULT_SIZE)
        assertEquals(NotificationStatsSize(1, 2), NotificationStatsRegistration.MIN_SIZE)
        assertEquals(NotificationStatsSize(4, 40), NotificationStatsRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClampHonourTheFootprint() {
        assertTrue(NotificationStatsRegistration.isWithinBounds(NotificationStatsSize(2, 2)))
        assertFalse(NotificationStatsRegistration.isWithinBounds(NotificationStatsSize(0, 2)))
        assertFalse(NotificationStatsRegistration.isWithinBounds(NotificationStatsSize(2, 41)))
        assertEquals(NotificationStatsSize(1, 2), NotificationStatsRegistration.clamp(NotificationStatsSize(0, 0)))
        assertEquals(NotificationStatsSize(4, 40), NotificationStatsRegistration.clamp(NotificationStatsSize(9, 99)))
    }

    @Test
    fun sizeDerivesCompactAndWide() {
        assertTrue(NotificationStatsSize(1, 2).isCompact)
        assertFalse(NotificationStatsSize(2, 2).isCompact)
        assertTrue(NotificationStatsSize(3, 2).isWide)
        assertTrue(NotificationStatsSize(4, 4).isWide)
        assertFalse(NotificationStatsSize(2, 2).isWide)
    }

    private companion object {
        const val TOLERANCE = 0.0001
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_SERVER_ERROR = 500
    }
}
