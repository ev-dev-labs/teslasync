// On-device verification of the CopyButton surface — the parity port of the web `CopyButton`
// (web/src/components/ui/CopyButton.tsx). Covers what the offline unit tests cannot: the labelled button
// renders one clickable node carrying the visible "Copy" label, a tap copies the supplied text through
// the bound clipboard seam and flips to the "Copied" confirmation while raising a success toast (when
// `withToast` is set), a rejected copy keeps the button idle and raises an error toast, the icon-only
// variant exposes the state-derived accessible name (web `aria-label`) with no visible text, and the
// one-shot PII-safe `view.opened` diagnostic fires on mount. The offline :android:testReleaseUnitTest gate
// covers the pure model + the state holder over the seams.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.sharedsurfaces.toast.DefaultToastController
import io.teslasync.android.sharedsurfaces.toast.ToastTone
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CopyButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val rootTag = CopyButtonRegistration.ROOT_TEST_TAG
    private val text = "5YJ3E1EA8KF000000"

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

    private class RecordingClipboard(
        private val accept: Boolean,
    ) : ClipboardWriter {
        val writes = mutableListOf<Pair<String, String>>()

        override fun writeText(
            label: String,
            text: String,
        ): Boolean {
            writes += label to text
            return accept
        }
    }

    private fun str(id: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    // ── Render contract: visible "Copy" label + click action ────────────────────────────────────────────

    @Test
    fun idleLabeledButtonShowsCopyLabelAndClickAction() {
        mount {
            CopyButton(
                text = text,
                clipboard = RecordingClipboard(accept = true),
                toast = DefaultToastController(),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(rootTag).assertHasClickAction()
        compose.onNodeWithText(str(R.string.translation_common_copyButton_copy), useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: tap copies the text, flips to "Copied", and raises a success toast (withToast) ───────────

    @Test
    fun tappingCopiesTextShowsCopiedAndRaisesSuccessToast() {
        val clipboard = RecordingClipboard(accept = true)
        val toast = DefaultToastController()
        mount {
            CopyButton(text = text, withToast = true, clipboard = clipboard, toast = toast, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(listOf(str(R.string.translation_common_copyButton_copy) to text), clipboard.writes)
        compose.onNodeWithText(str(R.string.translation_common_copyButton_copied), useUnmergedTree = true).assertIsDisplayed()
        val raised = toast.toasts.value.single()
        assertEquals(ToastTone.Success, raised.tone)
        assertEquals(str(R.string.translation_common_copyButton_successToast), raised.title)
    }

    // ── State: a rejected copy keeps the button idle and raises an error toast (web catch) ──────────────

    @Test
    fun rejectedCopyKeepsCopyLabelAndRaisesErrorToast() {
        val clipboard = RecordingClipboard(accept = false)
        val toast = DefaultToastController()
        mount {
            CopyButton(text = text, withToast = true, clipboard = clipboard, toast = toast, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(1, clipboard.writes.size)
        compose.onNodeWithText(str(R.string.translation_common_copyButton_copy), useUnmergedTree = true).assertIsDisplayed()
        val raised = toast.toasts.value.single()
        assertEquals(ToastTone.Error, raised.tone)
        assertEquals(str(R.string.translation_common_copyButton_errorToast), raised.title)
    }

    // ── Variant: icon-only exposes the accessible name and copies the text ──────────────────────────────

    @Test
    fun iconOnlyExposesAccessibleNameAndCopiesText() {
        val clipboard = RecordingClipboard(accept = true)
        mount {
            CopyButton(
                text = text,
                iconOnly = true,
                clipboard = clipboard,
                toast = DefaultToastController(),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithContentDescription(str(R.string.translation_common_copyButton_copy)).assertIsDisplayed()
        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(listOf(str(R.string.translation_common_copyButton_copy) to text), clipboard.writes)
        compose.onNodeWithContentDescription(str(R.string.translation_common_copyButton_copied)).assertIsDisplayed()
    }

    // ── Render: the stateless copied branch (deterministic, no timing) ──────────────────────────────────

    @Test
    fun copiedContentRendersTheCopiedLabel() {
        mount {
            CopyButtonContent(
                copied = true,
                visibleLabel = str(R.string.translation_common_copyButton_copied),
                accessibleLabel = null,
                iconOnly = false,
                onCopy = {},
            )
        }

        compose.onNodeWithText(str(R.string.translation_common_copyButton_copied), useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            CopyButton(
                text = text,
                clipboard = RecordingClipboard(accept = true),
                toast = DefaultToastController(),
                logger = logger,
            )
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to CopyButtonRegistration.SLUG), record.fields)
        assertTrue(logger.records.all { r -> r.fields.values.none { it == text } })
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
