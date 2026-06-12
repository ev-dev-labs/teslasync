// Off-device unit coverage for the AutomationActivityFeed feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the status/event raw-union parsing, the status/event → glyph+accent
// classification (the web `statusConfig` / `typeMap` switches incl. their fallbacks), the history/live/stats
// projections (the web `HistoryRow` / `LiveEventRow` / header derivations), the duration + percent + relative
// "time ago" formatters (web `formatDurationMs` / `fmtPercent` / `timeAgo`), the top-level history-surface
// classifier the composable switches on (per-state coverage incl. stale/offline), the i18n key mirrors
// (a11y/label coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationactivityfeed

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

class AutomationActivityFeedModelTest {
    private val now: Long = Instant.parse("2023-11-14T22:05:00Z").toEpochMilli()

    private val formatTimeAgo: (String) -> String = { iso -> "T:$iso" }
    private val formatDuration: (Long?) -> String = { ms -> "D:${ms ?: "null"}" }
    private val formatPercent: (Double) -> String = { pct -> "P:$pct" }

    private fun entry() =
        AutomationHistoryEntry(
            id = 1,
            automationName = "Automation",
            status = AutomationRunStatus.Success,
            error = null,
            triggeredAt = "2023-11-14T22:00:00Z",
            durationMs = 1500,
            actionsSucceeded = 2,
            actionsTotal = 3,
        )

    private fun event() =
        AutomationLiveEvent(
            id = "ae-1",
            type = AutomationEventType.Triggered,
            name = "Automation",
            automationId = 7,
            error = null,
            reason = null,
        )

    // ── raw enum mapping (web string-union parsing) ──

    @Test
    fun runStatusFromRawMatchesWebUnionAndFoldsUnknownToRunning() {
        assertEquals(AutomationRunStatus.Success, AutomationRunStatus.fromRaw("success"))
        assertEquals(AutomationRunStatus.Partial, AutomationRunStatus.fromRaw("PARTIAL"))
        assertEquals(AutomationRunStatus.Failed, AutomationRunStatus.fromRaw(" failed "))
        assertEquals(AutomationRunStatus.Skipped, AutomationRunStatus.fromRaw("skipped"))
        assertEquals(AutomationRunStatus.Cancelled, AutomationRunStatus.fromRaw("cancelled"))
        assertEquals(AutomationRunStatus.Test, AutomationRunStatus.fromRaw("test"))
        assertEquals(AutomationRunStatus.Undo, AutomationRunStatus.fromRaw("undo"))
        assertEquals(AutomationRunStatus.Running, AutomationRunStatus.fromRaw("running"))
        // Web `statusConfig[status] ?? statusConfig.running` — unknown folds to running.
        assertEquals(AutomationRunStatus.Running, AutomationRunStatus.fromRaw("mystery"))
    }

    @Test
    fun eventTypeFromRawToleratesWireFormAndFoldsUnknownToTriggered() {
        assertEquals(AutomationEventType.Triggered, AutomationEventType.fromRaw("automation.triggered"))
        assertEquals(AutomationEventType.Succeeded, AutomationEventType.fromRaw("succeeded"))
        assertEquals(AutomationEventType.Failed, AutomationEventType.fromRaw("automation.failed"))
        assertEquals(AutomationEventType.Skipped, AutomationEventType.fromRaw("automation.skipped"))
        assertEquals(AutomationEventType.StateChanged, AutomationEventType.fromRaw("automation.state_changed"))
        // Web `typeMap[type] ?? typeMap['automation.triggered']` — unknown folds to triggered.
        assertEquals(AutomationEventType.Triggered, AutomationEventType.fromRaw("automation.exploded"))
    }

    @Test
    fun eventTypeWireSuffixMatchesWebBadgeLabel() {
        // Web `event.type.replace('automation.', '')`.
        assertEquals("triggered", AutomationEventType.Triggered.wireSuffix)
        assertEquals("succeeded", AutomationEventType.Succeeded.wireSuffix)
        assertEquals("failed", AutomationEventType.Failed.wireSuffix)
        assertEquals("skipped", AutomationEventType.Skipped.wireSuffix)
        assertEquals("state_changed", AutomationEventType.StateChanged.wireSuffix)
    }

    // ── glyph + accent classification (web statusConfig / typeMap) ──

