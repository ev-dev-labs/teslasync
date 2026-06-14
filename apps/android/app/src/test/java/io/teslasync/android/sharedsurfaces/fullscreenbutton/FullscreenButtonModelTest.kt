// Off-device coverage of the framework-free FullscreenButton model — the label decision (web
// `isFs ? exitLabel : enterLabel`), the toggle-state token (web `data-fullscreen-state`), the support-gated
// visibility (web `if (!supported) return null`), the tap → action resolution (web `requestFullscreen` vs
// `exitFullscreen`), the resting states, and the PII-safe diagnostics (slug + action only, never any user
// data). Runs in the :android:testReleaseUnitTest gate; the state holder is covered by
// FullscreenButtonViewModelTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FullscreenButtonModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val enter = "Enter fullscreen"
    private val exit = "Exit fullscreen"

    // ── fullscreenLabel: web isFs ? exitLabel : enterLabel ──────────────────────────────────────────────

    @Test
    fun labelIsTheEnterLabelWhenNotFullscreen() {
        assertEquals(enter, fullscreenLabel(isFullscreen = false, enterLabel = enter, exitLabel = exit))
    }

    @Test
    fun labelIsTheExitLabelWhenFullscreen() {
        assertEquals(exit, fullscreenLabel(isFullscreen = true, enterLabel = enter, exitLabel = exit))
    }

    // ── fullscreenStateToken: web data-fullscreen-state / aria-pressed ──────────────────────────────────

    @Test
    fun stateTokenIsOffWhenNotFullscreen() {
        assertEquals(STATE_OFF, fullscreenStateToken(isFullscreen = false))
        assertEquals("off", fullscreenStateToken(isFullscreen = false))
    }

    @Test
    fun stateTokenIsOnWhenFullscreen() {
        assertEquals(STATE_ON, fullscreenStateToken(isFullscreen = true))
        assertEquals("on", fullscreenStateToken(isFullscreen = true))
    }

    // ── isButtonVisible: web if (!supported) return null ────────────────────────────────────────────────

    @Test
    fun buttonIsVisibleOnlyWhenSupported() {
        assertTrue(isButtonVisible(supported = true))
        assertFalse(isButtonVisible(supported = false))
    }

    // ── nextFullscreenAction: web requestFullscreen vs exitFullscreen ───────────────────────────────────

    @Test
    fun tapEntersWhenNotFullscreen() {
        assertEquals(FullscreenAction.Enter, nextFullscreenAction(isFullscreen = false))
    }

    @Test
    fun tapExitsWhenFullscreen() {
        assertEquals(FullscreenAction.Exit, nextFullscreenAction(isFullscreen = true))
    }

    // ── resting states + slug ───────────────────────────────────────────────────────────────────────────

    @Test
    fun defaultStateIsVisibleAndNotFullscreen() {
        assertTrue(FullscreenUiState.Default.supported)
        assertFalse(FullscreenUiState.Default.isFullscreen)
        assertTrue(FullscreenUiState().supported)
        assertFalse(FullscreenUiState().isFullscreen)
    }

    @Test
    fun hiddenStateIsUnsupported() {
        assertFalse(FullscreenUiState.Hidden.supported)
        assertFalse(FullscreenUiState.Hidden.isFullscreen)
    }

    @Test
    fun surfaceSlugIsTheMandatedDiagnosticsSlug() {
        assertEquals("FullscreenButton", FullscreenButtonRegistration.SLUG)
        assertEquals("FullscreenButton", FULLSCREEN_BUTTON_SLUG)
    }

    // ── diagnostics: PII-safe slug + action only ────────────────────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordFullscreenOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to FullscreenButtonRegistration.SLUG), record.fields)
    }

    @Test
    fun toggleRecordsSlugAndLowercasedAction() {
        val logger = RecordingLogger()
        recordFullscreenToggle(logger, FullscreenAction.Enter)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_TOGGLE, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to FullscreenButtonRegistration.SLUG, FIELD_ACTION to "enter"),
            record.fields,
        )
    }

    @Test
    fun everyActionMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        FullscreenAction.entries.forEach { recordFullscreenToggle(logger, it) }
        val actions = logger.records.map { it.fields.getValue(FIELD_ACTION) }
        assertEquals(listOf("enter", "exit"), actions)
    }

    @Test
    fun toggleDiagnosticsCarryOnlySlugAndAction() {
        val logger = RecordingLogger()
        recordFullscreenToggle(logger, FullscreenAction.Exit)
        // Only the surface slug + the action enum are ever recorded — never a target id, route, or any user
        // content, so a diagnostics line can never leak what the operator was viewing.
        val record = logger.records.single()
        assertEquals(setOf(FIELD_SURFACE, FIELD_ACTION), record.fields.keys)
    }
}
