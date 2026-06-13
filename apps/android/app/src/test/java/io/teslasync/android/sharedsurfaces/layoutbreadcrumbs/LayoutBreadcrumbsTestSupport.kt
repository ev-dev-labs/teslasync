// Shared off-device test fixtures for the LayoutBreadcrumbs surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures the PII-safe `view.opened` diagnostic so the model, view-model, and diagnostics
// tests can assert the P1/S11 contract without a UI. Co-located with the surface's tests.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed: this file co-locates the surface's test
// fixtures and is named after the surface, not after its single current fixture class.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

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
