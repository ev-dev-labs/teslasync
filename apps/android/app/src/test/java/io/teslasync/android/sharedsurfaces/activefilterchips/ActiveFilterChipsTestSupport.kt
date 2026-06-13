// Shared off-device test fixtures for the ActiveFilterChips surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures the PII-safe `view.opened` diagnostic, and a fake [FilterAnnouncer] that
// records every announced message and exposes its current value, so the view-model's overflow + announcer wiring
// runs without a UI. Co-located with the surface's tests so the model and view-model tests reuse one set of
// fixtures.

package io.teslasync.android.sharedsurfaces.activefilterchips

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
 * A [FilterAnnouncer] that records every announced message verbatim and republishes it as the current value — the
 * terminal-state fake for the view-model's announcer-delegation tests (no re-announce padding, no UI). The
 * production [LiveFilterAnnouncer]'s padding mechanic is covered separately by the model test.
 */
internal class FakeFilterAnnouncer : FilterAnnouncer {
    val messages = mutableListOf<String>()
    private val announcementState = MutableStateFlow("")

    override val announcement: StateFlow<String> = announcementState.asStateFlow()

    override fun announce(message: String) {
        messages += message
        announcementState.value = message
    }
}
