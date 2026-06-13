// Tests [HelpSegmentViewModel] against a fake [HelpActions] seam and the real [RegistryHelpActions] registry —
// covering the one-shot `view.opened` diagnostic, the invocation that dispatches the chosen affordance through
// the seam and records the `handled` outcome (web: an event listener firing), the no-op invocation that records
// `noListener` when nothing is mounted (web: an event landing with no listener), the PII-safe invocation
// diagnostic (surface slug + coarse action + outcome only), and the registry's register / dispatch / release /
// single-handler / per-action-isolation semantics. The framework-free model is covered by HelpSegmentModelTest.
// Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HelpSegmentViewModelTest {
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

    private class RecordingActions(
        private val present: Boolean,
    ) : HelpActions {
        val opened = mutableListOf<HelpAction>()

        override fun open(action: HelpAction): Boolean {
            opened += action
            return present
        }
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = HelpSegmentViewModel(RecordingActions(present = true), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("HelpSegment", opened.first().fields["surface"])
        }

    @Test
    fun invokeDispatchesTheActionAndRecordsHandledWhenListenerPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val actions = RecordingActions(present = true)
            val model = HelpSegmentViewModel(actions, logger, backgroundScope)

            model.invoke(HelpAction.Shortcuts)

            assertEquals(listOf(HelpAction.Shortcuts), actions.opened)
            val record = logger.records.single { it.event == "helpSegment.invoke" }
            assertEquals(
                mapOf("surface" to "HelpSegment", "action" to "shortcuts", "outcome" to "handled"),
                record.fields,
            )
        }

    @Test
    fun invokeRecordsNoListenerWhenNothingIsMounted() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val actions = RecordingActions(present = false)
            val model = HelpSegmentViewModel(actions, logger, backgroundScope)

            model.invoke(HelpAction.Feedback)

            assertEquals(listOf(HelpAction.Feedback), actions.opened)
            val record = logger.records.single { it.event == "helpSegment.invoke" }
            assertEquals("noListener", record.fields["outcome"])
        }

    @Test
    fun invokeDiagnosticCarriesNoHelpCopy() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = HelpSegmentViewModel(RecordingActions(present = true), logger, backgroundScope)

            model.invoke(HelpAction.Tour)

            val record = logger.records.single { it.event == "helpSegment.invoke" }
            // Only the surface slug and the coarse action + outcome — no tooltip, label, or help copy.
            assertEquals(setOf("surface", "action", "outcome"), record.fields.keys)
        }

    // ── the real RegistryHelpActions seam the surface binds in production ────────────────────────────────

    @Test
    fun registryInvokesRegisteredHandlerAndReportsPresence() {
        val registry = RegistryHelpActions()
        var fired = 0
        assertFalse(registry.isRegistered(HelpAction.Shortcuts))
        assertFalse(registry.open(HelpAction.Shortcuts))

        val handle = registry.register(HelpAction.Shortcuts) { fired++ }
        assertTrue(registry.isRegistered(HelpAction.Shortcuts))
        assertTrue(registry.open(HelpAction.Shortcuts))
        assertEquals(1, fired)

        handle.release()
        assertFalse(registry.isRegistered(HelpAction.Shortcuts))
        assertFalse(registry.open(HelpAction.Shortcuts))
        assertEquals(1, fired)
    }

    @Test
    fun registryReleaseDoesNotClobberANewerHandler() {
        val registry = RegistryHelpActions()
        var second = 0
        val firstHandle = registry.register(HelpAction.Tour) { }
        registry.register(HelpAction.Tour) { second++ }

        // The first host disposing must not clear the second host's registration for the same action.
        firstHandle.release()

        assertTrue(registry.isRegistered(HelpAction.Tour))
        assertTrue(registry.open(HelpAction.Tour))
        assertEquals(1, second)
    }

    @Test
    fun registryRoutesEachActionToItsOwnHandlerIndependently() {
        val registry = RegistryHelpActions()
        val dispatched = mutableListOf<HelpAction>()
        registry.register(HelpAction.Shortcuts) { dispatched += HelpAction.Shortcuts }
        registry.register(HelpAction.Feedback) { dispatched += HelpAction.Feedback }

        assertTrue(registry.open(HelpAction.Feedback))
        // Tour was never registered, so it stays an unhandled no-op while the others are isolated.
        assertFalse(registry.open(HelpAction.Tour))
        assertTrue(registry.open(HelpAction.Shortcuts))

        assertEquals(listOf(HelpAction.Feedback, HelpAction.Shortcuts), dispatched)
    }

    @Test
    fun processHelpActionsSingletonStartsWithNoHandlers() {
        // The shared production registry exists and is inert until a host mounts a handler.
        HelpAction.entries.forEach { action ->
            assertFalse(ProcessHelpActions.isRegistered(action))
        }
        assertNull(HelpAction.entries.firstOrNull { ProcessHelpActions.open(it) })
    }
}
