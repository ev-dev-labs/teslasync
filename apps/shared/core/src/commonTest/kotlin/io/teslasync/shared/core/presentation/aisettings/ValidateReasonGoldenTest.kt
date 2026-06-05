package io.teslasync.shared.core.presentation.aisettings

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the one client-side derivation ported from the web `useAiSettings`
 * domain — the `reasonFromCode` mapping (web/src/api/hooks/useAiSettings.ts). The vectors are
 * language-neutral (raw `code` string in / canonical reason `code` out) so the C# Windows port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixture is inlined
 * here (rather than a separate `apps/shared/spec` file) to stay within this slice's allowed file
 * scope; the C# port mirrors these exact rows.
 *
 * Web contract reproduced row-for-row:
 *  - each of the 12 known codes maps to itself;
 *  - the literal `"unknown"`, an unrecognised code, a blank string, and a missing code all
 *    collapse to `unknown`.
 */
class ValidateReasonGoldenTest {
    @Serializable
    private data class GoldenRow(
        val name: String,
        @SerialName("code") val code: String? = null,
        @SerialName("expected") val expected: String,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun rows(): List<GoldenRow> = json.decodeFromString(GOLDEN)

    @Test
    fun goldenCoversEveryKnownReasonPlusFallbacks() {
        val names = rows().map { it.name }.toSet()
        // All 12 backend codes + the 4 fallback shapes (literal-unknown, garbage, blank, null).
        assertEquals(16, rows().size, "expected 12 known codes + 4 fallback rows")
        listOf(
            "not_local",
            "invalid",
            "bad_mode",
            "bad_request",
            "unknown_provider",
            "missing_api_key",
            "missing_base_url",
            "missing_deployment",
            "unauthorized",
            "not_found",
            "upstream_error",
            "timeout",
            "literal_unknown",
            "garbage_code",
            "blank_code",
            "null_code",
        ).forEach { assertTrue(it in names, "golden missing the '$it' case") }
    }

    @Test
    fun everyGoldenRowMatchesReasonFromCode() {
        for (row in rows()) {
            val actual = reasonFromCode(row.code).code
            assertEquals(
                row.expected,
                actual,
                "reasonFromCode('${row.name}') expected ${row.expected} but got $actual",
            )
        }
    }

    @Test
    fun everyKnownReasonRoundTripsThroughItsCode() {
        // Defensive: the enum's own `code` must feed back into the same reason, so the typed
        // reason and its wire string can never silently diverge.
        for (reason in ValidateAiProviderReason.entries) {
            assertEquals(reason, reasonFromCode(reason.code), "round-trip failed for ${reason.code}")
        }
    }

    private companion object {
        val GOLDEN =
            """
            [
              { "name": "not_local",          "code": "not_local",          "expected": "not_local" },
              { "name": "invalid",            "code": "invalid",            "expected": "invalid" },
              { "name": "bad_mode",           "code": "bad_mode",           "expected": "bad_mode" },
              { "name": "bad_request",        "code": "bad_request",        "expected": "bad_request" },
              { "name": "unknown_provider",   "code": "unknown_provider",   "expected": "unknown_provider" },
              { "name": "missing_api_key",    "code": "missing_api_key",    "expected": "missing_api_key" },
              { "name": "missing_base_url",   "code": "missing_base_url",   "expected": "missing_base_url" },
              { "name": "missing_deployment", "code": "missing_deployment", "expected": "missing_deployment" },
              { "name": "unauthorized",       "code": "unauthorized",       "expected": "unauthorized" },
              { "name": "not_found",          "code": "not_found",          "expected": "not_found" },
              { "name": "upstream_error",     "code": "upstream_error",     "expected": "upstream_error" },
              { "name": "timeout",            "code": "timeout",            "expected": "timeout" },
              { "name": "literal_unknown",    "code": "unknown",            "expected": "unknown" },
              { "name": "garbage_code",       "code": "sudo_required",      "expected": "unknown" },
              { "name": "blank_code",         "code": "",                   "expected": "unknown" },
              { "name": "null_code",                                        "expected": "unknown" }
            ]
            """.trimIndent()
    }
}
