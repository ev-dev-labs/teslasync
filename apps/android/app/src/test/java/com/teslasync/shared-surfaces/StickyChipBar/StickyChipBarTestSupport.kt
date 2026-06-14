// Shared off-device test fixture for the StickyChipBar surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures every emitted record so the model + view-model tests can assert the
// PII-safe `view.opened` diagnostics contract (P1/S11) without a UI. Co-located with the surface's tests so
// both reuse one fixture.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed because the file is named after the
// surface (StickyChipBar*) rather than its single top-level type; `InvalidPackageDeclaration` because the
// mandated surface directory (com/teslasync/shared-surfaces/StickyChipBar) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger

/** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
internal class RecordingLogger : Logger {
    val records = mutableListOf<LogRecord>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        records += LogRecord(level, event, fields)
    }
}
