package io.teslasync.shared.core.diagnostics

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Shared diagnostics facade (ADR-016) wiring the consent gate to the redacting
 * [logger], [telemetry], and [crashReporter] over a single platform
 * [DiagnosticsSink].
 *
 * Every component is consent-gated and centrally PII-scrubbed: nothing is emitted
 * to the sink until [grantConsent] is called, and [revokeConsent] both stops
 * further emission and purges any locally queued payloads (ADR-016 §3,
 * purge-on-off).
 *
 * Construct once per app (via [create]) and inject the components where features
 * need them — feature code never touches the sink or [Redaction] directly.
 */
public class Diagnostics private constructor(
    private val sink: DiagnosticsSink,
) {
    private val consentState = MutableStateFlow(false)

    /** Observable, read-only consent state (default off). */
    public val consent: DiagnosticsConsent = DiagnosticsConsent(consentState.asStateFlow())

    /** Structured, redacting, consent-gated logger. */
    public val logger: Logger = RedactingLogger({ consentState.value }, sink)

    /** Typed, redacting, consent-gated product-analytics emitter. */
    public val telemetry: Telemetry = RedactingTelemetry({ consentState.value }, sink)

    /** Redacting, consent-gated crash/exception reporter. */
    public val crashReporter: CrashReporter = RedactingCrashReporter({ consentState.value }, sink)

    /** Grants diagnostics consent; sinks begin emitting redacted payloads. */
    public fun grantConsent() {
        consentState.value = true
    }

    /**
     * Revokes consent: stops further emission and purges any locally queued
     * payloads from the sink (ADR-016 §3).
     */
    public fun revokeConsent() {
        consentState.value = false
        sink.purge()
    }

    public companion object {
        /**
         * Builds a [Diagnostics] over [sink] (the platform sink by default). Tests
         * pass a fake sink so no payload leaves the process.
         */
        public fun create(sink: DiagnosticsSink = platformDiagnosticsSink()): Diagnostics = Diagnostics(sink)
    }
}
