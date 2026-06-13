// Tests [SkipToContentViewModel] against the real [RegistrySkipTarget] seam — covering the one-shot
// `view.opened` diagnostic, the activation that moves focus to a registered main-content landmark and records
// the `moved` outcome (web `if (main) { main.focus() … }`), the no-op activation that records `noTarget` when
// no landmark is registered (web `getElementById` returning `null`), the PII-safe activation diagnostic
// (surface slug + coarse outcome only), and the registry's register / invoke / release / single-landmark
// semantics. The framework-free model is covered by SkipToContentModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SkipToContentViewModelTest {
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

    private class RecordingTarget(
        private val present: Boolean,
    ) : SkipTarget {
        var calls = 0

        override fun focusMainContent(): Boolean {
            calls++
            return present
        }
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = SkipToContentViewModel(RecordingTarget(present = false), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SkipToContent", opened.first().fields["surface"])
        }

    @Test
    fun skipMovesFocusAndRecordsMovedWhenLandmarkPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val target = RecordingTarget(present = true)
            val model = SkipToContentViewModel(target, logger, backgroundScope)

            model.skipToContent()

            assertEquals(1, target.calls)
            val record = logger.records.single { it.event == "skipToContent.activate" }
            assertEquals(mapOf("surface" to "SkipToContent", "outcome" to "moved"), record.fields)
        }

    @Test
    fun skipRecordsNoTargetWhenNoLandmarkIsRegistered() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val target = RecordingTarget(present = false)
            val model = SkipToContentViewModel(target, logger, backgroundScope)

            model.skipToContent()

            assertEquals(1, target.calls)
            val record = logger.records.single { it.event == "skipToContent.activate" }
            assertEquals("noTarget", record.fields["outcome"])
        }

    @Test
    fun skipDiagnosticCarriesNoPageContent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = SkipToContentViewModel(RecordingTarget(present = true), logger, backgroundScope)

            model.skipToContent()

            val record = logger.records.single { it.event == "skipToContent.activate" }
            // Only the surface slug and the coarse outcome — no label, route, or page content.
            assertEquals(setOf("surface", "outcome"), record.fields.keys)
        }

    // ── the real RegistrySkipTarget seam the surface binds in production ────────────────────────────────

    @Test
    fun registrySkipTargetInvokesRegisteredLandmarkAndReportsPresence() {
        val registry = RegistrySkipTarget()
        var focused = 0
        assertFalse(registry.hasTarget)
        assertFalse(registry.focusMainContent())

        val handle = registry.register { focused++ }
        assertTrue(registry.hasTarget)
        assertTrue(registry.focusMainContent())
        assertEquals(1, focused)

        handle.release()
        assertFalse(registry.hasTarget)
        assertFalse(registry.focusMainContent())
        assertEquals(1, focused)
    }

    @Test
    fun registrySkipTargetReleaseDoesNotClobberANewerLandmark() {
        val registry = RegistrySkipTarget()
        var second = 0
        val firstHandle = registry.register { }
        registry.register { second++ }

        // The first landmark disposing must not clear the second screen's registration.
        firstHandle.release()

        assertTrue(registry.hasTarget)
        assertTrue(registry.focusMainContent())
        assertEquals(1, second)
    }
}
