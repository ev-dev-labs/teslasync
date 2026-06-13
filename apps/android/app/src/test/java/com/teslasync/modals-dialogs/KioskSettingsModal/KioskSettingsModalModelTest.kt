// Off-device unit coverage for the KioskSettingsModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the clock-position wire vocabulary + reverse lookup, the KioskConfig defaults (web
// `DEFAULT_KIOSK_CONFIG`), the rotation-selection seeding + toggle guard (web `selectedIds` / `toggleDashboard`), the
// four conditional-render guards, the duration classification that drives the option labels (web `ROTATION_OPTIONS` /
// `CURSOR_TIMEOUT_OPTIONS` / `DIM_AFTER_OPTIONS`), the percent<->fraction conversions (web `Math.round(x*100)` /
// `n/100`), the preview-swatch alpha math, the Material slider-step counts, the option vocabularies, the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.kiosksettingsmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KioskSettingsModalModelTest {
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

    private companion object {
        const val FLOAT_DELTA = 1e-9
    }

    // ---- Clock position vocabulary (web `CLOCK_POSITION_OPTIONS` + `clockPosition` union) -------------------------

    @Test
    fun clockPosition_wireTokensMatchTheWebUnion() {
        assertEquals("top-left", ClockPosition.TopLeft.wire)
        assertEquals("top-right", ClockPosition.TopRight.wire)
        assertEquals("bottom-left", ClockPosition.BottomLeft.wire)
        assertEquals("bottom-right", ClockPosition.BottomRight.wire)
    }

    @Test
    fun clockPosition_fromWireResolvesKnownTokensAndFallsBackToDefault() {
        assertEquals(ClockPosition.BottomRight, ClockPosition.DEFAULT)
        assertEquals(ClockPosition.TopLeft, ClockPosition.fromWire("top-left"))
        assertEquals(ClockPosition.BottomRight, ClockPosition.fromWire("bottom-right"))
        assertEquals(ClockPosition.DEFAULT, ClockPosition.fromWire("nonsense"))
    }

    // ---- KioskConfig defaults (web `DEFAULT_KIOSK_CONFIG`) -------------------------------------------------------

    @Test
    fun kioskConfig_defaultsMirrorTheWebInitialState() {
        val config = KioskConfig()
        assertEquals(30, config.rotateInterval)
        assertTrue(config.dashboardIds.isEmpty())
        assertTrue(config.hideCursor)
        assertEquals(5, config.cursorTimeout)
        assertEquals(0, config.dimAfter)
        assertEquals(0.5, config.dimLevel, FLOAT_DELTA)
        assertTrue(config.showClock)
        assertEquals(ClockPosition.BottomRight, config.clockPosition)
        assertEquals(1.0, config.widgetOpacity, FLOAT_DELTA)
        assertEquals(1.0, config.backgroundOpacity, FLOAT_DELTA)
    }

    // ---- Rotation selection seeding + toggle (web `selectedIds` / `toggleDashboard`) ------------------------------

    @Test
    fun initialSelection_usesConfiguredIdsWhenPresentElseEveryDashboard() {
        val dashboards =
            listOf(
                SavedDashboard("a", "Alpha"),
                SavedDashboard("b", "Bravo"),
            )
        assertEquals(setOf("a"), KioskSettingsModalProjection.initialSelection(listOf("a"), dashboards))
        assertEquals(setOf("a", "b"), KioskSettingsModalProjection.initialSelection(emptyList(), dashboards))
    }

    @Test
    fun toggleSelection_addsRemovesButNeverEmptiesTheSelection() {
        // Add a not-yet-selected id.
        assertEquals(setOf("a", "b"), KioskSettingsModalProjection.toggleSelection(setOf("a"), "b"))
        // Remove one of several.
        assertEquals(setOf("b"), KioskSettingsModalProjection.toggleSelection(setOf("a", "b"), "a"))
        // Refuse to remove the last selected (web `if (next.size > 1) next.delete`).
        assertEquals(setOf("a"), KioskSettingsModalProjection.toggleSelection(setOf("a"), "a"))
    }

    // ---- Conditional-render guards (web `&&` branches) -----------------------------------------------------------

    @Test
    fun showDashboardList_requiresRotationAndMoreThanOneDashboard() {
        assertTrue(KioskSettingsModalProjection.showDashboardList(rotateInterval = 30, dashboardCount = 2))
        assertFalse(KioskSettingsModalProjection.showDashboardList(rotateInterval = 0, dashboardCount = 2))
        assertFalse(KioskSettingsModalProjection.showDashboardList(rotateInterval = 30, dashboardCount = 1))
    }

    @Test
    fun displayBranchGuards_followTheirToggles() {
        assertTrue(KioskSettingsModalProjection.showCursorTimeout(hideCursor = true))
        assertFalse(KioskSettingsModalProjection.showCursorTimeout(hideCursor = false))
        assertTrue(KioskSettingsModalProjection.showBrightness(dimAfter = 5))
        assertFalse(KioskSettingsModalProjection.showBrightness(dimAfter = 0))
        assertTrue(KioskSettingsModalProjection.showClockPosition(showClock = true))
        assertFalse(KioskSettingsModalProjection.showClockPosition(showClock = false))
    }

    // ---- Duration classification (web option labels) -------------------------------------------------------------

    @Test
    fun classifyRotation_mapsOffSecondsAndMinutes() {
        assertEquals(KioskDuration.Off, KioskSettingsModalProjection.classifyRotation(0))
        assertEquals(KioskDuration.Seconds(10), KioskSettingsModalProjection.classifyRotation(10))
        assertEquals(KioskDuration.Seconds(30), KioskSettingsModalProjection.classifyRotation(30))
        assertEquals(KioskDuration.Minutes(1), KioskSettingsModalProjection.classifyRotation(60))
        assertEquals(KioskDuration.Minutes(2), KioskSettingsModalProjection.classifyRotation(120))
        assertEquals(KioskDuration.Minutes(5), KioskSettingsModalProjection.classifyRotation(300))
    }

    @Test
    fun classifyCursor_isAlwaysSeconds() {
        assertEquals(KioskDuration.Seconds(3), KioskSettingsModalProjection.classifyCursor(3))
        assertEquals(KioskDuration.Seconds(15), KioskSettingsModalProjection.classifyCursor(15))
    }

    @Test
    fun classifyDim_mapsNeverAndMinutes() {
        assertEquals(KioskDuration.Never, KioskSettingsModalProjection.classifyDim(0))
        assertEquals(KioskDuration.Minutes(5), KioskSettingsModalProjection.classifyDim(5))
        assertEquals(KioskDuration.Minutes(60), KioskSettingsModalProjection.classifyDim(60))
    }

    // ---- Percent <-> fraction + preview math + slider steps ------------------------------------------------------

    @Test
    fun percentConversions_roundTripAtTheDisplayBoundary() {
        assertEquals(50, KioskSettingsModalProjection.toPercent(0.5))
        assertEquals(100, KioskSettingsModalProjection.toPercent(1.0))
        assertEquals(0, KioskSettingsModalProjection.toPercent(0.0))
        assertEquals(0.5, KioskSettingsModalProjection.toFraction(50), FLOAT_DELTA)
        assertEquals(35, KioskSettingsModalProjection.toPercent(KioskSettingsModalProjection.toFraction(35)))
    }

    @Test
    fun previewWidgetAlpha_mirrorsTheWebSwatchFormula() {
        // web `0.03 + (widgetOpacity ?? 1) * 0.17`.
        assertEquals(0.03, KioskSettingsModalProjection.previewWidgetAlpha(0.0), FLOAT_DELTA)
        assertEquals(0.20, KioskSettingsModalProjection.previewWidgetAlpha(1.0), FLOAT_DELTA)
        assertEquals(0.115, KioskSettingsModalProjection.previewWidgetAlpha(0.5), FLOAT_DELTA)
    }

    @Test
    fun sliderSteps_countMaterialStopsBetweenEndpoints() {
        // web widget opacity 30..100 step 5 -> 13 intermediate stops; background 0..100 step 5 -> 19.
        assertEquals(13, KioskSettingsModalProjection.sliderSteps(30, 100, 5))
        assertEquals(19, KioskSettingsModalProjection.sliderSteps(0, 100, 5))
    }

    // ---- Option vocabularies (web `*_OPTIONS` constants) ---------------------------------------------------------

    @Test
    fun optionVocabularies_matchTheWebConstants() {
        assertEquals(listOf(0, 10, 15, 30, 60, 120, 300), KioskSettingsModalProjection.ROTATION_SECONDS)
        assertEquals(listOf(3, 5, 10, 15), KioskSettingsModalProjection.CURSOR_SECONDS)
        assertEquals(listOf(0, 5, 10, 15, 30, 60), KioskSettingsModalProjection.DIM_MINUTES)
        assertEquals(
            listOf(
                ClockPosition.TopLeft,
                ClockPosition.TopRight,
                ClockPosition.BottomLeft,
                ClockPosition.BottomRight,
            ),
            KioskSettingsModalProjection.CLOCK_POSITIONS,
        )
    }

    // ---- Registry + diagnostics ----------------------------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("kiosk-settings-modal", KioskSettingsModalRegistration.ID)
        assertEquals("KioskSettingsModal", KioskSettingsModalRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        KioskSettingsModalDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "KioskSettingsModal"), fields)
    }
}
