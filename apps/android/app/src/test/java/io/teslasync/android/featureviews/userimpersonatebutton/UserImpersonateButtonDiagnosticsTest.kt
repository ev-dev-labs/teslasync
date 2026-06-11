package io.teslasync.android.featureviews.userimpersonatebutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe `view.opened` diagnostic (P1/S11): it emits the surface slug and nothing else — never
 * the impersonation subject (an opaque-but-sensitive identifier) — so a diagnostics line can never leak who an
 * admin was about to impersonate. Runs in the :android:testReleaseUnitTest gate.
 */
class UserImpersonateButtonDiagnosticsTest {
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
    fun registrationExposesStableIdAndSlug() {
        assertEquals("user-impersonate-button", UserImpersonateButtonRegistration.ID)
        assertEquals("UserImpersonateButton", UserImpersonateButtonRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        UserImpersonateButtonDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "UserImpersonateButton"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSubjectOrPayloadFields() {
        val logger = RecordingLogger()

        UserImpersonateButtonDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.contains("@") || it.contains(":") })
    }
}
