package io.teslasync.shared.core.diagnostics

/**
 * One captured crash / handled exception, already redacted, handed to a
 * [DiagnosticsSink]. [type] is the exception class/identifier, [message] the
 * scrubbed description, and [fields] structured context that has passed
 * [Redaction].
 */
public data class CrashReport(
    public val type: String,
    public val message: String,
    public val fields: Map<String, String> = emptyMap(),
)

/**
 * Crash / exception reporter (ADR-016 §1). Backed per platform by the self-hosted
 * Sentry SDK through the [DiagnosticsSink] `expect/actual` seam; the common layer
 * here owns consent gating and breadcrumb/exception scrubbing so no PII reaches
 * any crash backend.
 *
 * Breadcrumbs and exception messages pass through [Redaction] before the sink;
 * everything no-ops until diagnostics consent is granted.
 */
public interface CrashReporter {
    /** Records a navigational/diagnostic breadcrumb (scrubbed of PII). */
    public fun leaveBreadcrumb(message: String)

    /** Records a handled exception with optional structured [fields] (all scrubbed). */
    public fun recordException(
        type: String,
        message: String,
        fields: Map<String, String> = emptyMap(),
    )
}

/**
 * Consent-gated, redacting [CrashReporter]. Scrubs breadcrumb text and exception
 * messages via [Redaction] (free-text value-pattern pass) and redacts structured
 * fields before forwarding to [sink]; no-ops while [consentGranted] is `false`.
 */
internal class RedactingCrashReporter(
    private val consentGranted: () -> Boolean,
    private val sink: DiagnosticsSink,
) : CrashReporter {
    override fun leaveBreadcrumb(message: String) {
        if (!consentGranted()) return
        sink.breadcrumb(Redaction.scrubText(message))
    }

    override fun recordException(
        type: String,
        message: String,
        fields: Map<String, String>,
    ) {
        if (!consentGranted()) return
        sink.crash(
            CrashReport(
                type = type,
                message = Redaction.scrubText(message),
                fields = Redaction.redactFields(fields),
            ),
        )
    }
}
