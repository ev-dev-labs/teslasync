package io.teslasync.android.data

import io.teslasync.shared.core.diagnostics.Diagnostics
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Proves the data layer logs through the shared consent-gated, PII-redacting logger (ADR-016): nothing
 * is emitted before consent, PII field keys are redacted, and the command lifecycle is logged.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RedactedLoggingTest {
    @Test
    fun loggerEmitsNothingUntilConsentGranted() {
        val sink = RecordingSink()
        val diagnostics = Diagnostics.create(sink)

        diagnostics.logger.info("vehicles.refresh", mapOf("count" to "3"))

        assertTrue(sink.records.isEmpty())
    }

    @Test
    fun loggerRedactsPiiFieldsOnceConsentGranted() {
        val sink = RecordingSink()
        val diagnostics = Diagnostics.create(sink)
        diagnostics.grantConsent()

        diagnostics.logger.info("vehicles.refresh", mapOf("vehicle_id" to "5", "count" to "3"))

        assertEquals(1, sink.records.size)
        val record = sink.records.single()
        assertEquals("vehicles.refresh", record.event)
        assertEquals("[REDACTED]", record.fields["vehicle_id"])
        assertEquals("3", record.fields["count"])
    }

    @Test
    fun commandRunnerLogsLifecycleThroughTheRedactingLogger() =
        runTest {
            val sink = RecordingSink()
            val diagnostics = Diagnostics.create(sink)
            diagnostics.grantConsent()
            val runner = CommandRunner("wake", backgroundScope, diagnostics.logger)

            runner.request()
            runner.confirm { Result.success(Unit) }
            runCurrent()

            val events = sink.records.map { it.event }
            assertTrue(events.contains("command.wake.start"))
            assertTrue(events.contains("command.wake.ok"))
        }
}
