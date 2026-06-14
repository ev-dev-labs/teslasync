// Off-device coverage of [CopyButtonViewModel] against a recording [ClipboardWriter] and the real
// [DefaultToastController] seam — every behaviour the web `CopyButton` handler defines over
// `useOptionalToast`: a successful copy writes the text, flips to the copied confirmation, invokes the
// host `onCopy`, raises a success toast only when toast copy was supplied (web `withToast`), records the
// PII-safe outcome, and reverts after the two-second window; a rejected copy keeps the button idle, skips
// `onCopy`, and raises an error toast only when toast copy was supplied; a repeated copy restarts the
// revert timer; a null toast holder (no host mounted — web `useOptionalToast` → null) never crashes; and
// the one-shot `view.opened` diagnostic. The framework-free model is covered by CopyButtonModelTest. Runs
// in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

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
class CopyButtonViewModelTest {
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

    private val copy = CopyButtonToastCopy(success = "Copied to clipboard", error = "Failed to copy")
    private val text = "5YJ3E1EA8KF000000"
    private val clipLabel = "Copy"

    private fun outcomes(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_COPY }.map { it.fields.getValue(FIELD_OUTCOME) }

    @Test
    fun successfulCopyWritesTextFlipsStateInvokesOnCopiedAndRaisesToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val clipboard = RecordingClipboard(accept = true)
            val toast = DefaultToastController()
            val model = CopyButtonViewModel(clipboard, toast, logger, backgroundScope)
            var copied = false

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = { copied = true })

            assertEquals(listOf(clipLabel to text), clipboard.writes)
            assertTrue(model.state.value.copied)
            assertTrue(copied)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Success, raised.tone)
            assertEquals(copy.success, raised.title)
            assertEquals(listOf("copied"), outcomes(logger))
        }

    @Test
    fun successfulCopyWithoutToastCopyRaisesNoToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val toast = DefaultToastController()
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), toast, logger, backgroundScope)

            // toastCopy = null is the web `withToast = false` branch: the button still flips, but no toast.
            model.copy(text = text, clipLabel = clipLabel, toastCopy = null, onCopied = {})

            assertTrue(model.state.value.copied)
            assertTrue(toast.toasts.value.isEmpty())
        }

    @Test
    fun copiedConfirmationRevertsAfterTheTwoSecondWindow() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = {})
            runCurrent()
            assertTrue(model.state.value.copied)

            advanceTimeBy(COPIED_RESET_MILLIS + 1)
            runCurrent()
            assertFalse(model.state.value.copied)
        }

    @Test
    fun rejectedCopyKeepsButtonIdleSkipsOnCopiedAndRaisesErrorToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val clipboard = RecordingClipboard(accept = false)
            val toast = DefaultToastController()
            val model = CopyButtonViewModel(clipboard, toast, logger, backgroundScope)
            var copied = false

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = { copied = true })
            advanceUntilIdle()

            assertEquals(listOf(clipLabel to text), clipboard.writes)
            assertFalse(model.state.value.copied)
            assertFalse(copied)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Error, raised.tone)
            assertEquals(copy.error, raised.title)
            assertEquals(listOf("failed"), outcomes(logger))
        }

    @Test
    fun rejectedCopyWithoutToastCopyRaisesNoToast() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val toast = DefaultToastController()
            val model = CopyButtonViewModel(RecordingClipboard(accept = false), toast, logger, backgroundScope)

            model.copy(text = text, clipLabel = clipLabel, toastCopy = null, onCopied = {})

            assertFalse(model.state.value.copied)
            assertTrue(toast.toasts.value.isEmpty())
            assertEquals(listOf("failed"), outcomes(logger))
        }

    @Test
    fun optionalToastWithNoHostNeverCrashes() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            // toast = null is the web `useOptionalToast` returning null with no provider mounted.
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), null, logger, backgroundScope)
            var copied = false

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = { copied = true })
            advanceUntilIdle()

            assertTrue(model.state.value.copied)
            assertTrue(copied)
            assertEquals(listOf("copied"), outcomes(logger))
        }

    @Test
    fun repeatedCopyRestartsTheRevertTimer() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = {})
            runCurrent()
            advanceTimeBy(COPIED_RESET_MILLIS - 1)
            runCurrent()
            assertTrue(model.state.value.copied)

            // A second copy just before the first deadline restarts the timer: the original deadline must
            // NOT revert the button (the first timer was cancelled by scheduleReset).
            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = {})
            runCurrent()
            advanceTimeBy(2L)
            runCurrent()
            assertTrue(model.state.value.copied)

            advanceTimeBy(COPIED_RESET_MILLIS)
            runCurrent()
            assertFalse(model.state.value.copied)
        }

    @Test
    fun copyDiagnosticsNeverCarryTheCopiedText() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.copy(text = text, clipLabel = clipLabel, toastCopy = copy, onCopied = {})

            // No diagnostics field ever carries the copied text — only the surface slug + the outcome enum.
            assertTrue(logger.records.all { record -> record.fields.values.none { it == text } })
            val copyRecord = logger.records.single { it.event == EVENT_COPY }
            assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), copyRecord.fields.keys)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = CopyButtonViewModel(RecordingClipboard(accept = true), DefaultToastController(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(CopyButtonRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
