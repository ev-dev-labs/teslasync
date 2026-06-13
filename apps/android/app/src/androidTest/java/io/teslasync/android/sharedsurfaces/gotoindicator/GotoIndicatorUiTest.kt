package io.teslasync.android.sharedsurfaces.gotoindicator

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [GotoIndicator] view — the parity port of the web `GotoIndicator` component
 * (web/src/components/feedback/GotoIndicator.tsx). Covers what the offline model test cannot: each of the web's
 * two states renders (the pill when `visible`, nothing when not — the web `return null`), the visibility toggle
 * shows + hides the pill, the surface exposes NO interactive node (it is a passive hint), the merged TalkBack
 * description voices the label + key glyphs, and the one-shot PII-safe `view.opened` diagnostic fires only once
 * the hint becomes visible. The offline `:android:testReleaseUnitTest` gate covers the pure projection +
 * diagnostics.
 *
 * Uses the member form of `assertExists` / `assertDoesNotExist` (members of `SemanticsNodeInteraction` in the
 * pinned Compose) rather than the removed top-level functions, matching the accepted sibling UI tests.
 */
class GotoIndicatorUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: visible → the pill renders (web `visible` branch) ──────────────────────────────────────────

    @Test
    fun aVisibleHintRendersThePill() {
        mount(visible = true)

        compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG).assertExists()
    }

    // ── State: hidden → nothing renders (web `if (!visible) return null`) ──────────────────────────────────

    @Test
    fun aDismissedHintRendersNothing() {
        mount(visible = false)

        compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG).assertDoesNotExist()
    }

    // ── State transition: the web `visible` toggle shows then hides the pill ──────────────────────────────

    @Test
    fun togglingVisibilityShowsThenHidesThePill() {
        var visible by mutableStateOf(false)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GotoIndicator(visible = visible, logger = RecordingLogger())
            }
        }

        compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG).assertDoesNotExist()

        compose.runOnUiThread { visible = true }
        compose.waitForIdle()
        compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG).assertExists()

        compose.runOnUiThread { visible = false }
        compose.waitForIdle()
        compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG).assertDoesNotExist()
    }

    // ── Accessibility: a passive hint — no interactive node, and a merged spoken description ───────────────

    @Test
    fun theVisiblePillExposesNoInteractiveNode() {
        mount(visible = true)

        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun theVisiblePillVoicesTheLabelAndKeyGlyphsToTalkBack() {
        mount(visible = true)

        val pill = compose.onNodeWithTag(GOTO_INDICATOR_TEST_TAG)
        pill.assertContentDescriptionContains("Go to", substring = true)
        pill.assertContentDescriptionContains("g", substring = true)
        pill.assertContentDescriptionContains("?", substring = true)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────────

    @Test
    fun becomingVisibleEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        mount(visible = true, logger = logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "GotoIndicator"), fields)
    }

    @Test
    fun aDismissedHintEmitsNoDiagnostic() {
        val logger = RecordingLogger()
        mount(visible = false, logger = logger)

        assertEquals(0, logger.records.size)
    }

    private fun mount(
        visible: Boolean,
        logger: Logger = RecordingLogger(),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GotoIndicator(visible = visible, logger = logger)
            }
        }
        compose.waitForIdle()
    }

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
