// Off-device coverage of [PrintButtonViewModel] against recording [PrintLauncher] + [FrameSynchronizer]
// doubles — every behaviour the web `PrintButton` handler defines: a tap flips to `printing`, awaits the
// optional `beforePrint` hook, waits one frame, launches the dialog, records the PII-safe outcome, and
// reverts to idle; a second tap while a print is in flight is ignored (web `if (printing) return`); a
// thrown `beforePrint` records the error, never launches the dialog, and still reverts to idle (web
// `catch`); a platform-rejected launch records the failed outcome; and the one-shot `view.opened`
// diagnostic. The framework-free model is covered by PrintButtonModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PrintButtonViewModelTest {
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
        private val accept: Boolean,
    ) : PrintLauncher {
        var calls = 0

        override fun print(): Boolean {
            calls++
            return accept
        }
    }

    private class RecordingFrame : FrameSynchronizer {
        var awaited = 0

        override suspend fun awaitFrame() {
            awaited++
        }
    }

    private fun outcomes(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_PRINT }.map { it.fields.getValue(FIELD_OUTCOME) }

    @Test
    fun tapAwaitsAFrameLaunchesTheDialogAndRecordsLaunched() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = true)
            val frame = RecordingFrame()
            val model = PrintButtonViewModel(launcher, frame, logger, backgroundScope)

            model.print(beforePrint = null)
            advanceUntilIdle()

            assertEquals(1, frame.awaited)
            assertEquals(1, launcher.calls)
            assertFalse(model.state.value.printing)
            assertEquals(listOf("launched"), outcomes(logger))
        }

    @Test
    fun beforePrintRunsBeforeTheDialogIsLaunched() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = true)
            val order = mutableListOf<String>()
            val model = PrintButtonViewModel(launcher, RecordingFrame(), logger, backgroundScope)

            model.print(beforePrint = { order += "before" })
            advanceUntilIdle()
            order += "after"

            // beforePrint resolves before the dialog launch — the web `await beforePrint()` then `window.print()`.
            assertEquals(listOf("before", "after"), order)
            assertEquals(1, launcher.calls)
        }

    @Test
    fun printingFlagIsHeldWhileBeforePrintRunsThenRevertsToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = true)
            val gate = CompletableDeferred<Unit>()
            val model = PrintButtonViewModel(launcher, RecordingFrame(), logger, backgroundScope)

            model.print(beforePrint = { gate.await() })
            runCurrent()
            // The hook is suspended, so the re-entry guard is held.
            assertTrue(model.state.value.printing)
            assertEquals(0, launcher.calls)

            gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(model.state.value.printing)
            assertEquals(1, launcher.calls)
        }

    @Test
    fun aSecondTapWhilePrintingIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = true)
            val gate = CompletableDeferred<Unit>()
            val model = PrintButtonViewModel(launcher, RecordingFrame(), logger, backgroundScope)

            model.print(beforePrint = { gate.await() })
            runCurrent()
            // Web `if (printing) return`: the second tap must not launch a second dialog.
            model.print(beforePrint = { gate.await() })
            runCurrent()

            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(1, launcher.calls)
            assertEquals(listOf("launched"), outcomes(logger))
        }

    @Test
    fun aThrownBeforePrintRecordsTheErrorAndNeverLaunchesTheDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = true)
            val frame = RecordingFrame()
            val model = PrintButtonViewModel(launcher, frame, logger, backgroundScope)

            model.print(beforePrint = { error("expand failed") })
            advanceUntilIdle()

            // Web `catch`: the dialog is never opened, the frame is never awaited, the button reverts to idle.
            assertEquals(0, launcher.calls)
            assertEquals(0, frame.awaited)
            assertFalse(model.state.value.printing)
            val errorRecord = logger.records.single { it.event == EVENT_BEFORE_PRINT_ERROR }
            assertEquals(LogLevel.Error, errorRecord.level)
            assertEquals("IllegalStateException", errorRecord.fields[FIELD_ERROR_TYPE])
            assertTrue(outcomes(logger).isEmpty())
        }

    @Test
    fun aPlatformRejectedLaunchRecordsTheFailedOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val launcher = RecordingLauncher(accept = false)
            val model = PrintButtonViewModel(launcher, RecordingFrame(), logger, backgroundScope)

            model.print(beforePrint = null)
            advanceUntilIdle()

            assertEquals(1, launcher.calls)
            assertFalse(model.state.value.printing)
            assertEquals(listOf("failed"), outcomes(logger))
        }

    @Test
    fun printDiagnosticsNeverCarryPageContent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = PrintButtonViewModel(RecordingLauncher(accept = true), RecordingFrame(), logger, backgroundScope)

            model.print(beforePrint = null)
            advanceUntilIdle()

            val allowedKeys = setOf(FIELD_SURFACE, FIELD_OUTCOME, FIELD_ERROR_TYPE)
            assertTrue(logger.records.all { record -> record.fields.keys.all { it in allowedKeys } })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = PrintButtonViewModel(RecordingLauncher(accept = true), RecordingFrame(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(PrintButtonRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
