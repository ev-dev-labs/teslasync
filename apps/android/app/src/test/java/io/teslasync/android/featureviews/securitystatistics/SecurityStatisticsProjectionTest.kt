package io.teslasync.android.featureviews.securitystatistics

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SecurityStatistics pure projection — the native port of the web
 * component's `(securityStats, sentryUptime, isLoading)` render contract
 * (web/src/features/admin/components/security-access/SecurityStatistics.tsx): the `isLoading ? skeletons :
 * securityStats ? cards : empty` lifecycle adapter, the ordered seven-metric value list with the web
 * `fmtInt` formatting (incl. the Sentry-uptime "%" suffix and `halfExpand` rounding), and the PII-safe
 * `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate; no Compose, no device.
 */
class SecurityStatisticsProjectionTest {
    private val stats =
        SecurityStats(
            lockEvents = 42,
            doorOpenCount = 8,
            windowOpenCount = 3,
            homelinkCount = 17,
            guestCount = 2,
            total = 1234,
        )

    private fun snapshot(sentryUptimePct: Double = 87.0): SecurityStatsSnapshot = SecurityStatsSnapshot(stats, sentryUptimePct)

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

    // ── (snapshot, isLoading) → lifecycle UiState adapter (web's loading/content/empty ternary) ─────────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        // Web parity: `isLoading ? skeletons : …` — loading wins even if a snapshot is already cached.
        val state = SecurityStatisticsProjection.projectUiState(snapshot(), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val snap = snapshot()
        val state = SecurityStatisticsProjection.projectUiState(snap, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snap, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = SecurityStatisticsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun loadingWhenNoSnapshotAndLoading() {
        val state = SecurityStatisticsProjection.projectUiState(snapshot = null, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    // ── metricValues: order, formatting, Sentry "%" suffix (web's seven MetricCards) ───────────────────

    @Test
    fun metricValuesAreInWebSourceOrder() {
        val order = SecurityStatisticsProjection.metricValues(snapshot(), Locale.US).map { it.metric }
        assertEquals(
            listOf(
                SecurityMetric.LockEvents,
                SecurityMetric.SentryUptime,
                SecurityMetric.DoorOpens,
                SecurityMetric.WindowOpens,
                SecurityMetric.Homelink,
                SecurityMetric.GuestMode,
                SecurityMetric.TotalEvents,
            ),
            order,
        )
    }

    @Test
    fun metricValuesFormatEachCount() {
        val byMetric = SecurityStatisticsProjection.metricValues(snapshot(), Locale.US).associate { it.metric to it.value }
        assertEquals("42", byMetric[SecurityMetric.LockEvents])
        assertEquals("8", byMetric[SecurityMetric.DoorOpens])
        assertEquals("3", byMetric[SecurityMetric.WindowOpens])
        assertEquals("17", byMetric[SecurityMetric.Homelink])
        assertEquals("2", byMetric[SecurityMetric.GuestMode])
        // The total carries grouped thousands (web `fmtInt`).
        assertEquals("1,234", byMetric[SecurityMetric.TotalEvents])
    }

    @Test
    fun sentryUptimeCarriesPercentSuffix() {
        val value =
            SecurityStatisticsProjection
                .metricValues(snapshot(sentryUptimePct = 87.0), Locale.US)
                .single { it.metric == SecurityMetric.SentryUptime }
                .value
        assertEquals("87%", value)
    }

    @Test
    fun sentryUptimeRoundsHalfAwayFromZero() {
        // Web `fmtInt` (Intl `halfExpand`): 87.5 → "88", not banker's-rounded "88"/"87" ambiguity.
        val up =
            SecurityStatisticsProjection
                .metricValues(snapshot(sentryUptimePct = 87.5), Locale.US)
                .single { it.metric == SecurityMetric.SentryUptime }
                .value
        assertEquals("88%", up)
        val down =
            SecurityStatisticsProjection
                .metricValues(snapshot(sentryUptimePct = 87.4), Locale.US)
                .single { it.metric == SecurityMetric.SentryUptime }
                .value
        assertEquals("87%", down)
    }

    // ── formatCount: grouping + half-up rounding (web `fmtInt`) ─────────────────────────────────────────

    @Test
    fun formatCountGroupsThousands() {
        assertEquals("12,345", SecurityStatisticsProjection.formatCount(12345.0, Locale.US))
        assertEquals("0", SecurityStatisticsProjection.formatCount(0.0, Locale.US))
    }

    @Test
    fun formatCountRoundsHalfUp() {
        assertEquals("12,346", SecurityStatisticsProjection.formatCount(12345.6, Locale.US))
        assertEquals("3", SecurityStatisticsProjection.formatCount(2.5, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordSecurityStatisticsOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SecurityStatistics"), opened.single().second)
        assertEquals("SecurityStatistics", SECURITY_STATISTICS_SLUG)
    }
}
