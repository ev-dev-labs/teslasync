package io.teslasync.shared.core.diagnostics

import android.util.Log

private const val LOG_TAG = "TeslaSyncDiag"

/**
 * Android diagnostics sink. Emits already-redacted, consent-gated payloads to
 * `android.util.Log`; P5/H7 binds the same `emit` boundary to the self-hosted
 * Sentry SDK (`sentry-android`) without touching the shared queue/format logic.
 */
internal class AndroidDiagnosticsSink : BufferedDiagnosticsSink() {
    override fun emit(line: String) {
        Log.d(LOG_TAG, line)
    }
}

public actual fun platformDiagnosticsSink(): DiagnosticsSink = AndroidDiagnosticsSink()
