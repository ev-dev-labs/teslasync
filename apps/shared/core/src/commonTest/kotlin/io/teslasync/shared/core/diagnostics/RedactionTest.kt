package io.teslasync.shared.core.diagnostics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Proves the central [Redaction] scrubber removes every ADR-016 §2 PII class —
 * by forbidden key and by value pattern — while retaining non-PII operational
 * fields. This is the unit-level backstop behind the end-to-end gating tests.
 */
class RedactionTest {
    private val r = Redaction.REDACTED

    @Test
    fun forbiddenKeysAreRedactedRegardlessOfValue() {
        val planted =
            linkedMapOf(
                "vin" to "5YJ3E1EA7KF000001",
                "vehicle_id" to "12345",
                "access_token" to "abc",
                "refreshToken" to "def",
                "authorization" to "Basic xyz",
                "password" to "hunter2",
                "lat" to "37.4220",
                "lon" to "-122.0841",
                "latitude" to "37.42",
                "email" to "owner@example.com",
                "phone" to "+14155550123",
                "name" to "Ada Lovelace",
                "user_id" to "99",
                "address" to "1 Infinite Loop",
            )

        val out = Redaction.redactFields(planted)

        for ((k, v) in out) {
            assertEquals(r, v, "key '$k' must be fully redacted")
        }
    }

    @Test
    fun camelCaseAndSnakeCaseKeysBothMatch() {
        assertEquals(r, Redaction.redactField("accessToken", "secret"))
        assertEquals(r, Redaction.redactField("access_token", "secret"))
        assertEquals(r, Redaction.redactField("idToken", "secret"))
        assertEquals(r, Redaction.redactField("clientSecret", "secret"))
    }

    @Test
    fun nonPiiOperationalFieldsAreRetained() {
        val fields =
            linkedMapOf(
                "drive_id" to "4412",
                "distance_m" to "18230",
                "status" to "200",
                "screen" to "vehicle_detail",
                "duration_ms" to "1200",
            )

        val out = Redaction.redactFields(fields)

        assertEquals(fields, out, "non-PII fields must pass through unchanged")
    }

    @Test
    fun valuePatternsScrubEmbeddedPiiUnderSafeKeys() {
        // A non-forbidden key whose VALUE nonetheless carries PII must still scrub.
        assertEquals(r, Redaction.redactField("note", "owner@example.com"))
        assertEquals(r, Redaction.redactField("detail", "5YJ3E1EA7KF000001"))
        assertEquals(r, Redaction.redactField("contact", "+14155550123"))
    }

    @Test
    fun scrubTextRedactsTokenAndCoordinatesInBreadcrumb() {
        val input =
            "GET /api/v1/vehicles?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig " +
                "near 37.4220,-122.0841"

        val scrubbed = Redaction.scrubText(input)

        assertFalse(scrubbed.contains("eyJ"), "JWT must be scrubbed: $scrubbed")
        assertFalse(scrubbed.contains("37.4220"), "coordinates must be scrubbed: $scrubbed")
        assertTrue(scrubbed.contains("token=$r"), "token value replaced in place: $scrubbed")
        assertTrue(scrubbed.contains("/api/v1/vehicles"), "non-PII path retained: $scrubbed")
    }

    @Test
    fun scrubTextRedactsBearerAuthorization() {
        val scrubbed = Redaction.scrubText("Authorization: Bearer abc123.def-456_GHI")
        assertEquals("Authorization: $r", scrubbed)
    }

    @Test
    fun emptyInputsAreStable() {
        assertEquals("", Redaction.scrubText(""))
        assertEquals(emptyMap(), Redaction.redactFields(emptyMap()))
    }
}
