// Off-device coverage of [CopyLinkButtonViewModel] against a recording [ClipboardWriter] and the real
// [DefaultToastController] seam — every behaviour the web `CopyLinkButton` handler defines over `useToast`:
// a successful copy writes the link, flips to the copied confirmation, raises a success toast, records the
// PII-safe outcome, and reverts after the two-second window; a rejected copy keeps the button idle and
// raises an error toast; a repeated copy restarts the revert timer; and the one-shot `view.opened`
// diagnostic. The framework-free model is covered by CopyLinkButtonModelTest. Runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

import io.teslasync.android.sharedsurfaces.toast.DefaultToastController
import io.teslasync.android.sharedsurfaces.toast.ToastTone
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CopyLinkButtonViewModelTest {
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

    private val copy = CopyLinkToastCopy(success = "Link copied to clipboard", error = "Could not copy link")
    private val link = "https://app.teslasync.io/drives?range=7d"
    private val label = "Copy link to this view"

    private fun outcomes(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_COPY }.map { it.fields.getValue(FIELD_OUTCOME) }

    @Test
    fun successfulCopyWritesTheLinkFlipsStateAndRaisesSuccessToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val clipboard = RecordingClipboard(accept = true)
            val toast = DefaultToastController()
            val model = CopyLinkButtonViewModel(clipboard, toast, logger, backgroundScope)

            model.copyLink(link = link, label = label, copy = copy)

            assertEquals(listOf(label to link), clipboard.writes)
            assertTrue(model.state.value.copied)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Success, raised.tone)
            assertEquals(copy.success, raised.title)
            assertEquals(listOf("copied"), outcomes(logger))
        }

    @Test
    fun copiedConfirmationRevertsAfterTheTwoSecondWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyLinkButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copyLink(link = link, label = label, copy = copy)
            runCurrent()
            assertTrue(model.state.value.copied)

            advanceTimeBy(COPIED_RESET_MILLIS + 1)
            runCurrent()
            assertFalse(model.state.value.copied)
        }

    @Test
    fun rejectedCopyKeepsButtonIdleAndRaisesErrorToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val clipboard = RecordingClipboard(accept = false)
            val toast = DefaultToastController()
            val model = CopyLinkButtonViewModel(clipboard, toast, logger, backgroundScope)

            model.copyLink(link = link, label = label, copy = copy)
            advanceUntilIdle()

            assertEquals(listOf(label to link), clipboard.writes)
            assertFalse(model.state.value.copied)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Error, raised.tone)
            assertEquals(copy.error, raised.title)
            assertEquals(listOf("failed"), outcomes(logger))
        }

    @Test
    fun repeatedCopyRestartsTheRevertTimer() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyLinkButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copyLink(link = link, label = label, copy = copy)
            runCurrent()
            advanceTimeBy(COPIED_RESET_MILLIS - 1)
            runCurrent()
            assertTrue(model.state.value.copied)

            // A second copy just before the first deadline restarts the timer: the original deadline must
            // NOT revert the button (the first timer was cancelled by scheduleReset).
            model.copyLink(link = link, label = label, copy = copy)
            runCurrent()
            advanceTimeBy(2L)
            runCurrent()
            assertTrue(model.state.value.copied)

            advanceTimeBy(COPIED_RESET_MILLIS)
            runCurrent()
            assertFalse(model.state.value.copied)
        }

    @Test
    fun copyDiagnosticsNeverCarryTheCopiedLink() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyLinkButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copyLink(link = link, label = label, copy = copy)

            // No diagnostics field ever carries the link / URL — only the surface slug + the outcome enum.
            assertTrue(logger.records.all { record -> record.fields.values.none { it == link } })
            val copyRecord = logger.records.single { it.event == EVENT_COPY }
            assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), copyRecord.fields.keys)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyLinkButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(CopyLinkButtonRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
