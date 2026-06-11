package io.teslasync.android.dashboard.widgets.automationhistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.automations.AutomationHistory
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationHistoryStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AutomationHistoryWidget's pure logic — the status→presentation map, the
 * duration formatter, the number/int formatters, the projection (success-rate text/tone, run-feed
 * sort+cap+subtitle+a11y, compact hero), the registry metadata, and the tolerant timestamp parse. Mirrors
 * the web spec (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx) and the WinUI parity tests.
 */
class AutomationHistoryProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): AutomationHistoryStrings =
        AutomationHistoryStrings(
            title = "Automation History",
            successRateLabel = "Success Rate",
            runsWord = "runs",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    private fun run(
        id: Long = 1,
        status: String = "success",
        automationName: String = "Morning Charge",
        durationMs: Long? = 1_500,
        triggeredAt: String = "2026-06-06T12:00:00Z",
    ): AutomationHistory =
        AutomationHistory(
            id = id,
            automationId = 7,
            automationName = automationName,
            triggeredAt = triggeredAt,
            durationMs = durationMs,
            status = status,
        )

    private fun snapshot(
        summary: AutomationHistoryStats = AutomationHistoryStats(totalExecutions = 120, successRate = 91.5),
        vararg runs: AutomationHistory,
    ): AutomationHistoryListResponse = AutomationHistoryListResponse(items = runs.toList(), summary = summary)

    private fun project(
        response: AutomationHistoryListResponse,
        size: AutomationHistorySize = AutomationHistoryRegistration.defaultSize,
    ): AutomationHistoryDisplay = AutomationHistoryProjection.project(response, size, strings(), now)

    // ---- success-rate header --------------------------------------------------------

    @Test
    fun successRateProjectsTextValueAndBadge() {
        val display = project(snapshot(runs = arrayOf(run())))
        assertEquals("91.5", display.successRateText)
        assertEquals("91.5%", display.compactValueText)
        assertEquals("91.5% Success Rate", display.badgeText)
        assertEquals("120 runs", display.totalRunsText)
        assertEquals(SuccessRateTone.Success, display.successRateTone)
    }

    @Test
    fun successRateToneThresholdsMatchWeb() {
        assertEquals(SuccessRateTone.Success, AutomationHistoryProjection.successRateToneFor(90.0))
        assertEquals(SuccessRateTone.Warning, AutomationHistoryProjection.successRateToneFor(89.9))
        assertEquals(SuccessRateTone.Warning, AutomationHistoryProjection.successRateToneFor(50.0))
        assertEquals(SuccessRateTone.Danger, AutomationHistoryProjection.successRateToneFor(49.9))
    }

    @Test
    fun totalRunsFormatsWithGroupingSeparator() {
        val display = project(snapshot(summary = AutomationHistoryStats(totalExecutions = 1_200, successRate = 80.0)))
        assertEquals("1,200 runs", display.totalRunsText)
    }

    // ---- duration formatter (web formatDurationMs) ----------------------------------

    @Test
    fun durationFormatterMatchesWeb() {
        assertEquals("\u2014", AutomationHistoryProjection.formatDurationMs(null))
        assertEquals("250ms", AutomationHistoryProjection.formatDurationMs(250))
        assertEquals("999ms", AutomationHistoryProjection.formatDurationMs(999))
        assertEquals("1.0s", AutomationHistoryProjection.formatDurationMs(1_000))
        assertEquals("1.5s", AutomationHistoryProjection.formatDurationMs(1_500))
        assertEquals("12.3s", AutomationHistoryProjection.formatDurationMs(12_345))
    }

    // ---- status → glyph/tone map (web STATUS_MAP/DEFAULT_STATUS) ---------------------

    @Test
    fun statusTokensMatchWebMap() {
        assertEquals(AutomationRunGlyph.Check to AutomationRunTone.Success, AutomationRunStatusTokens.of("success"))
        assertEquals(AutomationRunGlyph.Cross to AutomationRunTone.Danger, AutomationRunStatusTokens.of("failed"))
        assertEquals(AutomationRunGlyph.Clock to AutomationRunTone.Warning, AutomationRunStatusTokens.of("partial"))
        assertEquals(AutomationRunGlyph.Clock to AutomationRunTone.Info, AutomationRunStatusTokens.of("running"))
        assertEquals(AutomationRunGlyph.Clock to AutomationRunTone.Muted, AutomationRunStatusTokens.of("skipped"))
        assertEquals(AutomationRunGlyph.Cross to AutomationRunTone.Muted, AutomationRunStatusTokens.of("cancelled"))
        assertEquals(AutomationRunGlyph.Play to AutomationRunTone.Accent, AutomationRunStatusTokens.of("test"))
        assertEquals(AutomationRunGlyph.Clock to AutomationRunTone.Muted, AutomationRunStatusTokens.of("undo"))
    }

    @Test
    fun unknownAndBlankStatusFallBackToDefault() {
        assertEquals(AutomationRunGlyph.Play to AutomationRunTone.Muted, AutomationRunStatusTokens.of("wat"))
        assertEquals(AutomationRunGlyph.Play to AutomationRunTone.Muted, AutomationRunStatusTokens.of(null))
        assertEquals(AutomationRunGlyph.Check to AutomationRunTone.Success, AutomationRunStatusTokens.of("  SUCCESS "))
    }

    // ---- run feed projection --------------------------------------------------------

    @Test
    fun rowProjectsTitleSubtitleAndAccessibleName() {
        val display = project(snapshot(runs = arrayOf(run(status = "failed", durationMs = 250))))
        val row = display.items.single()
        assertEquals("Morning Charge", row.title)
        assertEquals("failed \u00b7 250ms", row.subtitle)
        assertEquals(AutomationRunGlyph.Cross, row.glyph)
        assertEquals(AutomationRunTone.Danger, row.tone)
        assertEquals("5m ago", row.relativeTime)
        assertEquals("Morning Charge, failed, 5m ago", row.contentDescription)
    }

    @Test
    fun blankTitleAndStatusFallBackToEmDash() {
        val display = project(snapshot(runs = arrayOf(run(automationName = "", status = "", durationMs = null))))
        val row = display.items.single()
        assertEquals("\u2014", row.title)
        assertEquals("\u2014 \u00b7 \u2014", row.subtitle)
    }

    @Test
    fun feedSortsNewestFirstButHeroUsesRawFirstItem() {
        val older = run(id = 1, triggeredAt = "2026-06-06T10:00:00Z", automationName = "Older")
        val newer = run(id = 2, triggeredAt = "2026-06-06T12:04:00Z", automationName = "Newer")
        val display = project(snapshot(runs = arrayOf(older, newer)), AutomationHistorySize(cols = 1, rows = 2))
        // Feed head is the newest run …
        assertEquals("Newer", display.items.first().title)
        // … but the compact hero's last-run reads the raw first item (web items[0]), which is the older one.
        assertEquals("2h ago", display.lastRunRelative)
    }

    @Test
    fun feedCapsAtTenRows() {
        val runs = (1..12).map { run(id = it.toLong(), triggeredAt = "2026-06-06T%02d:00:00Z".format(it)) }
        val display = project(snapshot(runs = runs.toTypedArray()))
        assertEquals(AutomationHistorySize.MAX_FEED_ITEMS, display.items.size)
    }

    @Test
    fun emptyItemsYieldNoRowsButStillProjectsSuccessRate() {
        val display = project(snapshot())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
        assertEquals("91.5%", display.compactValueText)
        assertEquals("", display.lastRunRelative)
    }

    @Test
    fun compactContentDescriptionFoldsRateAndLastRun() {
        val compact = AutomationHistorySize(cols = 1, rows = 2)
        val withRuns = project(snapshot(runs = arrayOf(run())), compact)
        assertEquals("91.5% Success Rate, 5m ago", withRuns.compactContentDescription)
        val empty = project(snapshot(), compact)
        assertEquals("91.5% Success Rate", empty.compactContentDescription)
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(snapshot(), AutomationHistorySize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(snapshot(), AutomationHistorySize(cols = 2, rows = 4)).isCompact)
    }

    // ---- registry metadata (web registry/automations.ts) ----------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("automation-history", AutomationHistoryRegistration.ID)
        assertEquals("automations", AutomationHistoryRegistration.CATEGORY)
        assertEquals("AutomationHistoryWidget", AutomationHistoryRegistration.SLUG)
        assertEquals(20, AutomationHistoryRegistration.DEFAULT_LIMIT)
        assertEquals(AutomationHistorySize(cols = 2, rows = 4), AutomationHistoryRegistration.defaultSize)
        assertEquals(AutomationHistorySize(cols = 1, rows = 2), AutomationHistoryRegistration.minSize)
        assertEquals(AutomationHistorySize(cols = 4, rows = 40), AutomationHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(AutomationHistoryRegistration.isWithinBounds(AutomationHistorySize(cols = 2, rows = 4)))
        assertFalse(AutomationHistoryRegistration.isWithinBounds(AutomationHistorySize(cols = 0, rows = 1)))
        assertFalse(AutomationHistoryRegistration.isWithinBounds(AutomationHistorySize(cols = 5, rows = 50)))
        assertEquals(
            AutomationHistorySize(cols = 1, rows = 2),
            AutomationHistoryRegistration.clamp(AutomationHistorySize(cols = 0, rows = 0)),
        )
        assertEquals(
            AutomationHistorySize(cols = 4, rows = 40),
            AutomationHistoryRegistration.clamp(AutomationHistorySize(cols = 9, rows = 99)),
        )
    }

    // ---- tolerant timestamp parse ---------------------------------------------------

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(
            parseEpochMillis("2026-06-06T12:00:00Z"),
            parseEpochMillis("2026-06-06T14:00:00+02:00"),
        )
    }

    @Test
    fun unparseableTriggerTimeRendersEmDashRelative() {
        val display = project(snapshot(runs = arrayOf(run(triggeredAt = "garbage"))))
        assertEquals("\u2014", display.items.single().relativeTime)
    }

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
