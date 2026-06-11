package io.teslasync.android.featureviews.queuestatuspanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueStat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the QueueStatusPanel's pure projection — the native port of the web component's
 * render contract (web/src/features/admin/components/QueueStatusPanel.tsx): the
 * `(workers, isLoading, error)` → lifecycle [UiPhase] adapter and its precedence, the heartbeat-severity
 * classification (incl. the unknown-band fallback), the queue-depth total + bar maximum, the `oldest_pending`
 * gate, the `formatDurationMsLong` duration string, the locale-grouped count formatter, the tolerant
 * ISO-8601 parse, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate;
 * no Compose, no device.
 */
class QueueStatusPanelProjectionTest {
    @Suppress("LongParameterList")
    private fun worker(
        worker: String = "notification",
        pending: Long = 0L,
        inProgress: Long = 0L,
        succeeded24h: Long = 0L,
        failed24h: Long = 0L,
        oldestPendingAgeSeconds: Long = 0L,
        severity: String = "ok",
        heartbeatDetail: String = "",
        lastHeartbeatAt: String? = null,
        host: String = "",
        version: String = "",
    ): QueueStat =
        QueueStat(
            worker = worker,
            displayName = "$worker worker",
            pending = pending,
            inProgress = inProgress,
            succeeded24h = succeeded24h,
            failed24h = failed24h,
            oldestPendingAgeSeconds = oldestPendingAgeSeconds,
            heartbeatSeverity = severity,
            heartbeatDetail = heartbeatDetail,
            lastHeartbeatAt = lastHeartbeatAt,
            host = host,
            version = version,
        )

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── Heartbeat-severity classification (web SEVERITY_* record keys) ────────────────────────────────

    @Test
    fun severityMapsEveryKnownBand() {
        assertEquals(QueueSeverity.Ok, QueueStatusPanelProjection.severityOf("ok"))
        assertEquals(QueueSeverity.Warn, QueueStatusPanelProjection.severityOf("warn"))
        assertEquals(QueueSeverity.Critical, QueueStatusPanelProjection.severityOf("critical"))
        assertEquals(QueueSeverity.Down, QueueStatusPanelProjection.severityOf("down"))
    }

    @Test
    fun unknownSeverityClassifiesAsDown() {
        assertEquals(QueueSeverity.Down, QueueStatusPanelProjection.severityOf("some_future_band"))
        assertEquals(QueueSeverity.Down, QueueStatusPanelProjection.severityOf(""))
    }

    // ── Queue depth total + bar maximum (web pending + in_progress, max = total>0?total:1) ────────────

    @Test
    fun totalSumsPendingAndInProgress() {
        assertEquals(7L, QueueStatusPanelProjection.total(worker(pending = 5, inProgress = 2)))
    }

    @Test
    fun metricMaxIsTotalWhenPositive() {
        assertEquals(7L, QueueStatusPanelProjection.metricMax(worker(pending = 5, inProgress = 2)))
    }

    @Test
    fun metricMaxIsOneWhenQueueEmpty() {
        assertEquals(1L, QueueStatusPanelProjection.metricMax(worker(pending = 0, inProgress = 0)))
    }

    // ── oldest_pending gate + host/heartbeat truthiness ───────────────────────────────────────────────

    @Test
    fun showOldestPendingOnlyWhenPositive() {
        assertTrue(QueueStatusPanelProjection.showOldestPending(1))
        assertFalse(QueueStatusPanelProjection.showOldestPending(0))
        assertFalse(QueueStatusPanelProjection.showOldestPending(-5))
    }

    @Test
    fun hasHeartbeatTracksTimestampPresence() {
        assertTrue(QueueStatusPanelProjection.hasHeartbeat("2026-06-11T12:00:00Z"))
        assertFalse(QueueStatusPanelProjection.hasHeartbeat(null))
        assertFalse(QueueStatusPanelProjection.hasHeartbeat(""))
        assertFalse(QueueStatusPanelProjection.hasHeartbeat("   "))
    }

    @Test
    fun hasHostTracksHostPresence() {
        assertTrue(QueueStatusPanelProjection.hasHost("worker-01"))
        assertFalse(QueueStatusPanelProjection.hasHost(""))
        assertFalse(QueueStatusPanelProjection.hasHost("   "))
    }

    // ── (workers, isLoading, error) → lifecycle UiState adapter + web branch precedence ──────────────

    @Test
    fun loadingWhenFirstLoad() {
        val state = QueueStatusPanelProjection.projectUiState(emptyList(), "", isLoading = true, isFetching = true, error = false)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
        assertTrue(state.refreshing)
    }

    @Test
    fun loadingTakesPrecedenceOverError() {
        // Web parity: the body is `isLoading ? spinner : error ? alert : …`, so loading wins.
        val state =
            QueueStatusPanelProjection.projectUiState(
                listOf(worker()),
                "2026-06-11T12:00:00Z",
                isLoading = true,
                isFetching = false,
                error = true,
            )
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun errorWhenErrorAndNotLoading() {
        val state =
            QueueStatusPanelProjection.projectUiState(emptyList(), "", isLoading = false, isFetching = false, error = true)
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Unknown, state.errorKind)
        assertTrue(state.hasError)
    }

