package io.teslasync.shared.core.presentation.analytics

import io.teslasync.shared.core.data.repo.fleetQuery
import io.teslasync.shared.core.data.repo.unwrapArray
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the two non-trivial client-side derivations ported from the web
 * `useAnalytics` domain:
 *
 *  1. [fleetQuery] — the `/analytics/fleet` parameter precedence (`start`/`end` win over
 *     `days`), reproduced from web `useFleetAnalytics`.
 *  2. [unwrapArray] — the `select: (resp) => safeArray(resp?.field)` envelope-unwrap guard,
 *     reproduced from web `useMonthlyMileage`/`useDailyMileage`/`useTimeline`.
 *
 * The vectors are language-neutral (raw JSON in / raw JSON out, or a fixed param table) so the
 * C# Windows port and the KMP core load the identical set and cannot drift (ADR-004). The
 * fixtures are inlined here to stay within this slice's allowed file scope; the C# port mirrors
 * these exact rows. (Plain `safeArray` — used by `useStateSummary` — is already locked by
 * `AdminSafeArrayGoldenTest`; this file does not duplicate it.)
 */
class AnalyticsGoldenTest {
    // ---- fleetQuery precedence ----------------------------------------------------

    @Serializable
    private data class FleetRow(
        val name: String,
        val days: Int? = null,
        val start: String? = null,
        val end: String? = null,
        @SerialName("expected") val expected: Map<String, String>,
    )

    private val json = Json

    private fun fleetRows(): List<FleetRow> = json.decodeFromString(FLEET_GOLDEN)

    @Test
    fun fleetQueryGoldenCoversEveryPrecedenceCase() {
        val names = fleetRows().map { it.name }.toSet()
        listOf(
            "no_bounds",
            "days_only",
            "range_only",
            "range_wins_over_days",
            "start_only",
            "blank_start_falls_back_to_days",
        ).forEach { assertTrue(it in names, "fleet golden missing the '$it' case") }
    }

    @Test
    fun everyFleetRowMatchesFleetQuery() {
        for (row in fleetRows()) {
            val actual = fleetQuery(row.days, row.start, row.end)
            assertEquals(row.expected, actual, "fleetQuery('${row.name}') expected ${row.expected} but got $actual")
        }
    }

    // ---- unwrapArray envelope guard -----------------------------------------------

    @Serializable
    private data class UnwrapRow(
        val name: String,
        val field: String,
        @SerialName("input") val input: JsonElement,
        @SerialName("expected") val expected: JsonElement,
    )

    private fun unwrapRows(): List<UnwrapRow> = json.decodeFromString(UNWRAP_GOLDEN)

    @Test
    fun unwrapGoldenCoversEveryEnvelopeKind() {
        val names = unwrapRows().map { it.name }.toSet()
        listOf(
            "present_array",
            "present_empty_array",
            "missing_field",
            "json_null_field",
            "non_object_input",
            "scalar_field",
        ).forEach { assertTrue(it in names, "unwrap golden missing the '$it' case") }
    }

    @Test
    fun everyUnwrapRowMatchesUnwrapArray() {
        for (row in unwrapRows()) {
            val actual: JsonArray = unwrapArray(row.input, row.field)
            assertEquals(row.expected, actual, "unwrapArray('${row.name}') expected ${row.expected} but got $actual")
        }
    }

    @Test
    fun unwrapArrayHandlesRawJsonNullInput() {
        // A bare JSON-null input (not an object) collapses to [], matching `resp?.field` on null.
        assertEquals(JsonArray(emptyList()), unwrapArray(JsonNull, "months"))
        assertEquals(JsonArray(emptyList()), unwrapArray(JsonPrimitive(5), "days"))
    }

    private companion object {
        val FLEET_GOLDEN =
            """
            [
              { "name": "no_bounds",                    "expected": {} },
              { "name": "days_only",                    "days": 30, "expected": { "days": "30" } },
              { "name": "range_only",                   "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "start": "2026-01-01", "end": "2026-02-01" } },
              { "name": "range_wins_over_days",         "days": 30, "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "start": "2026-01-01", "end": "2026-02-01" } },
              { "name": "start_only",                   "start": "2026-01-01", "expected": { "start": "2026-01-01" } },
              { "name": "blank_start_falls_back_to_days","days": 7, "start": "", "expected": { "days": "7" } }
            ]
            """.trimIndent()

        val UNWRAP_GOLDEN =
            """
            [
              { "name": "present_array",       "field": "months", "input": {"months":[{"m":1}]}, "expected": [{"m":1}] },
              { "name": "present_empty_array", "field": "days",   "input": {"days":[]},          "expected": [] },
              { "name": "missing_field",       "field": "months", "input": {"vehicle_id":7},     "expected": [] },
              { "name": "json_null_field",     "field": "months", "input": {"months":null},      "expected": [] },
              { "name": "non_object_input",    "field": "months", "input": [1,2,3],              "expected": [] },
              { "name": "scalar_field",        "field": "months", "input": {"months":5},         "expected": [] }
            ]
            """.trimIndent()
    }
}
