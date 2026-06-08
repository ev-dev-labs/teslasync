package io.teslasync.shared.core.diagnostics

/** Severity of a structured log record, highest to lowest. */
public enum class LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

/**
 * One structured, already-redacted log record handed to a [DiagnosticsSink].
 *
 * [event] is a stable, dot-namespaced event name (e.g. `drive.sync`) — never a
 * free-form sentence — and [fields] are structured key/value pairs that have
 * already passed the [Redaction] scrubber.
 */
public data class LogRecord(
    public val level: LogLevel,
    public val event: String,
    public val fields: Map<String, String> = emptyMap(),
)

/**
 * The single structured logger every feature is allowed to call (ADR-016 §2,
 * "single-logger rule"). Direct platform logging (`println`, `os_log`,
 * `android.util.Log`) from feature code is prohibited — they must route here so
 * redaction and consent gating are unavoidable.
 *
 * Every field is scrubbed centrally by [Redaction]; the logger no-ops entirely
 * until diagnostics consent is granted.
 */
public interface Logger {
    /** Emits a record at [level] for [event] with structured [fields]. */
    public fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String> = emptyMap(),
    )

    /** Convenience for [LogLevel.Error]. */
    public fun error(
        event: String,
        fields: Map<String, String> = emptyMap(),
    ): Unit = log(LogLevel.Error, event, fields)

    /** Convenience for [LogLevel.Warn]. */
    public fun warn(
        event: String,
        fields: Map<String, String> = emptyMap(),
    ): Unit = log(LogLevel.Warn, event, fields)

    /** Convenience for [LogLevel.Info]. */
    public fun info(
        event: String,
        fields: Map<String, String> = emptyMap(),
    ): Unit = log(LogLevel.Info, event, fields)

    /** Convenience for [LogLevel.Debug]. */
    public fun debug(
        event: String,
        fields: Map<String, String> = emptyMap(),
    ): Unit = log(LogLevel.Debug, event, fields)
}

/**
 * Consent-gated, centrally-redacting [Logger]. Builds a [LogRecord] whose event
 * text and fields are scrubbed by [Redaction] before reaching [sink]; emits
 * nothing while [consentGranted] returns `false`.
 */
internal class RedactingLogger(
    private val consentGranted: () -> Boolean,
    private val sink: DiagnosticsSink,
) : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        if (!consentGranted()) return
        sink.log(
            LogRecord(
                level = level,
                event = Redaction.scrubText(event),
                fields = Redaction.redactFields(fields),
            ),
        )
    }
}
