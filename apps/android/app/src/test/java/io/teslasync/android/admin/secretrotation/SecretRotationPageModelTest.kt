package io.teslasync.android.admin.secretrotation

import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the framework-free SecretRotationPage model (the pure derivations the composable
 * renders): the severity-tier classification (web `SEVERITY_VARIANT` union), the ok/warn/critical/total
 * roll-up (web `counts` reducer), the typed-response projection (web `items` read), and the HTTP-503
 * "subsystem not configured" predicate (web `error.status === 503`). No Android/Compose types are touched.
 */
class SecretRotationPageModelTest {
    // ── SecretSeverityTone.from ───────────────────────────────────────────────────

    @Test
    fun severityFoldsKnownTiers() {
        assertEquals(SecretSeverityTone.Ok, SecretSeverityTone.from("ok"))
        assertEquals(SecretSeverityTone.Warn, SecretSeverityTone.from("warn"))
        assertEquals(SecretSeverityTone.Critical, SecretSeverityTone.from("critical"))
    }

    @Test
    fun severityIsCaseInsensitive() {
        assertEquals(SecretSeverityTone.Critical, SecretSeverityTone.from("CRITICAL"))
    }

    @Test
    fun severityUnknownForUnrecognisedOrBlank() {
        assertEquals(SecretSeverityTone.Unknown, SecretSeverityTone.from("unknown"))
        assertEquals(SecretSeverityTone.Unknown, SecretSeverityTone.from(""))
        assertEquals(SecretSeverityTone.Unknown, SecretSeverityTone.from("expired"))
    }

    // ── RotationCounts.from ───────────────────────────────────────────────────────

    @Test
    fun countsTallyEachTierAndTotalIncludesUnknown() {
        val items =
            listOf(
                status(severity = "ok"),
                status(severity = "ok"),
                status(severity = "warn"),
                status(severity = "critical"),
                status(severity = "mystery"),
            )
        val counts = RotationCounts.from(items)
        assertEquals(2, counts.ok)
        assertEquals(1, counts.warn)
        assertEquals(1, counts.critical)
        assertEquals(5, counts.total)
    }

    @Test
    fun countsEmptyForEmptyList() {
        assertEquals(RotationCounts.EMPTY, RotationCounts.from(emptyList()))
    }

    // ── SecretRotationView.from ───────────────────────────────────────────────────

    @Test
    fun viewEmptyWhenResponseNull() {
        val view = SecretRotationView.from(null)
        assertTrue(view.isEmpty)
        assertEquals(RotationCounts.EMPTY, view.counts)
    }

    @Test
    fun viewProjectsItemsAndFoldsCounts() {
        val response =
            SecretRotationResponse(
                items =
                    listOf(
                        status(kind = "tesla_refresh_token", severity = "ok"),
                        status(kind = "database_password", severity = "critical"),
                    ),
            )
        val view = SecretRotationView.from(response)
        assertFalse(view.isEmpty)
        assertEquals(2, view.items.size)
        assertEquals(1, view.counts.ok)
        assertEquals(1, view.counts.critical)
        assertEquals(2, view.counts.total)
    }

    // ── isSubsystemMissing ────────────────────────────────────────────────────────

    @Test
    fun subsystemMissingOnlyFor503() {
        assertTrue(isSubsystemMissing(503))
        assertFalse(isSubsystemMissing(null))
        assertFalse(isSubsystemMissing(200))
        assertFalse(isSubsystemMissing(500))
    }

    private fun status(
        kind: String = "tesla_refresh_token",
        severity: String = "ok",
    ): SecretRotationStatus = SecretRotationStatus(kind = kind, severity = severity)
}
