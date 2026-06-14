// On-device verification of the HelpTooltip surface — the parity port of the web `HelpTooltip`
// (web/src/components/ui/HelpTooltip.tsx). Covers what the offline unit tests cannot: the "?" trigger
// renders one clickable node whose accessible name overrides the glyph (web `aria-label`), tapping it
// reveals the explanatory body, the "Learn more" affordance opens the caller-supplied link through the
// bound [LinkOpener] seam, a caller-supplied trigger overrides the default icon while keeping the accessible
// name, and the one-shot PII-safe `view.opened` diagnostic fires on mount without ever logging the URL. The
// offline :android:testReleaseUnitTest gate covers the pure model + the state holder over the seam.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HelpTooltipUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val triggerTag = HelpTooltipRegistration.TRIGGER_TEST_TAG
    private val learnMoreTag = HelpTooltipRegistration.LEARN_MORE_TEST_TAG
    private val body = "Energy lost while parked, from cabin overheat protection and sentry mode."
    private val label = "More info about vampire drain"

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

    private class RecordingOpener(
        private val accept: Boolean = true,
    ) : LinkOpener {
        val opened = mutableListOf<String>()

        override fun open(url: String): Boolean {
            opened += url
            return accept
        }
    }

    // ── Render + a11y: the trigger is one clickable node carrying the overriding accessible name ─────────

    @Test
    fun triggerExposesTheAccessibleNameAndClickAction() {
        mount {
            HelpTooltip(text = body, ariaLabel = label, opener = RecordingOpener(), logger = RecordingLogger())
        }

        compose.onNodeWithTag(triggerTag).assertHasClickAction()
        compose.onNodeWithContentDescription(label).assertIsDisplayed()
    }

    // ── State: tapping the trigger reveals the explanatory body ─────────────────────────────────────────

    @Test
    fun tappingTheTriggerRevealsTheBody() {
        mount {
            HelpTooltip(text = body, ariaLabel = label, opener = RecordingOpener(), logger = RecordingLogger())
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(body, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: the "Learn more" affordance opens the link through the bound seam ─────────────────────────

    @Test
    fun tappingLearnMoreOpensTheLinkThroughTheHolder() {
        val opener = RecordingOpener()
        val url = "https://docs.teslasync.io/vampire-drain"
        mount {
            HelpTooltip(
                text = body,
                ariaLabel = label,
                learnMore = HelpTooltipLearnMore(url = url, label = "Read the docs"),
                opener = opener,
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(learnMoreTag, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(learnMoreTag, useUnmergedTree = true).performClick()
        compose.waitForIdle()

        assertEquals(listOf(url), opener.opened)
    }

    // ── State: a caller-supplied trigger overrides the default icon but keeps the accessible name ────────

    @Test
    fun customTriggerOverridesTheDefaultIconButKeepsTheAccessibleName() {
        mount {
            HelpTooltip(
                text = body,
                ariaLabel = label,
                trigger = { Text("(i)") },
                opener = RecordingOpener(),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithText("(i)", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label).assertIsDisplayed()
        compose.onNodeWithTag(triggerTag).assertHasClickAction()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11), never carrying the URL ─────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticWithoutTheUrl() {
        val logger = RecordingLogger()
        val url = "https://docs.teslasync.io/secret?token=abc123"
        mount {
            HelpTooltip(
                text = body,
                ariaLabel = label,
                learnMore = HelpTooltipLearnMore(url = url),
                opener = RecordingOpener(),
                logger = logger,
            )
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to HelpTooltipRegistration.SLUG), record.fields)
        assertTrue(logger.records.all { r -> r.fields.values.none { it.contains("token") } })
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
