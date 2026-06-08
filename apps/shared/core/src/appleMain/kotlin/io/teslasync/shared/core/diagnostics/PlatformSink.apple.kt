package io.teslasync.shared.core.diagnostics

import platform.Foundation.NSLog

/**
 * Apple diagnostics sink. Emits already-redacted, consent-gated payloads through
 * the unified logging system; P5/H7 binds the same `emit` boundary to the
 * self-hosted Sentry SDK (`sentry-cocoa`) without touching the shared
 * queue/format logic.
 */
internal class AppleDiagnosticsSink : BufferedDiagnosticsSink() {
    override fun emit(line: String) {
        NSLog("[TeslaSyncDiag] %@", line)
    }
}

public actual fun platformDiagnosticsSink(): DiagnosticsSink = AppleDiagnosticsSink()
