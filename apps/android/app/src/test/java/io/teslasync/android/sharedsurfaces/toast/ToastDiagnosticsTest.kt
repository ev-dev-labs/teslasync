// Focused diagnostics test for the Toast surface — verifies the one-shot `view.opened` emission
// (P1/S11) carries only the surface slug and never any toast content (title / message / action target),
// so a diagnostics line can never leak a user's confirmation. Framework-free; runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ToastDiagnosticsTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    @Test
    fun recordsViewOpenedWithOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()

        recordToastHostOpened(logger)

        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to ToastRegistration.SLUG), record.fields)
        assertEquals("Toast", record.fields[FIELD_SURFACE])
    }

    @Test
    fun theSlugIsTheStablePromptSurfaceSlug() {
        assertEquals("Toast", ToastRegistration.SLUG)
        assertTrue(ToastRegistration.ID.isNotBlank())
    }
}