    @Test
    fun statusGlyphMirrorsTheWebStatusConfigIcons() {
        val proj = AutomationActivityFeedProjection
        assertEquals(AutomationGlyph.CheckCircle, proj.statusGlyph(AutomationRunStatus.Success))
        assertEquals(AutomationGlyph.CheckCircle, proj.statusGlyph(AutomationRunStatus.Partial))
        assertEquals(AutomationGlyph.XCircle, proj.statusGlyph(AutomationRunStatus.Failed))
        assertEquals(AutomationGlyph.SkipForward, proj.statusGlyph(AutomationRunStatus.Skipped))
        assertEquals(AutomationGlyph.XCircle, proj.statusGlyph(AutomationRunStatus.Cancelled))
        assertEquals(AutomationGlyph.Bolt, proj.statusGlyph(AutomationRunStatus.Test))
        assertEquals(AutomationGlyph.Clock, proj.statusGlyph(AutomationRunStatus.Undo))
        assertEquals(AutomationGlyph.Activity, proj.statusGlyph(AutomationRunStatus.Running))
    }

    @Test
    fun statusAccentMirrorsTheWebStatusConfigColors() {
        val proj = AutomationActivityFeedProjection
        assertEquals(AutomationAccent.Success, proj.statusAccent(AutomationRunStatus.Success))
        assertEquals(AutomationAccent.Warning, proj.statusAccent(AutomationRunStatus.Partial))
        assertEquals(AutomationAccent.Danger, proj.statusAccent(AutomationRunStatus.Failed))
        assertEquals(AutomationAccent.Muted, proj.statusAccent(AutomationRunStatus.Skipped))
        assertEquals(AutomationAccent.Muted, proj.statusAccent(AutomationRunStatus.Cancelled))
        assertEquals(AutomationAccent.Test, proj.statusAccent(AutomationRunStatus.Test))
        assertEquals(AutomationAccent.StateChange, proj.statusAccent(AutomationRunStatus.Undo))
        assertEquals(AutomationAccent.Running, proj.statusAccent(AutomationRunStatus.Running))
    }

    @Test
    fun eventGlyphAndAccentMirrorTheWebTypeMap() {
        val proj = AutomationActivityFeedProjection
        assertEquals(AutomationGlyph.Bolt, proj.eventGlyph(AutomationEventType.Triggered))
        assertEquals(AutomationGlyph.CheckCircle, proj.eventGlyph(AutomationEventType.Succeeded))
        assertEquals(AutomationGlyph.XCircle, proj.eventGlyph(AutomationEventType.Failed))
        assertEquals(AutomationGlyph.SkipForward, proj.eventGlyph(AutomationEventType.Skipped))
        assertEquals(AutomationGlyph.Activity, proj.eventGlyph(AutomationEventType.StateChanged))

        assertEquals(AutomationAccent.Test, proj.eventAccent(AutomationEventType.Triggered))
        assertEquals(AutomationAccent.Success, proj.eventAccent(AutomationEventType.Succeeded))
        assertEquals(AutomationAccent.Danger, proj.eventAccent(AutomationEventType.Failed))
        assertEquals(AutomationAccent.Muted, proj.eventAccent(AutomationEventType.Skipped))
        assertEquals(AutomationAccent.StateChange, proj.eventAccent(AutomationEventType.StateChanged))
    }

    // ── liveDisplayName (web `'name' in data ? name : '#'+id`) ──

    @Test
    fun liveDisplayNamePrefersNameElseFallsBackToHashId() {
        val proj = AutomationActivityFeedProjection
        assertEquals("My automation", proj.liveDisplayName(event().copy(name = "My automation", automationId = 9)))
        assertEquals("#9", proj.liveDisplayName(event().copy(name = null, automationId = 9)))
        assertEquals("#9", proj.liveDisplayName(event().copy(name = "   ", automationId = 9)))
        assertEquals("#", proj.liveDisplayName(event().copy(name = null, automationId = null)))
    }

    // ── projectHistory — the adapter (cached entries → render-ready rows) ──

    @Test
    fun projectHistoryMapsEntriesPreservingOrderWithGlyphAccentAndMeta() {
        val rows =
            AutomationActivityFeedProjection.projectHistory(
                entries =
                    listOf(
                        entry().copy(id = 1, automationName = "A", status = AutomationRunStatus.Success, durationMs = 1500),
                        entry().copy(
                            id = 2,
                            automationName = "B",
                            status = AutomationRunStatus.Failed,
                            error = "boom",
                            durationMs = null,
                            actionsTotal = 0,
                        ),
                    ),
                formatTimeAgo = formatTimeAgo,
                formatDuration = formatDuration,
            )
        assertEquals(2, rows.size)
        assertEquals(listOf(1L, 2L), rows.map { it.id })
        assertEquals(
            AutomationHistoryRow(
                id = 1,
                name = "A",
                error = null,
                timeAgo = "T:2023-11-14T22:00:00Z",
                duration = "D:1500",
                actionsLabel = "2/3",
                glyph = AutomationGlyph.CheckCircle,
                accent = AutomationAccent.Success,
            ),
            rows[0],
        )
        assertEquals(
            AutomationHistoryRow(
                id = 2,
                name = "B",
                error = "boom",
                timeAgo = "T:2023-11-14T22:00:00Z",
                duration = "D:null",
                actionsLabel = null,
                glyph = AutomationGlyph.XCircle,
                accent = AutomationAccent.Danger,
            ),
            rows[1],
        )
    }

