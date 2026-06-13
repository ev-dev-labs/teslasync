// Shared off-device test fixtures for the BulkActionsToolbar surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures the PII-safe `view.opened` + redacted failure diagnostics, and a fake
// [BulkConfirmer] that records every confirmation request and answers with a fixed verdict, so the view-model's
// confirm-gating runs without a UI. Co-located with the surface's tests so both the model and view-model tests
// reuse one set of fixtures.

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
internal class RecordingLogger : Logger {
    val events = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        events += event to fields
    }
}

/**
 * A [BulkConfirmer] that records every [BulkConfirmRequest] and resolves immediately with a fixed [approve]
 * verdict — the terminal-state fake for the view-model's confirm-gating tests (no suspension, no UI).
 */
internal class FakeBulkConfirmer(
    private val approve: Boolean = true,
) : BulkConfirmer {
    val requests = mutableListOf<BulkConfirmRequest>()
    private val dialogState = MutableStateFlow<BulkConfirmRequest?>(null)

    override val dialog: StateFlow<BulkConfirmRequest?> = dialogState.asStateFlow()

    override suspend fun confirm(request: BulkConfirmRequest): Boolean {
        requests += request
        return approve
    }

    override fun respond(confirmed: Boolean) {
        dialogState.value = null
    }
}
