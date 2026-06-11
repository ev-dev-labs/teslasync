package io.teslasync.android.dashboard.widgets

import io.teslasync.shared.core.presentation.automations.Automation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free `AutomationStatusWidget` adapter logic — the data
 * projection (cached automations → status lane, summary counts, relative-age buckets), the ISO
 * timestamp parse, the size-constraint math, and the diagnostics event builder. These run in the
 * no-device `:android:testReleaseUnitTest` gate; the per-state rendering + accessibility coverage
 * lives in the instrumented [AutomationStatusWidgetUiTest].
 */
class AutomationStatusWidgetTest {
    private fun automation(
        id: Long = 1,
        name: String = "A",
    ): Automation = Automation(id = id, name = name, enabled = true)

    // ── Status lane (web getStatusBadge precedence) ───────────────────────────────
    @Test
    fun statusKindFollowsWebPrecedence() {
        assertEquals(
            AutomationStatusKind.AutoDisabled,
            automationStatusKind(automation().copy(enabled = true, autoDisabled = true, consecutiveFailures = 3)),
        )
        assertEquals(AutomationStatusKind.Disabled, automationStatusKind(automation().copy(enabled = false)))
        assertEquals(
            AutomationStatusKind.Failing,
            automationStatusKind(automation().copy(consecutiveFailures = 1)),
        )
        assertEquals(
            AutomationStatusKind.Ok,
            automationStatusKind(automation().copy(lastSuccessAt = "2026-01-01T00:00:00Z")),
        )
        assertEquals(AutomationStatusKind.Idle, automationStatusKind(automation()))
    }

    // ── Summary counts ────────────────────────────────────────────────────────────
    @Test
    fun summaryCountsEnabledFailingAndAutoDisabled() {
        val items =
            listOf(
                automation(id = 1),
                automation(id = 2).copy(consecutiveFailures = 3),
                automation(id = 3).copy(enabled = false),
                automation(id = 4).copy(enabled = false, autoDisabled = true, consecutiveFailures = 5),
            )
        val summary = automationSummary(items)
        assertEquals(4, summary.total)
        assertEquals(2, summary.enabled)
        // Only the enabled, failing row counts — a4 has failures but is disabled.
        assertEquals(1, summary.failing)
        assertEquals(1, summary.autoDisabled)
    }

    @Test
    fun summaryOfEmptyListIsAllZero() {
        val summary = automationSummary(emptyList())
        assertEquals(0, summary.total)
        assertEquals(0, summary.enabled)
        assertEquals(0, summary.failing)
        assertEquals(0, summary.autoDisabled)
    }

    // ── Relative-age buckets (web formatRelativeTime) ─────────────────────────────
    @Test
    fun relativeAgeBucketsMatchWeb() {
        val now = 1_000_000_000_000L
        assertEquals(AutomationRelativeAge.Unknown, automationRelativeAge(null, now))
        assertEquals(AutomationRelativeAge.JustNow, automationRelativeAge(now - 30_000L, now))
        assertEquals(AutomationRelativeAge.Minutes(5), automationRelativeAge(now - 5L * 60_000L, now))
        assertEquals(AutomationRelativeAge.Hours(3), automationRelativeAge(now - 3L * 3_600_000L, now))
        assertEquals(AutomationRelativeAge.Days(2), automationRelativeAge(now - 2L * 86_400_000L, now))
    }

    @Test
    fun relativeAgeTreatsFutureInstantsAsJustNow() {
        val now = 1_000_000_000_000L
        // Web computes Date.now() - future < 1 minute → "Just now"; mirror that quirk for parity.
        assertEquals(AutomationRelativeAge.JustNow, automationRelativeAge(now + 60_000L, now))
    }

    @Test
    fun relativeAgeBoundariesAreInclusiveLikeWeb() {
        val now = 1_000_000_000_000L
        // 59 min stays minutes; exactly 60 min rolls to 1 hour; 23 h stays hours; 24 h rolls to 1 day.
        assertEquals(AutomationRelativeAge.Minutes(59), automationRelativeAge(now - 59L * 60_000L, now))
        assertEquals(AutomationRelativeAge.Hours(1), automationRelativeAge(now - 60L * 60_000L, now))
        assertEquals(AutomationRelativeAge.Hours(23), automationRelativeAge(now - 23L * 3_600_000L, now))
        assertEquals(AutomationRelativeAge.Days(1), automationRelativeAge(now - 24L * 3_600_000L, now))
    }

    // ── ISO timestamp parse ─────────────────────────────────────────────────────────
    @Test
    fun parseIsoMillisHandlesZoffsetAndFraction() {
        val z = parseIsoMillis("2026-01-01T00:00:00Z")
        val offset = parseIsoMillis("2026-01-01T01:00:00+01:00")
        val fraction = parseIsoMillis("2026-01-01T00:00:00.500Z")
        assertNotNull(z)
        assertNotNull(offset)
        assertNotNull(fraction)
        // Z and +01:00 describe the same instant.
        assertEquals(z, offset)
        // The fractional second is 500 ms after the whole second.
        assertEquals(z!! + 500L, fraction)
    }

    @Test
    fun parseIsoMillisReturnsNullForBlankOrGarbage() {
        assertNull(parseIsoMillis(null))
        assertNull(parseIsoMillis(""))
        assertNull(parseIsoMillis("   "))
        assertNull(parseIsoMillis("not-a-date"))
    }

    // ── Size constraints + chrome selection ──────────────────────────────────────────
    @Test
    fun sizeSelectsCompactWideAndHeader() {
        assertTrue(DashboardWidgetSize(1, 1).isCompact())
        assertTrue(DashboardWidgetSize(2, 1).isCompact())
        assertTrue(DashboardWidgetSize(1, 4).isCompact())
        assertTrue(!DashboardWidgetSize(2, 4).isCompact())

        assertTrue(DashboardWidgetSize(3, 4).isWide())
        assertTrue(!DashboardWidgetSize(2, 4).isWide())

        // Header hidden only on a 1-wide panel; a 2x1 strip still shows the header.
        assertTrue(!DashboardWidgetSize(1, 4).showsHeader())
        assertTrue(DashboardWidgetSize(2, 1).showsHeader())
        assertTrue(DashboardWidgetSize(2, 4).showsHeader())
    }

    @Test
    fun coerceToConstraintsClampsToDescriptorBounds() {
        assertEquals(DashboardWidgetSize(4, 40), DashboardWidgetSize(9, 99).coerceToConstraints())
        assertEquals(DashboardWidgetSize(1, 2), DashboardWidgetSize(0, 0).coerceToConstraints())
        assertEquals(DashboardWidgetSize(2, 4), DashboardWidgetSize(2, 4).coerceToConstraints())
    }

    // ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEventCarriesSurfaceSlug() {
        val event = automationStatusViewOpenedEvent("1.2.3")
        assertEquals("screen_view", event.name)
        assertEquals("AutomationStatusWidget", event.properties["screen"])
        assertEquals("android", event.properties["platform"])
        assertEquals("1.2.3", event.properties["app_version"])
    }
}