    @Test
    fun projectHistoryBlanksAnEmptyErrorAndDropsZeroActionLabel() {
        val rows =
            AutomationActivityFeedProjection.projectHistory(
                entries = listOf(entry().copy(error = "   ", actionsTotal = 0)),
                formatTimeAgo = formatTimeAgo,
                formatDuration = formatDuration,
            )
        assertNull(rows.single().error)
        assertNull(rows.single().actionsLabel)
    }

    @Test
    fun projectHistoryTreatsEmptyAsTheEmptyState() {
        assertTrue(
            AutomationActivityFeedProjection
                .projectHistory(emptyList(), formatTimeAgo, formatDuration)
                .isEmpty(),
        )
    }

    // ── projectLive — first five, render-ready (web `liveEvents.slice(0, 5)`) ──

    @Test
    fun projectLiveKeepsAtMostFivePreservingOrderWithBadgeGlyphAccent() {
        val events = (1..8).map { event().copy(id = "ae-$it", name = "n$it", automationId = it.toLong()) }
        val rows = AutomationActivityFeedProjection.projectLive(events)
        assertEquals(AutomationActivityFeedProjection.LIVE_LIMIT, rows.size)
        assertEquals(listOf("ae-1", "ae-2", "ae-3", "ae-4", "ae-5"), rows.map { it.id })
        val first = rows.first()
        assertEquals("n1", first.name)
        assertEquals("triggered", first.badgeLabel)
        assertEquals(AutomationGlyph.Bolt, first.glyph)
        assertEquals(AutomationAccent.Test, first.accent)
    }

    @Test
    fun projectLiveCarriesErrorAndReasonSpansBlankedToNull() {
        val rows =
            AutomationActivityFeedProjection.projectLive(
                listOf(
                    event().copy(id = "f", type = AutomationEventType.Failed, error = "down", reason = null),
                    event().copy(id = "s", type = AutomationEventType.Skipped, error = "  ", reason = "condition not met"),
                ),
            )
        assertEquals("down", rows[0].error)
        assertNull(rows[0].reason)
        assertNull(rows[1].error)
        assertEquals("condition not met", rows[1].reason)
    }

    // ── projectStats — the header guard (web `historyStats && total_executions > 0`) ──

    @Test
    fun projectStatsReturnsNullWhenAbsentOrZeroTotal() {
        assertNull(AutomationActivityFeedProjection.projectStats(null, formatDuration, formatPercent))
        assertNull(
            AutomationActivityFeedProjection.projectStats(
                AutomationHistoryStatsModel(totalExecutions = 0, successRate = 100.0, avgDurationMs = 10),
                formatDuration,
                formatPercent,
            ),
        )
    }

    @Test
    fun projectStatsFormatsTotalRateAndAverage() {
        val row =
            AutomationActivityFeedProjection.projectStats(
                AutomationHistoryStatsModel(totalExecutions = 128, successRate = 94.0, avgDurationMs = 2000),
                formatDuration,
                formatPercent,
            )
        requireNotNull(row)
        // Web renders the raw count, the formatted percent, and the formatted duration.
        assertEquals("128", row.total)
        assertEquals("P:94.0", row.successRate)
        assertEquals("D:2000", row.avgDuration)
    }

    // ── formatDurationMs (web parity) ──

    @Test
    fun formatDurationMsMirrorsTheWebHelper() {
        assertEquals(EM_DASH, formatDurationMs(null))
        assertEquals("250ms", formatDurationMs(250))
        assertEquals("999ms", formatDurationMs(999))
        assertEquals("1.0s", formatDurationMs(1000))
        assertEquals("1.5s", formatDurationMs(1500))
        assertEquals("2.0s", formatDurationMs(2000))
    }

    // ── formatPercentInt (web fmtPercent parity) ──

