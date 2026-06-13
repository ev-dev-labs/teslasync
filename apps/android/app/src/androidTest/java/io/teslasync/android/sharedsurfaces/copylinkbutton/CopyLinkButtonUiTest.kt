// On-device verification of the CopyLinkButton surface — the parity port of the web `CopyLinkButton`
// (web/src/components/layout/CopyLinkButton.tsx). Covers what the offline unit tests cannot: the button
// renders one clickable node carrying the visible "Copy link" label and the overriding accessible name
// (web `aria-label`), a tap copies the caller-supplied link through the bound clipboard seam and flips to
// the "Copied" confirmation while raising a success toast, a rejected copy keeps the button idle and
// raises an error toast, and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
// :android:testReleaseUnitTest gate covers the pure model + the state holder over the seams.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

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

class CopyLinkButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val rootTag = CopyLinkButtonRegistration.ROOT_TEST_TAG
    private val link = "https://app.teslasync.io/drives?range=7d"

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

        override fun writeLink(
            label: String,
            link: String,
        ): Boolean {
            writes += label to link
            return accept
        }
    }

    private fun str(id: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    // ── Render contract: visible action label + overriding accessible name (web aria-label) ─────────────

    @Test
    fun idleButtonShowsActionLabelAndAccessibleName() {
        mount {
            CopyLinkButton(
                link = { link },
                clipboard = RecordingClipboard(accept = true),
                toast = DefaultToastController(),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(rootTag).assertHasClickAction()
        compose.onNodeWithText(str(R.string.translation_common_copyLink_action), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(str(R.string.translation_common_copyLink_label)).assertIsDisplayed()
    }

    // ── State: tap copies the link, flips to "Copied", and raises a success toast ───────────────────────

    @Test
    fun tappingCopiesTheLinkShowsCopiedAndRaisesSuccessToast() {
        val clipboard = RecordingClipboard(accept = true)
        val toast = DefaultToastController()
        mount {
            CopyLinkButton(link = { link }, clipboard = clipboard, toast = toast, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(listOf(str(R.string.translation_common_copyLink_label) to link), clipboard.writes)
        compose.onNodeWithText(str(R.string.translation_common_copyLink_copied), useUnmergedTree = true).assertIsDisplayed()
        val raised = toast.toasts.value.single()
        assertEquals(ToastTone.Success, raised.tone)
        assertEquals(str(R.string.translation_common_copyLink_success), raised.title)
    }

    // ── State: a rejected copy keeps the button idle and raises an error toast (web catch) ──────────────

    @Test
    fun rejectedCopyKeepsActionLabelAndRaisesErrorToast() {
        val clipboard = RecordingClipboard(accept = false)
        val toast = DefaultToastController()
        mount {
            CopyLinkButton(link = { link }, clipboard = clipboard, toast = toast, logger = RecordingLogger())
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        assertEquals(1, clipboard.writes.size)
        compose.onNodeWithText(str(R.string.translation_common_copyLink_action), useUnmergedTree = true).assertIsDisplayed()
        val raised = toast.toasts.value.single()
        assertEquals(ToastTone.Error, raised.tone)
        assertEquals(str(R.string.translation_common_copyLink_error), raised.title)
    }

    // ── Render: the stateless copied branch (deterministic, no timing) ──────────────────────────────────

    @Test
    fun copiedContentRendersTheCopiedLabel() {
        mount {
            CopyLinkButtonContent(
                copied = true,
                copyLabel = str(R.string.translation_common_copyLink_action),
                copiedLabel = str(R.string.translation_common_copyLink_copied),
                accessibleLabel = str(R.string.translation_common_copyLink_label),
                onCopy = {},
            )
        }

        compose.onNodeWithText(str(R.string.translation_common_copyLink_copied), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(str(R.string.translation_common_copyLink_label)).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            CopyLinkButton(
                link = { link },
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
        assertEquals(mapOf(FIELD_SURFACE to CopyLinkButtonRegistration.SLUG), record.fields)
        assertTrue(logger.records.all { r -> r.fields.values.none { it == link } })
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
