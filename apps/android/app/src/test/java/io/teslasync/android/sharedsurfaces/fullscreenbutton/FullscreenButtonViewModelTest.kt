// Off-device coverage of [FullscreenButtonViewModel] against a recording [FullscreenController] fake — every
// behaviour the web `FullscreenButton` defines over the Fullscreen API: it seeds state from the controller's
// support + current-state reads, mirrors the `fullscreenchange` stream onto the render state (even without a
// tap), resolves a tap to enter/exit and drives the controller, records the PII-safe toggle outcome, no-ops on
// an unsupported host, and emits the one-shot `view.opened` diagnostic. The framework-free model is covered by
// FullscreenButtonModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FullscreenButtonViewModelTest {
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

    private class FakeFullscreenController(
        override val isSupported: Boolean = true,
        initial: Boolean = false,
    ) : FullscreenController {
        val changes = MutableStateFlow(initial)
        var enterCount = 0
        var exitCount = 0

        override fun isFullscreen(): Boolean = changes.value

        override fun fullscreenChanges(): Flow<Boolean> = changes.asStateFlow()

        override fun enter() {
            enterCount++
            changes.value = true
        }

        override fun exit() {
            exitCount++
            changes.value = false
        }
    }

    private fun toggleActions(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_TOGGLE }.map { it.fields.getValue(FIELD_ACTION) }

    @Test
    fun initialStateReflectsControllerSupportAndCurrentState() =
        runTest(UnconfinedTestDispatcher()) {
            val supported =
                FullscreenButtonViewModel(
                    FakeFullscreenController(isSupported = true, initial = false),
                    RecordingLogger(),
                    backgroundScope,
                )
            assertTrue(supported.state.value.supported)
            assertFalse(supported.state.value.isFullscreen)

            val alreadyFullscreen =
                FullscreenButtonViewModel(FakeFullscreenController(initial = true), RecordingLogger(), backgroundScope)
            runCurrent()
            assertTrue(alreadyFullscreen.state.value.isFullscreen)

            val unsupported =
                FullscreenButtonViewModel(FakeFullscreenController(isSupported = false), RecordingLogger(), backgroundScope)
            assertFalse(unsupported.state.value.supported)
        }

    @Test
    fun togglingFromNotFullscreenEntersAndSyncsState() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val controller = FakeFullscreenController(initial = false)
            val model = FullscreenButtonViewModel(controller, logger, backgroundScope)

            model.toggle()
            runCurrent()

            assertEquals(1, controller.enterCount)
            assertEquals(0, controller.exitCount)
            assertTrue(model.state.value.isFullscreen)
            assertEquals(listOf("enter"), toggleActions(logger))
        }

    @Test
    fun togglingFromFullscreenExitsAndSyncsState() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val controller = FakeFullscreenController(initial = true)
            val model = FullscreenButtonViewModel(controller, logger, backgroundScope)
            runCurrent()

            model.toggle()
            runCurrent()

            assertEquals(1, controller.exitCount)
            assertEquals(0, controller.enterCount)
            assertFalse(model.state.value.isFullscreen)
            assertEquals(listOf("exit"), toggleActions(logger))
        }

    @Test
    fun externalFullscreenChangeSyncsStateWithoutATap() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val controller = FakeFullscreenController(initial = false)
            val model = FullscreenButtonViewModel(controller, logger, backgroundScope)
            runCurrent()
            assertFalse(model.state.value.isFullscreen)

            // The host/system enters fullscreen without a tap (web `fullscreenchange` fired by Esc / a sibling).
            controller.changes.value = true
            runCurrent()

            assertTrue(model.state.value.isFullscreen)
            assertEquals(0, controller.enterCount)
            assertEquals(0, controller.exitCount)
            assertTrue(toggleActions(logger).isEmpty())
        }

    @Test
    fun toggleIsANoOpOnAnUnsupportedHost() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val controller = FakeFullscreenController(isSupported = false)
            val model = FullscreenButtonViewModel(controller, logger, backgroundScope)

            model.toggle()
            runCurrent()

            assertEquals(0, controller.enterCount)
            assertEquals(0, controller.exitCount)
            assertTrue(toggleActions(logger).isEmpty())
        }

    @Test
    fun toggleDiagnosticsNeverCarryUserData() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = FullscreenButtonViewModel(FakeFullscreenController(), logger, backgroundScope)

            model.toggle()
            runCurrent()

            val record = logger.records.single { it.event == EVENT_TOGGLE }
            assertEquals(setOf(FIELD_SURFACE, FIELD_ACTION), record.fields.keys)
            assertEquals(FullscreenButtonRegistration.SLUG, record.fields[FIELD_SURFACE])
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = FullscreenButtonViewModel(FakeFullscreenController(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(FullscreenButtonRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
