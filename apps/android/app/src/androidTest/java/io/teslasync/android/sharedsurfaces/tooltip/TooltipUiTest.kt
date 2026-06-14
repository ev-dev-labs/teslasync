// On-device verification of the Tooltip surface — the parity port of the web `Tooltip`
// (web/src/components/ui/Tooltip.tsx). Covers what the offline unit tests cannot: the trigger wrapper is one
// clickable node that exposes its child's accessible name (web `children`), tapping it reveals the
// inverted-surface body carrying `content` (web `:focus-within` / tap reveal), the body wraps when `multiline`
// is set, a non-default `side` still reveals the body, the reveal also works instantly under reduced motion
// (web `motion-reduce:transition-none`), and the stateful surface emits the one-shot PII-safe `view.opened`
// diagnostic (P1/S11) on mount without ever logging the content. The offline :android:testReleaseUnitTest gate
// covers the pure model + the state holder over the seam.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

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

class TooltipUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val triggerTag = TooltipRegistration.TRIGGER_TEST_TAG
    private val triggerLabel = "Open battery details"
    private val content = "Energy lost while parked, from cabin overheat protection and sentry mode."

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

    // ── Render + a11y: the trigger is one clickable node exposing its child's accessible name ────────────

    @Test
    fun triggerExposesTheChildLabelAndClickAction() {
        mount {
            TooltipContent(
                content = content,
                tooltipId = "tooltip-test",
                reduceMotion = false,
            ) { Text(triggerLabel) }
        }

        compose.onNodeWithTag(triggerTag).assertHasClickAction()
        compose.onNodeWithText(triggerLabel).assertIsDisplayed()
    }

    // ── State: tapping the trigger reveals the tooltip body ──────────────────────────────────────────────

    @Test
    fun tappingTheTriggerRevealsTheContent() {
        mount {
            TooltipContent(
                content = content,
                tooltipId = "tooltip-test",
                reduceMotion = false,
            ) { Text(triggerLabel) }
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(content, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: a multiline tooltip reveals its wrapping body ─────────────────────────────────────────────

    @Test
    fun multilineContentIsRevealed() {
        mount {
            TooltipContent(
                content = content,
                tooltipId = "tooltip-test",
                multiline = true,
                reduceMotion = false,
            ) { Text(triggerLabel) }
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithContentDescription(content, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: a non-default side still reveals the body ─────────────────────────────────────────────────

    @Test
    fun nonDefaultSideStillRevealsTheContent() {
        mount {
            TooltipContent(
                content = content,
                tooltipId = "tooltip-test",
                side = TooltipSide.Bottom,
                reduceMotion = false,
            ) { Text(triggerLabel) }
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(content, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Reduced motion: the reveal works instantly (web `motion-reduce:transition-none`) ─────────────────

    @Test
    fun reducedMotionStillRevealsTheContent() {
        mount {
            TooltipContent(
                content = content,
                tooltipId = "tooltip-test",
                reduceMotion = true,
            ) { Text(triggerLabel) }
        }

        compose.onNodeWithTag(triggerTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(content, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11), never carrying the content ──────────────

    @Test
    fun mountingTheStatefulTooltipEmitsThePiiSafeViewOpenedWithoutTheContent() {
        val logger = RecordingLogger()
        mount {
            Tooltip(
                content = content,
                idSource = StaticTooltipIdSource("tooltip-test"),
                logger = logger,
            ) { Text(triggerLabel) }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to TooltipRegistration.SLUG), record.fields)
        // The tooltip content never reaches a diagnostic field.
        assertTrue(logger.records.all { r -> r.fields.values.none { it.contains("parked") } })
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
