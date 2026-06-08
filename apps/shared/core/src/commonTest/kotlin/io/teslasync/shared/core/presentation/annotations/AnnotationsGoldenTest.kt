package io.teslasync.shared.core.presentation.annotations

import io.teslasync.shared.core.data.repo.AnnotationRepository
import io.teslasync.shared.core.data.repo.annotationCacheKey
import io.teslasync.shared.core.data.repo.annotationQuery
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useAnnotations` domain (and its `web/src/types/annotations.ts` helpers):
 *
 *  1. [toDataAnnotation] — the `ChartAnnotationRow` → `DataAnnotation` projection (stringified
 *     id, first-scope-bucket `context`, null-preserving description/vehicle id).
 *  2. [annotationQuery] — the `/annotations` query builder (web `buildQuery`): `vehicle_id`
 *     sent whenever present, `scope`/`from`/`to` only when non-blank.
 *  3. [annotationCacheKey] — the web `annotationKeys.list` tuple (null-coalesced, so an empty
 *     scope stays `''` in the KEY even though it is dropped from the QUERY).
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C#
 * port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are
 * inlined to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class AnnotationsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- toDataAnnotation projection ----------------------------------------------

    @Serializable
    private data class ExpectedData(
        val id: String,
        val timestamp: String,
        val label: String,
        val description: String? = null,
        val category: String,
        val context: String,
        @SerialName("vehicle_id") val vehicleId: Long? = null,
        @SerialName("created_at") val createdAt: String,
    )

    @Serializable
    private data class ProjectionRow(
        val name: String,
        val input: ChartAnnotationRow,
        val expected: ExpectedData,
    )

    private fun projectionRows(): List<ProjectionRow> = json.decodeFromString(PROJECTION_GOLDEN)

    @Test
    fun projectionGoldenCoversEveryShape() {
        val names = projectionRows().map { it.name }.toSet()
        listOf(
            "full_row",
            "fleet_wide_null_vehicle",
            "scopeless_row",
            "multi_scope_takes_first",
            "null_description",
        ).forEach { assertTrue(it in names, "projection golden missing the '$it' case") }
    }

    @Test
    fun everyProjectionRowMatchesToDataAnnotation() {
        for (row in projectionRows()) {
            val actual = toDataAnnotation(row.input)
            val e = row.expected
            assertEquals(e.id, actual.id, "${row.name}: id")
            assertEquals(e.timestamp, actual.timestamp, "${row.name}: timestamp")
            assertEquals(e.label, actual.label, "${row.name}: label")
            assertEquals(e.description, actual.description, "${row.name}: description")
            assertEquals(e.category, actual.category, "${row.name}: category")
            assertEquals(e.context, actual.context, "${row.name}: context")
            assertEquals(e.vehicleId, actual.vehicleId, "${row.name}: vehicleId")
            assertEquals(e.createdAt, actual.createdAt, "${row.name}: createdAt")
        }
    }

    // ---- annotationQuery builder --------------------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: Long? = null,
        val scope: String? = null,
        val from: String? = null,
        val to: String? = null,
        val expected: Map<String, String>,
    )

    private fun queryRows(): List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)

    @Test
    fun queryGoldenCoversEveryGuardCase() {
        val names = queryRows().map { it.name }.toSet()
        listOf(
            "empty",
            "vehicle_only",
            "all_params",
            "blank_optionals_dropped",
            "scope_only",
        ).forEach { assertTrue(it in names, "query golden missing the '$it' case") }
    }

    @Test
    fun everyQueryRowMatchesAnnotationQuery() {
        for (row in queryRows()) {
            val actual = annotationQuery(AnnotationListParams(row.vehicleId, row.scope, row.from, row.to))
            assertEquals(row.expected, actual, "annotationQuery('${row.name}')")
        }
    }

    // ---- annotationCacheKey tuple -------------------------------------------------

    @Serializable
    private data class KeyRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: Long? = null,
        val scope: String? = null,
        val from: String? = null,
        val to: String? = null,
        val expected: String,
    )

    private fun keyRows(): List<KeyRow> = json.decodeFromString(KEY_GOLDEN)

    @Test
    fun keyGoldenCoversNullCoalescingEdges() {
        val names = keyRows().map { it.name }.toSet()
        listOf("empty", "vehicle_only", "full", "empty_scope_stays_empty")
            .forEach { assertTrue(it in names, "key golden missing the '$it' case") }
    }

    @Test
    fun everyKeyRowMatchesAnnotationCacheKey() {
        for (row in keyRows()) {
            val actual = annotationCacheKey(AnnotationListParams(row.vehicleId, row.scope, row.from, row.to))
            assertEquals(row.expected, actual, "annotationCacheKey('${row.name}')")
        }
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(AnnotationRepository::class.simpleName == "AnnotationRepository")
    }

    private companion object {
        val PROJECTION_GOLDEN =
            """
            [
              { "name": "full_row",
                "input": { "id": 1, "vehicle_id": 7, "occurred_at": "2026-06-15T00:00:00Z",
                           "category": "maintenance", "title": "Tire rotation",
                           "description": "Front to back", "scope": ["tire"], "color": "#ff8800",
                           "created_at": "2026-06-15T01:00:00Z", "updated_at": "2026-06-15T01:00:00Z" },
                "expected": { "id": "1", "timestamp": "2026-06-15T00:00:00Z", "label": "Tire rotation",
                              "description": "Front to back", "category": "maintenance", "context": "tire",
                              "vehicle_id": 7, "created_at": "2026-06-15T01:00:00Z" } },
              { "name": "fleet_wide_null_vehicle",
                "input": { "id": 2, "occurred_at": "2026-01-01T00:00:00Z", "category": "cost",
                           "title": "Rate change", "scope": ["cost"],
                           "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z" },
                "expected": { "id": "2", "timestamp": "2026-01-01T00:00:00Z", "label": "Rate change",
                              "category": "cost", "context": "cost", "created_at": "2026-01-01T00:00:00Z" } },
              { "name": "scopeless_row",
                "input": { "id": 3, "vehicle_id": 9, "occurred_at": "2026-02-02T00:00:00Z",
                           "category": "custom", "title": "Note", "scope": [],
                           "created_at": "2026-02-02T00:00:00Z", "updated_at": "2026-02-02T00:00:00Z" },
                "expected": { "id": "3", "timestamp": "2026-02-02T00:00:00Z", "label": "Note",
                              "category": "custom", "context": "", "vehicle_id": 9,
                              "created_at": "2026-02-02T00:00:00Z" } },
              { "name": "multi_scope_takes_first",
                "input": { "id": 4, "occurred_at": "2026-03-03T00:00:00Z", "category": "issue",
                           "title": "Multi", "scope": ["battery", "cost", "tire"],
                           "created_at": "2026-03-03T00:00:00Z", "updated_at": "2026-03-03T00:00:00Z" },
                "expected": { "id": "4", "timestamp": "2026-03-03T00:00:00Z", "label": "Multi",
                              "category": "issue", "context": "battery", "created_at": "2026-03-03T00:00:00Z" } },
              { "name": "null_description",
                "input": { "id": 5, "vehicle_id": 1, "occurred_at": "2026-04-04T00:00:00Z",
                           "category": "upgrade", "title": "FSD", "description": null, "scope": ["drivetrain"],
                           "created_at": "2026-04-04T00:00:00Z", "updated_at": "2026-04-04T00:00:00Z" },
                "expected": { "id": "5", "timestamp": "2026-04-04T00:00:00Z", "label": "FSD",
                              "category": "upgrade", "context": "drivetrain", "vehicle_id": 1,
                              "created_at": "2026-04-04T00:00:00Z" } }
            ]
            """.trimIndent()

        val QUERY_GOLDEN =
            """
            [
              { "name": "empty",                  "expected": {} },
              { "name": "vehicle_only",            "vehicle_id": 7, "expected": { "vehicle_id": "7" } },
              { "name": "all_params",              "vehicle_id": 7, "scope": "battery",
                "from": "2026-01-01", "to": "2026-02-01",
                "expected": { "vehicle_id": "7", "scope": "battery", "from": "2026-01-01", "to": "2026-02-01" } },
              { "name": "blank_optionals_dropped", "vehicle_id": 7, "scope": "", "from": "", "to": "",
                "expected": { "vehicle_id": "7" } },
              { "name": "scope_only",              "scope": "cost", "expected": { "scope": "cost" } }
            ]
            """.trimIndent()

        val KEY_GOLDEN =
            """
            [
              { "name": "empty",                   "expected": "all:all::" },
              { "name": "vehicle_only",            "vehicle_id": 7, "expected": "7:all::" },
              { "name": "full",                    "vehicle_id": 7, "scope": "battery",
                "from": "2026-01-01", "to": "2026-02-01", "expected": "7:battery:2026-01-01:2026-02-01" },
              { "name": "empty_scope_stays_empty", "scope": "", "expected": "all:::" }
            ]
            """.trimIndent()
    }
}
