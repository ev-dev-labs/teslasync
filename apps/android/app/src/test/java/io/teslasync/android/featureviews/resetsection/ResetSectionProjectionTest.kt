package io.teslasync.android.featureviews.resetsection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetSectionResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Reset-to-defaults surface's pure logic — the native analogue of the web
 * panel's static `useSectionRows` / `useDeniedRows` order + wire names, its `pending` / `resetAllOpen` dialog
 * state, and its `announceSuccess` count build (web/src/features/settings/components/ResetSection.tsx). Also
 * pins the PII-safe diagnostics (surface slug only). Runs in the :android:testReleaseUnitTest gate.
 */
class ResetSectionProjectionTest {
    // ── Section catalog (web `useSectionRows` order + ids) ───────────────────────────

    @Test
    fun sectionsAreInWebOrderWithCanonicalWireNames() {
        assertEquals(
            listOf(
                ResetSectionId.General,
                ResetSectionId.Appearance,
                ResetSectionId.AlertRules,
                ResetSectionId.Geofences,
                ResetSectionId.NotificationChannels,
                ResetSectionId.DashboardLayout,
                ResetSectionId.Automations,
                ResetSectionId.QuietHours,
            ),
            ResetSectionCatalog.SECTIONS,
        )
        assertEquals(
            listOf(
                "general",
                "appearance",
                "alert_rules",
                "geofences",
                "notification_channels",
                "dashboard_layout",
                "automations",
                "quiet_hours",
            ),
            ResetSectionCatalog.SECTIONS.map { it.wire },
        )
    }

    // ── Deny-list (web `useDeniedRows`) ──────────────────────────────────────────────

    @Test
    fun deniedKeysAreTariffsThenSoundPrefs() {
        assertEquals(listOf("tariffs", "sound_prefs"), ResetSectionCatalog.DENIED)
    }

    // ── Success-toast args (web `announceSuccess` { count, sections }) ────────────────

    @Test
    fun successToastArgsAreResetCountThenSectionsCount() {
        val result =
            SettingsResetResult(
                reset = 12,
                sections =
                    listOf(
                        SettingsResetSectionResult("alert_rules", 5),
                        SettingsResetSectionResult("geofences", 4),
                        SettingsResetSectionResult("automations", 3),
                    ),
            )
        assertEquals(listOf("12", "3"), ResetSectionCatalog.successToastArgs(result))
    }

    @Test
    fun successToastArgsHandleAnEmptyReceipt() {
        assertEquals(listOf("0", "0"), ResetSectionCatalog.successToastArgs(SettingsResetResult()))
    }

    // ── Dialog state machine (web `pending` / `resetAllOpen`) ─────────────────────────

    @Test
    fun defaultStateHasNoDialogAndIsNotBusy() {
        val state = ResetSectionUiState()
        assertEquals(ResetDialog.None, state.dialog)
        assertNull(state.pendingSection)
        assertFalse(state.isSectionDialogOpen)
        assertFalse(state.isAllDialogOpen)
        assertFalse(state.busy)
    }

    @Test
    fun sectionDialogExposesThePendingRow() {
        val row = ResetSectionRow(ResetSectionId.Geofences, "Geofences", "Delete every geofence.")
        val state = ResetSectionUiState(dialog = ResetDialog.Section(row))
        assertTrue(state.isSectionDialogOpen)
        assertFalse(state.isAllDialogOpen)
        assertEquals(row, state.pendingSection)
    }

    @Test
    fun allDialogIsFlaggedAndHasNoPendingRow() {
        val state = ResetSectionUiState(dialog = ResetDialog.All)
        assertTrue(state.isAllDialogOpen)
        assertFalse(state.isSectionDialogOpen)
        assertNull(state.pendingSection)
    }

    @Test
    fun isSectionBusyOnlyForThePendingRowWhileBusy() {
        val row = ResetSectionRow(ResetSectionId.Geofences, "Geofences", "Delete every geofence.")
        val busy = ResetSectionUiState(dialog = ResetDialog.Section(row), busy = true)
        assertTrue(busy.isSectionBusy(ResetSectionId.Geofences))
        assertFalse(busy.isSectionBusy(ResetSectionId.Automations))

        val idle = ResetSectionUiState(dialog = ResetDialog.Section(row), busy = false)
        assertFalse(idle.isSectionBusy(ResetSectionId.Geofences))
    }

    // ── Diagnostics (P1/S11 — PII-safe, surface slug only) ───────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        ResetSectionDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events.single().first)
        assertEquals(mapOf("surface" to "ResetSection"), logger.events.single().second)
    }

    @Test
    fun recordResetEmitsTheEventWithSurfaceSlugOnly() {
        val logger = RecordingLogger()
        ResetSectionDiagnostics.recordReset(logger, ResetSectionDiagnostics.EVENT_RESET_ALL)
        assertEquals("settingsReset.all", logger.events.single().first)
        // PII-safe: only the surface slug is recorded — never a section id or receipt count.
        assertEquals(mapOf("surface" to "ResetSection"), logger.events.single().second)
    }

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
}
