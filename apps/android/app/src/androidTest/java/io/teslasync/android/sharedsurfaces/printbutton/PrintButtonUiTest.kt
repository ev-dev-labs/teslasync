// On-device verification of the PrintButton surface — the parity port of the web `PrintButton`
// (web/src/components/ui/PrintButton.tsx). Covers what the offline unit tests cannot: the labelled button
// renders one clickable node carrying the visible "Print" label, a tap drives the bound launcher seam
// through the state holder, the icon-only variant exposes the state-derived accessible name (web
// `aria-label`) with no visible text, an explicit `ariaLabel` names a labelled button, the disabled button
// is inert, and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
// :android:testReleaseUnitTest gate covers the pure model + the state holder over the seams.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class PrintButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val rootTag = PrintButtonRegistration.ROOT_TEST_TAG

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

    private class RecordingLauncher(
        private val accept: Boolean = true,
    ) : PrintLauncher {
        var calls = 0

        override fun print(): Boolean {
            calls++
            return accept
        }
    }

    private val immediateFrame = FrameSynchronizer {}

    private fun str(id: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    // ── Render contract: visible "Print" label + click action that drives the launcher ─────────────────

    @Test
    fun labeledButtonShowsPrintLabelAndLaunchesOnTap() {
        val launcher = RecordingLauncher()
        mount {
            PrintButton(launcher = launcher, frame = immediateFrame, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).assertHasClickAction()
        compose.onNodeWithText(str(R.string.translation_common_printButton_print), useUnmergedTree = true).assertIsDisplayed()

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()
        assertEquals(1, launcher.calls)
    }

    // ── Variant: icon-only exposes the accessible name and launches the dialog ──────────────────────────

    @Test
    fun iconOnlyExposesAccessibleNameAndLaunchesOnTap() {
        val launcher = RecordingLauncher()
        mount {
            PrintButton(launcher = launcher, iconOnly = true, frame = immediateFrame, logger = RecordingLogger())
        }

        compose.onNodeWithContentDescription(str(R.string.translation_common_printButton_print)).assertIsDisplayed()
        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()
        assertEquals(1, launcher.calls)
    }

    // ── Accessibility: an explicit ariaLabel names a labelled button (web `aria-label`) ─────────────────

    @Test
    fun explicitAriaLabelNamesTheLabeledButton() {
        mount {
            PrintButton(
                launcher = RecordingLauncher(),
                ariaLabel = ARIA_LABEL,
                frame = immediateFrame,
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithContentDescription(ARIA_LABEL).assertIsDisplayed()
    }

    // ── Disabled: the button is inert (web `disabled`) ──────────────────────────────────────────────────

    @Test
    fun disabledButtonIsNotEnabled() {
        mount {
            PrintButton(launcher = RecordingLauncher(), enabled = false, frame = immediateFrame, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).assertIsNotEnabled()
    }

    // ── Render: the stateless labelled branch (deterministic, no holder) ────────────────────────────────

    @Test
    fun contentRendersThePrintLabel() {
        mount {
            PrintButtonContent(
                visibleLabel = str(R.string.translation_common_printButton_print),
                accessibleLabel = null,
                iconOnly = false,
                onPrint = {},
            )
        }

        compose.onNodeWithText(str(R.string.translation_common_printButton_print), useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            PrintButton(launcher = RecordingLauncher(), frame = immediateFrame, logger = logger)
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG), record.fields)
        assertTrue(logger.records.all { r -> r.fields.keys.all { it == FIELD_SURFACE || it == FIELD_OUTCOME } })
    }

    private fun mount(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                content()
            }
        }
        compose.waitForIdle()
    }

    private companion object {
        private const val ARIA_LABEL = "Print this report"
    }
}
