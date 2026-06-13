// On-device verification of the SkipToContent surface — the parity port of the web `SkipToContent`
// (web/src/components/feedback/SkipToContent.tsx). Covers what the offline unit tests cannot: the resting link
// renders as ONE clickable Role.Button node that is labelled for assistive technologies yet keeps its visible
// chip hidden (web `sr-only`), focusing it reveals the high-contrast chip (web `focus:not-sr-only`), tapping
// fires the activation (web `onClick`), activation moves focus to the registered main-content landmark (web
// `main.focus()`), and the one-shot PII-safe `view.opened` diagnostic fires. The offline
// :android:testReleaseUnitTest gate covers the pure model + the state-holder over the seam. Each test binds its
// own [RegistrySkipTarget] so the process singleton is never polluted across cases.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.requestFocus
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SkipToContentUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val label = "Skip to main content"
    private val tag = SKIP_TO_CONTENT_TEST_TAG
    private val mainTag = "skip-to-content-main"

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

    // ── State: resting (hidden) — one labelled, clickable node whose visible chip is not yet shown ──────

    @Test
    fun rendersHiddenSkipLinkThatIsLabelledAndClickable() {
        mount { SkipToContentContent(label = label, onActivate = {}) }

        compose.onNodeWithTag(tag).assertExists()
        compose.onNodeWithTag(tag).assertHasClickAction()
        compose.onNodeWithContentDescription(label).assertExists()
        // The visible chip is revealed only on focus (web `focus:not-sr-only`).
        compose.onNodeWithText(label, useUnmergedTree = true).assertDoesNotExist()
    }

    // ── State: revealed on focus — the high-contrast chip carrying the label appears ────────────────────

    @Test
    fun revealsTheChipWhenFocused() {
        mount { SkipToContentContent(label = label, onActivate = {}) }

        compose.onNodeWithTag(tag).requestFocus()
        compose.waitForIdle()

        compose.onNodeWithTag(tag).assertIsFocused()
        compose.onNodeWithText(label, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Activation: tapping fires the activation callback (web `onClick`) ───────────────────────────────

    @Test
    fun activatingTheLinkFiresOnActivate() {
        var activated = 0
        mount { SkipToContentContent(label = label, onActivate = { activated++ }) }

        compose.onNodeWithTag(tag).performClick()
        compose.waitForIdle()

        assertEquals(1, activated)
    }

    // ── Integration: activation moves focus to the registered main-content landmark (web `main.focus()`) ─

    @Test
    fun activationMovesFocusToTheRegisteredMainContent() {
        val target = RegistrySkipTarget()
        mount {
            Column {
                SkipToContent(target = target, logger = RecordingLogger())
                Box(Modifier.testTag(mainTag).mainContentAnchor(target))
            }
        }

        compose.onNodeWithTag(tag).performClick()
        compose.waitForIdle()

        compose.onNodeWithTag(mainTag).assertIsFocused()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount { SkipToContent(target = RegistrySkipTarget(), logger = logger) }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to SkipToContentRegistration.SLUG), record.fields)
    }

    private fun mount(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                content()
            }
        }
        compose.waitForIdle()
    }
}
