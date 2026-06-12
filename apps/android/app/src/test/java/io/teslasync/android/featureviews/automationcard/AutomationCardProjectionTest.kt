package io.teslasync.android.featureviews.automationcard

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the AutomationCard's pure logic — the native analogue of the web component's
 * inline derivations (web/src/features/automations/pages/AutomationCard.tsx): the UI-status classification
 * (web `getUIStatus`), the toggle checked value + intent (web `a.auto_disabled ? false : a.enabled` and
 * `handleToggle`), the relative "last run" age (web `timeAgo` cutoffs), the absolute "next fire" formatter
 * (web `formatDateTime`), the failure / auto-disabled-reason guards, the conflict severity classification, and
 * the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class AutomationCardProjectionTest {
    private val zoneUtc: ZoneId = ZoneId.of("UTC")

    @Suppress("LongParameterList") // test data builder; production AutomationView is a data class
    private fun view(
        id: Long = 1,
        name: String = "Precondition",
        description: String? = "warm cabin",
        enabled: Boolean = true,
        vehicleId: Long? = 7,
        lastTriggeredAt: String? = null,
        executionCount: Long = 0,
        failureCount: Long = 0,
        autoDisabled: Boolean = false,
        autoDisabledReason: String? = null,
        nextFireTime: String? = null,
        conflicts: List<AutomationConflictView> = emptyList(),
    ): AutomationView =
        AutomationView(
            id = id,
            name = name,
            description = description,
            enabled = enabled,
            vehicleId = vehicleId,
            lastTriggeredAt = lastTriggeredAt,
            executionCount = executionCount,
            failureCount = failureCount,
            autoDisabled = autoDisabled,
            autoDisabledReason = autoDisabledReason,
            nextFireTime = nextFireTime,
            conflicts = conflicts,
        )

    // ── UI status (web getUIStatus precedence) ──────────────────────────────────────

    @Test
    fun statusFromAppliesAutoDisabledThenDisabledThenActive() {
        assertEquals(AutomationUiStatus.AutoDisabled, AutomationUiStatus.from(view(autoDisabled = true, enabled = true)))
        assertEquals(AutomationUiStatus.Disabled, AutomationUiStatus.from(view(autoDisabled = false, enabled = false)))
        assertEquals(AutomationUiStatus.Active, AutomationUiStatus.from(view(autoDisabled = false, enabled = true)))
    }

    // ── Toggle (web a.auto_disabled ? false : a.enabled + handleToggle) ──────────────

    @Test
    fun toggleCheckedIsFalseWhenAutoDisabledElseEnabledFlag() {
        assertFalse(AutomationCardProjection.toggleChecked(view(autoDisabled = true, enabled = true)))
        assertTrue(AutomationCardProjection.toggleChecked(view(autoDisabled = false, enabled = true)))
        assertFalse(AutomationCardProjection.toggleChecked(view(autoDisabled = false, enabled = false)))
    }

    @Test
    fun toggleActionReEnablesAutoDisabledOnElseSetsEnabled() {
        assertEquals(
            AutomationToggleAction.ReEnable,
            AutomationCardProjection.toggleAction(view(autoDisabled = true), checked = true),
        )
        // Toggling an auto-disabled automation off is a plain disable, not a re-enable (web else-branch).
        assertEquals(
            AutomationToggleAction.SetEnabled(false),
            AutomationCardProjection.toggleAction(view(autoDisabled = true), checked = false),
        )
        assertEquals(
            AutomationToggleAction.SetEnabled(true),
            AutomationCardProjection.toggleAction(view(autoDisabled = false), checked = true),
        )
        assertEquals(
            AutomationToggleAction.SetEnabled(false),
            AutomationCardProjection.toggleAction(view(autoDisabled = false), checked = false),
        )
    }

    // ── Relative last-run age (web timeAgo cutoffs) ─────────────────────────────────

    @Test
    fun lastRunAgeBucketsLikeWebTimeAgo() {
        val now = 1_750_000_000_000L
        assertEquals(FreshnessAge.JustNow, AutomationCardProjection.lastRunAge(isoBefore(now, 30_000L), now))
        assertEquals(FreshnessAge.Minutes(5), AutomationCardProjection.lastRunAge(isoBefore(now, 5L * 60_000L), now))
        assertEquals(FreshnessAge.Hours(3), AutomationCardProjection.lastRunAge(isoBefore(now, 3L * 3_600_000L), now))
        assertEquals(FreshnessAge.Days(2), AutomationCardProjection.lastRunAge(isoBefore(now, 2L * 86_400_000L), now))
    }

    @Test
    fun lastRunAgeIsUnknownForNullBlankOrUnparseable() {
        val now = 1_750_000_000_000L
        assertEquals(FreshnessAge.Unknown, AutomationCardProjection.lastRunAge(null, now))
        assertEquals(FreshnessAge.Unknown, AutomationCardProjection.lastRunAge("  ", now))
        assertEquals(FreshnessAge.Unknown, AutomationCardProjection.lastRunAge("not-a-date", now))
    }

    @Test
    fun lastRunAgeClampsFutureTimestampsToJustNow() {
        val now = 1_750_000_000_000L
        assertEquals(FreshnessAge.JustNow, AutomationCardProjection.lastRunAge(isoBefore(now, -60_000L), now))
    }

    // ── Absolute next-fire formatting (web formatDateTime) ──────────────────────────

    @Test
    fun formatAbsoluteRendersLocalizedDateTimeForValidIso() {
        val formatted = AutomationCardProjection.formatAbsolute("2026-06-12T14:30:00Z", zoneUtc, Locale.US)
        assertTrue("expected a real date, got '$formatted'", formatted != EM_DASH)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jun"))
    }

    @Test
    fun formatAbsoluteReturnsEmDashForNullBlankOrUnparseable() {
        assertEquals(EM_DASH, AutomationCardProjection.formatAbsolute(null, zoneUtc, Locale.US))
        assertEquals(EM_DASH, AutomationCardProjection.formatAbsolute("", zoneUtc, Locale.US))
        assertEquals(EM_DASH, AutomationCardProjection.formatAbsolute("nonsense", zoneUtc, Locale.US))
    }

    // ── Conflict severity (web 'warning' | 'info' ternary) ──────────────────────────

    @Test
    fun conflictSeverityFromMatchesWarningCaseTolerantElseInfo() {
        assertEquals(ConflictSeverity.Warning, ConflictSeverity.from("warning"))
        assertEquals(ConflictSeverity.Warning, ConflictSeverity.from("  WARNING "))
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("info"))
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("anything-else"))
    }

    // ── Full projection ─────────────────────────────────────────────────────────────

    @Test
    fun projectMapsAllRenderReadyFieldsForAnActiveAutomation() {
        val now = 1_750_000_000_000L
        val result =
            AutomationCardProjection.project(
                view(
                    enabled = true,
                    lastTriggeredAt = isoBefore(now, 10L * 60_000L),
                    executionCount = 142,
                    failureCount = 0,
                    nextFireTime = "2026-06-12T14:30:00Z",
                ),
                now,
                zoneUtc,
                Locale.US,
            )

        assertEquals(AutomationUiStatus.Active, result.status)
        assertTrue(result.toggleChecked)
        assertTrue(result.hasLastRun)
        assertEquals(FreshnessAge.Minutes(10), result.lastRunAge)
        assertEquals(142L, result.runsCount)
        assertFalse(result.showFails)
        assertTrue(result.hasNextFire)
        assertTrue(result.nextFireLabel.contains("2026"))
        assertFalse(result.showAutoDisabledWarning)
        assertTrue(result.conflicts.isEmpty())
    }

    @Test
    fun projectFlagsFailuresAutoDisabledReasonAndConflictsForADisabledAutomation() {
        val now = 1_750_000_000_000L
        val result =
            AutomationCardProjection.project(
                view(
                    enabled = false,
                    lastTriggeredAt = null,
                    executionCount = 9,
                    failureCount = 3,
                    autoDisabled = true,
                    autoDisabledReason = "Disabled after 3 consecutive failures",
                    nextFireTime = null,
                    conflicts =
                        listOf(
                            AutomationConflictView(3, "Charge to 90%", "Overlapping limit", "warning"),
                            AutomationConflictView(4, "Departure precondition", "Shared window", "info"),
                        ),
                ),
                now,
                zoneUtc,
                Locale.US,
            )

        assertEquals(AutomationUiStatus.AutoDisabled, result.status)
        assertFalse(result.toggleChecked)
        assertFalse(result.hasLastRun)
        assertEquals(FreshnessAge.Unknown, result.lastRunAge)
        assertTrue(result.showFails)
        assertEquals(3L, result.failsCount)
        assertFalse(result.hasNextFire)
        assertEquals(EM_DASH, result.nextFireLabel)
        assertTrue(result.showAutoDisabledWarning)
        assertEquals("Disabled after 3 consecutive failures", result.autoDisabledReason)
        assertEquals(
            listOf(ConflictSeverity.Warning, ConflictSeverity.Info),
            result.conflicts.map { it.severity },
        )
        assertEquals(listOf("Charge to 90%", "Departure precondition"), result.conflicts.map { it.automationName })
    }

    @Test
    fun projectHidesAutoDisabledWarningWhenReasonIsBlank() {
        val now = 1_750_000_000_000L
        val result =
            AutomationCardProjection.project(
                view(autoDisabled = true, autoDisabledReason = "   "),
                now,
                zoneUtc,
                Locale.US,
            )
        assertFalse(result.showAutoDisabledWarning)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAutomationCardOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AutomationCard"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("automation-card", AutomationCardRegistration.ID)
        assertEquals("AutomationCard", AutomationCardRegistration.SLUG)
    }

    private fun isoBefore(
        now: Long,
        deltaMillis: Long,
    ): String = Instant.ofEpochMilli(now - deltaMillis).toString()

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
