package io.teslasync.shared.core.diagnostics

/**
 * The platform emission boundary for diagnostics (ADR-016 §1). Exactly one
 * self-hosted Sentry deployment serves crash reporting **and** product analytics
 * across all platforms; each platform binds its `actual` sink (sentry-android /
 * sentry-cocoa, wired in P5/H7) behind this single interface.
 *
 * Implementations receive **already-redacted** payloads — the common
 * [Logger]/[Telemetry]/[CrashReporter] run [Redaction] first — and are reached
 * only after consent is granted. A sink may locally buffer payloads pending
 * upload; [purge] discards that buffer when consent is revoked.
 */
public interface DiagnosticsSink {
    /** Emits a redacted structured log [record]. */
    public fun log(record: LogRecord)

    /** Emits a typed analytics event [name] with redacted [properties]. */
    public fun event(
        name: String,
        properties: Map<String, String>,
    )

    /** Emits a redacted crash/diagnostic breadcrumb. */
    public fun breadcrumb(message: String)

    /** Emits a redacted crash [report]. */
    public fun crash(report: CrashReport)

    /** Discards any locally queued payloads (consent revoke / purge-on-off). */
    public fun purge()
}

/**
 * Base [DiagnosticsSink] that formats each redacted payload into a single line,
 * appends it to an in-memory queue (the "locally queued data" purged on consent
 * revoke), and forwards it to the platform log via [emit].
 *
 * Platform `actual` sinks extend this to route [emit] to their native logging
 * facility today and to the self-hosted Sentry SDK once P5/H7 wires the DSN —
 * keeping the queue + formatting logic shared rather than duplicated per platform.
 */
public abstract class BufferedDiagnosticsSink : DiagnosticsSink {
    private val queued: MutableList<String> = mutableListOf()

    /** Snapshot of the currently queued, not-yet-purged lines (for diagnostics/tests). */
    public val queuedLines: List<String> get() = queued.toList()

    /** Routes a formatted, redacted [line] to the platform's logging facility. */
    protected abstract fun emit(line: String)

    final override fun log(record: LogRecord) {
        enqueue("[${record.level}] ${record.event}${formatFields(record.fields)}")
    }

    final override fun event(
        name: String,
        properties: Map<String, String>,
    ) {
        enqueue("EVENT $name${formatFields(properties)}")
    }

    final override fun breadcrumb(message: String) {
        enqueue("BREADCRUMB $message")
    }

    final override fun crash(report: CrashReport) {
        enqueue("CRASH ${report.type}: ${report.message}${formatFields(report.fields)}")
    }

    final override fun purge() {
        queued.clear()
    }

    private fun enqueue(line: String) {
        queued.add(line)
        emit(line)
    }

    private fun formatFields(fields: Map<String, String>): String =
        if (fields.isEmpty()) {
            ""
        } else {
            fields.entries.joinToString(prefix = " ", separator = " ") { (k, v) -> "$k=$v" }
        }
}

/**
 * Returns the platform's diagnostics sink. Android wraps `android.util.Log` (and,
 * in P5/H7, sentry-android); Apple wraps the unified logging system (and
 * sentry-cocoa). Tests substitute a fake sink so no payload leaves the process.
 */
public expect fun platformDiagnosticsSink(): DiagnosticsSink
