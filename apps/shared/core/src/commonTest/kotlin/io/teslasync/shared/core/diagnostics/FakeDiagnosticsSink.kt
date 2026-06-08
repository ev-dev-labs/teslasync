package io.teslasync.shared.core.diagnostics

/**
 * In-memory [DiagnosticsSink] for tests — records every payload it receives so
 * assertions can prove redaction, consent gating, event schema, and purge
 * behaviour without any real network or platform sink.
 */
class FakeDiagnosticsSink : DiagnosticsSink {
    val records: MutableList<LogRecord> = mutableListOf()
    val events: MutableList<Pair<String, Map<String, String>>> = mutableListOf()
    val breadcrumbs: MutableList<String> = mutableListOf()
    val crashes: MutableList<CrashReport> = mutableListOf()
    var purgeCount: Int = 0
        private set

    /** Total payloads received across all kinds (the "queued" data a purge clears). */
    val totalEmitted: Int
        get() = records.size + events.size + breadcrumbs.size + crashes.size

    override fun log(record: LogRecord) {
        records.add(record)
    }

    override fun event(
        name: String,
        properties: Map<String, String>,
    ) {
        events.add(name to properties)
    }

    override fun breadcrumb(message: String) {
        breadcrumbs.add(message)
    }

    override fun crash(report: CrashReport) {
        crashes.add(report)
    }

    override fun purge() {
        purgeCount++
        records.clear()
        events.clear()
        breadcrumbs.clear()
        crashes.clear()
    }
}