    @Test
    fun formatPercentIntRoundsToWholePercentAndGuardsNonFinite() {
        assertEquals("94%", formatPercentInt(94.0, Locale.US))
        assertEquals("85%", formatPercentInt(85.4, Locale.US))
        assertEquals("86%", formatPercentInt(85.6, Locale.US))
        assertEquals("0%", formatPercentInt(0.0, Locale.US))
        // Web `safeNumber` folds NaN/Infinity to 0.
        assertEquals("0%", formatPercentInt(Double.NaN, Locale.US))
        assertEquals("0%", formatPercentInt(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── relative "time ago" (web timeAgo buckets) ──

    @Test
    fun relativeAgeBucketsExactlyLikeTheWebTimeAgo() {
        val t = AutomationTimeFormatting
        assertEquals(FreshnessAge.Unknown, t.relativeAge(null))
        assertEquals(FreshnessAge.JustNow, t.relativeAge(0))
        assertEquals(FreshnessAge.JustNow, t.relativeAge(-30))
        assertEquals(FreshnessAge.JustNow, t.relativeAge(59))
        assertEquals(FreshnessAge.Minutes(1), t.relativeAge(60))
        assertEquals(FreshnessAge.Minutes(59), t.relativeAge(3599))
        assertEquals(FreshnessAge.Hours(1), t.relativeAge(3600))
        assertEquals(FreshnessAge.Hours(23), t.relativeAge(86399))
        assertEquals(FreshnessAge.Days(1), t.relativeAge(86400))
        assertEquals(FreshnessAge.Days(3), t.relativeAge(3 * 86400))
    }

    @Test
    fun ageSecondsIsTolerantAndGuardsInvalidInput() {
        val t = AutomationTimeFormatting
        assertEquals(300L, t.ageSeconds("2023-11-14T22:00:00Z", now))
        // A zoneless local date-time is tolerated (treated as UTC).
        assertEquals(300L, t.ageSeconds("2023-11-14T22:00:00", now))
        // A future stamp yields a negative age (web diff is negative → "just now" after bucketing).
        assertTrue(t.ageSeconds("2023-11-14T22:10:00Z", now)!! < 0)
        assertEquals(FreshnessAge.JustNow, t.relativeAge(t.ageSeconds("2023-11-14T22:10:00Z", now)))
        // Blank / unparseable inputs yield null (em-dash at the boundary).
        assertNull(t.ageSeconds("", now))
        assertNull(t.ageSeconds("   ", now))
        assertNull(t.ageSeconds("not-a-date", now))
    }

    // ── per-state lifecycle classifier ──

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(AutomationHistorySurface.Loading, automationHistorySurfaceFor(isLoading = true, isError = false))
        assertEquals(AutomationHistorySurface.Error, automationHistorySurfaceFor(isLoading = false, isError = true))
        // Loading wins over error so a refresh-with-skeleton never flashes the error surface.
        assertEquals(AutomationHistorySurface.Loading, automationHistorySurfaceFor(isLoading = true, isError = true))
        assertEquals(AutomationHistorySurface.Ready, automationHistorySurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(AutomationHistorySurface.Loading, surfaceFor(UiState.loading<AutomationActivityData>()))
        val error = UiState<AutomationActivityData>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(AutomationHistorySurface.Error, surfaceFor(error))
        val content = UiState(UiPhase.Content, data = AutomationActivityData(listOf(entry()), null))
        assertEquals(AutomationHistorySurface.Ready, surfaceFor(content))
        val empty = UiState(UiPhase.Empty, data = AutomationActivityData(emptyList(), null))
        assertEquals(AutomationHistorySurface.Ready, surfaceFor(empty))
        // Stale/offline "last known" stays on the Ready surface (cached rows + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = AutomationActivityData(listOf(entry()), null),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(AutomationHistorySurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── a11y / i18n key mirrors (every web `t('automations.*')` key) ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_automations_recentActivity", KEY_RECENT_ACTIVITY)
        assertEquals("translation_automations_live", KEY_LIVE)
        assertEquals("translation_automations_reconnecting", KEY_RECONNECTING)
        assertEquals("translation_automations_totalRuns", KEY_TOTAL_RUNS)
        assertEquals("translation_automations_successRate", KEY_SUCCESS_RATE)
        assertEquals("translation_automations_avgDuration", KEY_AVG_DURATION)
        assertEquals("translation_automations_noHistory", KEY_NO_HISTORY)
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("AutomationActivityFeed", AutomationActivityFeedRegistration.SLUG)
        assertEquals("automation-activity-feed", AutomationActivityFeedRegistration.ID)
    }

    // ── diagnostics (P1/S11 view.opened contract) ──

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordAutomationActivityFeedOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AutomationActivityFeed"), fields)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `AutomationActivityFeedContent` does. */
    private fun surfaceFor(state: UiState<*>): AutomationHistorySurface =
        automationHistorySurfaceFor(isLoading = state.isLoading, isError = state.isError)

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
