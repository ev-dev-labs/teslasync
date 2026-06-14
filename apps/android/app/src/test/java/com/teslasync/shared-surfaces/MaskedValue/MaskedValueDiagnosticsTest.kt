// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MaskedValue) cannot form a valid Kotlin package, so the test package mirrors
// the production package it exercises.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maskedvalue

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits ONLY the surface slug — never the value, the
 * variant, or any user data — so a diagnostics line can never leak what is being masked. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class MaskedValueDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += Triple(level, event, fields)
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("MaskedValue", MaskedValueDiagnostics.SLUG)
        assertEquals(MASKED_VALUE_SLUG, MaskedValueDiagnostics.SLUG)
        assertEquals("MaskedValue", MaskedValueRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        MaskedValueDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.second == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().first)
        assertEquals(mapOf("surface" to "MaskedValue"), opened.single().third)
    }

    @Test
    fun viewOpenedCarriesNoUserPayload() {
        val logger = RecordingLogger()

        MaskedValueDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().third
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("only the constant slug may be emitted", fields.values.all { it == "MaskedValue" })
    }
}
