// Verifies the PII-safe diagnostics (P1/S11): the one-shot `view.opened` emits the surface slug and nothing
// else — no `resourceKey`, peer id, or lease payload — so a diagnostics line can never leak which resource a
// user was editing. Runs in the :android:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.editconflictbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditConflictBannerDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("EditConflictBanner", EditConflictBannerRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordEditConflictBannerOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EditConflictBanner"), opened.single().second)
    }

    @Test
    fun diagnosticsCarryNoResourceOrPeerPayload() {
        val logger = RecordingLogger()

        recordEditConflictBannerOpened(logger)

        logger.events.forEach { (_, fields) ->
            assertEquals(setOf("surface"), fields.keys)
            // The slug is a constant identifier — no path separator from a resourceKey could have leaked in.
            assertTrue("the slug carries no path separator", fields.values.none { it.contains('/') })
        }
    }
}