    @Test
    fun errorTakesPrecedenceOverContent() {
        // Web parity: the error branch replaces the body entirely, even when worker rows exist.
        val state =
            QueueStatusPanelProjection.projectUiState(
                listOf(worker()),
                "2026-06-11T12:00:00Z",
                isLoading = false,
                isFetching = false,
                error = true,
            )
        assertEquals(UiPhase.Error, state.phase)
    }

    @Test
    fun emptyWhenNoWorkersAndNoError() {
        val state =
            QueueStatusPanelProjection.projectUiState(
                emptyList(),
                "2026-06-11T12:00:00Z",
                isLoading = false,
                isFetching = false,
                error = false,
            )
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
        assertEquals(emptyList<QueueStat>(), state.data?.workers)
    }

    @Test
    fun contentWhenWorkersPresent() {
        val workers = listOf(worker(worker = "export"), worker(worker = "automation"))
        val state =
            QueueStatusPanelProjection.projectUiState(workers, "2026-06-11T12:00:00Z", isLoading = false, isFetching = false, error = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(workers, state.data?.workers)
    }

    @Test
    fun fetchingIsCarriedAsRefreshingOnContent() {
        val state =
            QueueStatusPanelProjection.projectUiState(
                listOf(worker()),
                "2026-06-11T12:00:00Z",
                isLoading = false,
                isFetching = true,
                error = false,
            )
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
    }

    @Test
    fun generatedAtIsParsedIntoFetchedAt() {
        val state =
            QueueStatusPanelProjection.projectUiState(
                listOf(worker()),
                "2026-06-11T12:00:00Z",
                isLoading = false,
                isFetching = false,
                error = false,
            )
        assertEquals(QueueStatusPanelProjection.parseIsoMillis("2026-06-11T12:00:00Z"), state.fetchedAt)
    }

    // ── Locale-grouped count (web fmtNumber) ──────────────────────────────────────────────────────────

    @Test
    fun formatCountGroupsThousands() {
        assertEquals("1,234", QueueStatusPanelProjection.formatCount(1234, Locale.US))
        assertEquals("0", QueueStatusPanelProjection.formatCount(0, Locale.US))
        assertEquals("1,284", QueueStatusPanelProjection.formatCount(1284, Locale.US))
    }

    // ── Duration string (web formatDurationMsLong(oldest_pending_age_seconds * 1000)) ─────────────────

    @Test
    fun durationNonPositiveYieldsEmDash() {
        assertEquals(EM_DASH, QueueStatusPanelProjection.formatDurationMsLong(0))
        assertEquals(EM_DASH, QueueStatusPanelProjection.formatDurationMsLong(-1000))
    }

    @Test
    fun durationSubSecondShowsMillis() {
        assertEquals("500ms", QueueStatusPanelProjection.formatDurationMsLong(500))
    }

    @Test
    fun durationSubMinuteShowsOneDecimalSeconds() {
        assertEquals("45.0s", QueueStatusPanelProjection.formatDurationMsLong(45_000))
        assertEquals("1.5s", QueueStatusPanelProjection.formatDurationMsLong(1_500))
    }

    @Test
    fun durationBeyondMinuteShowsMinutesAndRoundedSeconds() {
        assertEquals("1m 30s", QueueStatusPanelProjection.formatDurationMsLong(90_000))
        assertEquals("61m 1s", QueueStatusPanelProjection.formatDurationMsLong(3_661_000))
    }

    @Test
    fun formatOldestPendingScalesSecondsToMillis() {
        assertEquals("1m 30s", QueueStatusPanelProjection.formatOldestPending(90))
        assertEquals("30.0s", QueueStatusPanelProjection.formatOldestPending(30))
        assertEquals(EM_DASH, QueueStatusPanelProjection.formatOldestPending(0))
    }

    // ── Tolerant ISO-8601 → epoch-millis parse ────────────────────────────────────────────────────────

    @Test
    fun parsesRfc3339Instant() {
        val expected = Instant.parse("2026-05-31T00:00:00Z").toEpochMilli()
        assertEquals(expected, QueueStatusPanelProjection.parseIsoMillis("2026-05-31T00:00:00Z"))
    }

    @Test
    fun parsesOffsetDateTime() {
        // 12:00:00+02:00 == 10:00:00Z
        assertEquals(
            QueueStatusPanelProjection.parseIsoMillis("2026-06-11T10:00:00Z"),
            QueueStatusPanelProjection.parseIsoMillis("2026-06-11T12:00:00+02:00"),
        )
    }

    @Test
    fun parsesZonelessLocalDateTimeAsUtc() {
        assertEquals(
            QueueStatusPanelProjection.parseIsoMillis("2026-06-11T12:00:00Z"),
            QueueStatusPanelProjection.parseIsoMillis("2026-06-11T12:00:00"),
        )
    }

    @Test
    fun blankOrUnparseableTimestampYieldsNull() {
        assertNull(QueueStatusPanelProjection.parseIsoMillis(null))
        assertNull(QueueStatusPanelProjection.parseIsoMillis(""))
        assertNull(QueueStatusPanelProjection.parseIsoMillis("   "))
        assertNull(QueueStatusPanelProjection.parseIsoMillis("not-a-timestamp"))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordQueueStatusPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "QueueStatusPanel"), opened.single().second)
        assertEquals("QueueStatusPanel", QUEUE_STATUS_PANEL_SLUG)
    }
}
