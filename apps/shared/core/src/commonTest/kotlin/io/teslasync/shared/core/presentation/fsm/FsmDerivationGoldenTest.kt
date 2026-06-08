package io.teslasync.shared.core.presentation.fsm

import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.buildFsmTransitionsQuery
import io.teslasync.shared.core.data.repo.fsmNameParam
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the two client-side derivations ported from the web `useFSMTransitions`
 * hook — the `fsm_name` param decision (`fsmType === 'all' ? '' : '&fsm_name=' + fsmType`) and the
 * full transitions query map (the snake_case core params plus the conditional `fsm_name` and the
 * half-open `start`/`end` instant window that is only sent when BOTH ends are supplied). The vectors
 * are language-neutral (plain JSON in / JSON out) so the C# Windows port and the KMP core can load
 * the identical set and cannot drift (ADR-004). The fixture is inlined here (rather than a separate
 * `apps/shared/spec` file) to stay within this slice's allowed file scope; the C# port mirrors these
 * exact rows.
 */
class FsmDerivationGoldenTest {
    @Serializable
    private data class NameRow(
        val name: String,
        val fsmType: String,
        val expected: String?,
    )

    @Serializable
    private data class QueryRow(
        val name: String,
        val entityId: String,
        val fsmType: String,
        val hours: Int,
        val page: Int,
        val perPage: Int,
        val start: String? = null,
        val end: String? = null,
        val expected: Map<String, String>,
    )

    private val json = Json

    @Test
    fun fsmNameParamMatchesEveryGoldenRow() {
        val rows: List<NameRow> = json.decodeFromString(NAME_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("all", "vehicle", "telemetry_connection").forEach { assertTrue(it in names, "name golden missing '$it'") }
        for (row in rows) {
            val actual = fsmNameParam(FsmType.valueOf(row.fsmType))
            assertEquals(row.expected, actual, "fsmNameParam('${row.name}') expected ${row.expected} but got $actual")
        }
    }

    @Test
    fun buildFsmTransitionsQueryMatchesEveryGoldenRow() {
        val rows: List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("all_no_window", "non_all_filter", "window_both_ends", "window_start_only", "window_end_only")
            .forEach { assertTrue(it in names, "query golden missing '$it'") }
        for (row in rows) {
            val actual =
                buildFsmTransitionsQuery(
                    entityId = row.entityId,
                    fsmType = FsmType.valueOf(row.fsmType),
                    hours = row.hours,
                    page = row.page,
                    perPage = row.perPage,
                    startInstant = row.start,
                    endInstantExclusive = row.end,
                )
            assertEquals(row.expected, actual, "buildFsmTransitionsQuery('${row.name}')")
            // Parameter order is part of the contract (web template-literal order).
            assertEquals(
                row.expected.keys.toList(),
                actual.keys.toList(),
                "buildFsmTransitionsQuery('${row.name}') param order",
            )
        }
    }

    private companion object {
        val NAME_GOLDEN =
            """
            [
              { "name": "all",                  "fsmType": "ALL",                  "expected": null },
              { "name": "vehicle",              "fsmType": "VEHICLE",              "expected": "vehicle" },
              { "name": "telemetry_connection", "fsmType": "TELEMETRY_CONNECTION", "expected": "telemetry_connection" }
            ]
            """.trimIndent()

        val QUERY_GOLDEN =
            """
            [
              {
                "name": "all_no_window", "entityId": "7", "fsmType": "ALL",
                "hours": 24, "page": 1, "perPage": 50,
                "expected": { "vehicle_id": "7", "hours": "24", "page": "1", "per_page": "50" }
              },
              {
                "name": "non_all_filter", "entityId": "7", "fsmType": "TELEMETRY_CONNECTION",
                "hours": 1, "page": 2, "perPage": 25,
                "expected": {
                  "vehicle_id": "7", "hours": "1", "page": "2", "per_page": "25",
                  "fsm_name": "telemetry_connection"
                }
              },
              {
                "name": "window_both_ends", "entityId": "9", "fsmType": "VEHICLE",
                "hours": 1, "page": 1, "perPage": 50,
                "start": "2026-05-12T07:00:00.000Z", "end": "2026-05-13T07:00:00.000Z",
                "expected": {
                  "vehicle_id": "9", "hours": "1", "page": "1", "per_page": "50",
                  "fsm_name": "vehicle",
                  "start": "2026-05-12T07:00:00.000Z", "end": "2026-05-13T07:00:00.000Z"
                }
              },
              {
                "name": "window_start_only", "entityId": "9", "fsmType": "ALL",
                "hours": 6, "page": 1, "perPage": 50,
                "start": "2026-05-12T07:00:00.000Z",
                "expected": { "vehicle_id": "9", "hours": "6", "page": "1", "per_page": "50" }
              },
              {
                "name": "window_end_only", "entityId": "9", "fsmType": "ALL",
                "hours": 6, "page": 1, "perPage": 50,
                "end": "2026-05-13T07:00:00.000Z",
                "expected": { "vehicle_id": "9", "hours": "6", "page": "1", "per_page": "50" }
              }
            ]
            """.trimIndent()
    }
}
