// Off-device unit coverage for the DashboardSettingsModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the initial-draft seeding (web `useState(dashboard.settings ?? DEFAULT)` + name +
// `icon ?? '📊'`), the rename guard (web `name.trim() && name.trim() !== dashboard.name`), the icon-change guard
// (web `icon !== dashboard.icon`), the Save fan-out assembly (web `handleSave` — conditional rename/icon, always
// settings), the select-value parsing (refresh seconds + optional vehicle id), the refresh option vocabulary, the
// emoji palette, the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.dashboardsettingsmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardSettingsModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- initialDraft seeding (web open-effect: name / icon / settings) ----------

    @Test
    fun initialDraft_fallsBackToDefaultsWhenIconAndSettingsAreAbsent() {
        val draft = DashboardSettingsModalProjection.initialDraft(DashboardSummary(id = "d1", name = "Overview"))
        assertEquals("Overview", draft.name)
        assertEquals(DEFAULT_DASHBOARD_ICON, draft.icon)
        assertEquals(DEFAULT_DASHBOARD_SETTINGS, draft.settings)
    }

    @Test
    fun initialDraft_passesThroughPresentValues() {
        val settings =
            DashboardSettingsValues(
                refreshInterval = 30,
                vehicleId = 7,
                showWidgetBorders = true,
                compactMode = true,
            )
        val draft =
            DashboardSettingsModalProjection.initialDraft(
                DashboardSummary(id = "d2", name = "Battery", icon = "🔋", settings = settings),
            )
        assertEquals("Battery", draft.name)
        assertEquals("🔋", draft.icon)
        assertEquals(settings, draft.settings)
    }

    // ---- Rename guard (web `name.trim() && name.trim() !== dashboard.name`) -------

    @Test
    fun shouldRename_onlyWhenTrimmedNonEmptyAndDifferent() {
        val dashboard = DashboardSummary(id = "d1", name = "Overview")
        assertFalse(DashboardSettingsModalProjection.shouldRename(dashboard, ""))
        assertFalse(DashboardSettingsModalProjection.shouldRename(dashboard, "   "))
        assertFalse(DashboardSettingsModalProjection.shouldRename(dashboard, "Overview"))
        assertFalse(DashboardSettingsModalProjection.shouldRename(dashboard, "  Overview  "))
        assertTrue(DashboardSettingsModalProjection.shouldRename(dashboard, "Fleet"))
        assertTrue(DashboardSettingsModalProjection.shouldRename(dashboard, "  Fleet  "))
    }

    // ---- Icon guard (web `icon !== dashboard.icon`) ------------------------------

    @Test
    fun shouldChangeIcon_comparesAgainstTheSavedIconIncludingNull() {
        assertFalse(
            DashboardSettingsModalProjection.shouldChangeIcon(
                DashboardSummary(id = "d1", name = "Overview", icon = "🔋"),
                "🔋",
            ),
        )
        assertTrue(
            DashboardSettingsModalProjection.shouldChangeIcon(
                DashboardSummary(id = "d1", name = "Overview", icon = "🔋"),
                "🚗",
            ),
        )
        // A dashboard with no saved icon adopts the default on first save (web `'📊' !== undefined`).
        assertTrue(
            DashboardSettingsModalProjection.shouldChangeIcon(
                DashboardSummary(id = "d1", name = "Overview"),
                DEFAULT_DASHBOARD_ICON,
            ),
        )
    }

    // ---- Save fan-out (web `handleSave`) -----------------------------------------

    @Test
    fun resolveSave_carriesRenameAndIconOnlyWhenChangedAndAlwaysSettings() {
        val dashboard =
            DashboardSummary(
                id = "d1",
                name = "Overview",
                icon = "📊",
                settings = DEFAULT_DASHBOARD_SETTINGS,
            )
        val edited =
            DashboardSettingsValues(refreshInterval = 60, vehicleId = 3, showWidgetBorders = true, compactMode = false)
        val draft = DashboardSettingsDraft(name = "  Fleet  ", icon = "🚗", settings = edited)

        val result = DashboardSettingsModalProjection.resolveSave(dashboard, draft)

        assertEquals("Fleet", result.rename)
        assertEquals("🚗", result.icon)
        assertEquals(edited, result.settings)
    }

    @Test
    fun resolveSave_dropsRenameAndIconWhenUnchanged() {
        val dashboard =
            DashboardSummary(
                id = "d1",
                name = "Overview",
                icon = "📊",
                settings = DEFAULT_DASHBOARD_SETTINGS,
            )
        val draft = DashboardSettingsModalProjection.initialDraft(dashboard)

        val result = DashboardSettingsModalProjection.resolveSave(dashboard, draft)

        assertNull(result.rename)
        assertNull(result.icon)
        assertEquals(DEFAULT_DASHBOARD_SETTINGS, result.settings)
    }

    @Test
    fun resolveSave_adoptsDefaultIconForADashboardThatHadNone() {
        val dashboard = DashboardSummary(id = "d1", name = "Overview")
        val draft = DashboardSettingsModalProjection.initialDraft(dashboard)

        val result = DashboardSettingsModalProjection.resolveSave(dashboard, draft)

        assertNull(result.rename)
        assertEquals(DEFAULT_DASHBOARD_ICON, result.icon)
    }

    // ---- Select-value parsing (web select onChange) ------------------------------

    @Test
    fun parseRefresh_readsSecondsAndFallsBackToZero() {
        assertEquals(30, DashboardSettingsModalProjection.parseRefresh("30"))
        assertEquals(0, DashboardSettingsModalProjection.parseRefresh("0"))
        assertEquals(0, DashboardSettingsModalProjection.parseRefresh(""))
        assertEquals(0, DashboardSettingsModalProjection.parseRefresh("nonsense"))
    }

    @Test
    fun parseVehicleId_mapsEmptyToAllVehiclesAndParsesIds() {
        assertNull(DashboardSettingsModalProjection.parseVehicleId(""))
        assertEquals(5, DashboardSettingsModalProjection.parseVehicleId("5"))
        assertNull(DashboardSettingsModalProjection.parseVehicleId("abc"))
    }

    // ---- Refresh option vocabulary (web `REFRESH_OPTIONS`) -----------------------

    @Test
    fun refreshOptions_matchTheWebSecondsAndOrder() {
        val seconds = DashboardSettingsModalProjection.refreshOptions.map { it.seconds }
        assertEquals(listOf(0, 5, 10, 30, 60, 300), seconds)
        val keys = DashboardSettingsModalProjection.refreshOptions.map { it.i18nSuffix }
        assertEquals(
            listOf("refresh0", "refresh5", "refresh10", "refresh30", "refresh60", "refresh300"),
            keys,
        )
        assertEquals("300", RefreshIntervalOption.FiveMinutes.wire)
    }

    // ---- Emoji palette (web `DASHBOARD_EMOJIS`) ----------------------------------

    @Test
    fun dashboardEmojis_carryTheSixteenWebChoicesIncludingTheDefault() {
        assertEquals(16, DASHBOARD_EMOJIS.size)
        assertTrue(DASHBOARD_EMOJIS.contains(DEFAULT_DASHBOARD_ICON))
        assertEquals(DASHBOARD_EMOJIS.size, DASHBOARD_EMOJIS.distinct().size)
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("dashboard-settings-modal", DashboardSettingsModalRegistration.ID)
        assertEquals("DashboardSettingsModal", DashboardSettingsModalRegistration.SLUG)
    }

    @Test
    fun recordDashboardSettingsModalOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordDashboardSettingsModalOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DashboardSettingsModal"), fields)
    }
}
