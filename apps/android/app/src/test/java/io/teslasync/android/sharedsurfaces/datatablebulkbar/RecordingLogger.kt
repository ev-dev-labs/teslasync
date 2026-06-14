// A recording [Logger] fixture for the DataTableBulkBar surface's off-device tests (the
// :android:testReleaseUnitTest gate): it captures every emitted record so the model and view-model tests can
// assert the PII-safe `view.opened` diagnostics contract (P1/S11) without a UI. Shared by both
// DataTableBulkBarModelTest and DataTableBulkBarViewModelTest, and named after its single fixture per the ktlint
// `standard:filename` convention.

package io.teslasync.android.sharedsurfaces.datatablebulkbar

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

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
