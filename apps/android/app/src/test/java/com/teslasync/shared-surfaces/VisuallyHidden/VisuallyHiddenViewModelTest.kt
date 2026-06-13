// Tests [VisuallyHiddenViewModel] against the real [BroadcastAnnouncer] seam — covering every state the
// announcer region renders: a polite announcement routed to the polite region, an assertive one routed to
// the assertive region, the polite default, an idle (empty-message) no-op, the rotating dedupe suffix that
// makes two identical consecutive messages distinct, both regions tracked independently, the PII-safe
// announce diagnostic (slug + urgency, never the message), and the one-shot `view.opened`. The
// framework-free model is covered by VisuallyHiddenModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VisuallyHiddenViewModelTest {
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

    @Test
    fun politeAnnouncementRoutesToPoliteRegion() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("Filter applied", AnnouncePriority.Polite)
            advanceUntilIdle()

            val state = model.state.value
            assertTrue(state.politeMessage.startsWith("Filter applied"))
            assertEquals("", state.assertiveMessage)
        }

    @Test
    fun assertiveAnnouncementRoutesToAssertiveRegion() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("Session expired", AnnouncePriority.Assertive)
            advanceUntilIdle()

            val state = model.state.value
            assertTrue(state.assertiveMessage.startsWith("Session expired"))
            assertEquals("", state.politeMessage)
        }

    @Test
    fun defaultPriorityIsPolite() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("Saved view applied")
            advanceUntilIdle()

            val state = model.state.value
            assertTrue(state.politeMessage.startsWith("Saved view applied"))
            assertEquals("", state.assertiveMessage)
        }

    @Test
    fun blankMessageLeavesBothRegionsIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("")
            advanceUntilIdle()

            assertEquals(AnnouncerState.EMPTY, model.state.value)
        }

    @Test
    fun consecutiveIdenticalMessagesEmitDistinctText() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("Selection cleared")
            advanceUntilIdle()
            val first = model.state.value.politeMessage

            model.announce("Selection cleared")
            advanceUntilIdle()
            val second = model.state.value.politeMessage

            assertTrue(first.startsWith("Selection cleared"))
            assertTrue(second.startsWith("Selection cleared"))
            assertNotEquals(first, second)
        }

    @Test
    fun bothRegionsTrackedIndependently() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            model.announce("Filter removed", AnnouncePriority.Polite)
            model.announce("Connection lost", AnnouncePriority.Assertive)
            advanceUntilIdle()

            val state = model.state.value
            assertTrue(state.politeMessage.startsWith("Filter removed"))
            assertTrue(state.assertiveMessage.startsWith("Connection lost"))
        }

    @Test
    fun announceLogsPiiSafeDiagnosticWithoutMessageText() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), logger, backgroundScope)
            advanceUntilIdle()

            model.announce("Sensitive VIN 5YJ", AnnouncePriority.Polite)
            advanceUntilIdle()

            val record = logger.records.single { it.event == "visuallyHidden.announce" }
            assertEquals(mapOf("surface" to "VisuallyHidden", "priority" to "polite"), record.fields)
            // The announced message text never reaches a diagnostics field.
            assertTrue(record.fields.values.none { it.contains("VIN") })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = VisuallyHiddenViewModel(BroadcastAnnouncer(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VisuallyHidden", opened.first().fields["surface"])
        }
}
