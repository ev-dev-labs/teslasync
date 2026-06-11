package io.teslasync.android.data

import io.teslasync.shared.core.diagnostics.CrashReport
import io.teslasync.shared.core.diagnostics.DiagnosticsSink
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger

/** A [Logger] that drops everything — used where a test does not assert on logging. */
object NoopLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

/** A [DiagnosticsSink] that records every redacted [LogRecord] it receives, for logging assertions. */
class RecordingSink : DiagnosticsSink {
    val records = mutableListOf<LogRecord>()

    override fun log(record: LogRecord) {
        records.add(record)
    }

    override fun event(
        name: String,
        properties: Map<String, String>,
    ) = Unit

    override fun breadcrumb(message: String) = Unit

    override fun crash(report: CrashReport) = Unit

    override fun purge() {
        records.clear()
    }
}
