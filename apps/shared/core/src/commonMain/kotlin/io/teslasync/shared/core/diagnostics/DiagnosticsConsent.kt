package io.teslasync.shared.core.diagnostics

import kotlinx.coroutines.flow.StateFlow

/**
 * Read-only view of the user's diagnostics-sharing consent (ADR-016 §3).
 *
 * Consent defaults **off**; the shared [Logger], [Telemetry], and [CrashReporter]
 * no-op until [granted] is `true`. [grantedFlow] lets a Settings → Privacy toggle
 * observe and reflect the live state. Mutation is owned by [Diagnostics] so that
 * revoking can also purge locally queued payloads.
 */
public class DiagnosticsConsent internal constructor(
    /** Hot, observable consent state for binding a privacy toggle. */
    public val grantedFlow: StateFlow<Boolean>,
) {
    /** Current consent value; `true` only after the user opts in. */
    public val granted: Boolean get() = grantedFlow.value
}
