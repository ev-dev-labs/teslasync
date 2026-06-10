package io.teslasync.shared.core.presentation.admin

import io.teslasync.shared.core.data.repo.safeArray
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the one client-side derivation ported from the web `useAdmin`
 * domain — the `select: safeArray` array guard (web/src/lib/safeArray.ts). The vectors are
 * language-neutral (raw JSON in / raw JSON out) so the C# Windows port and the KMP core can
 * load the identical set and cannot drift (ADR-004). The fixture is inlined here (rather
 * than a separate `apps/shared/spec` file) to stay within this slice's allowed file scope;
 * the C# port mirrors these exact rows.
 *
 * Web contract reproduced row-for-row:
 *  - an array passes through unchanged;
 *  - `null`/JSON-null, an object, or any scalar collapses to an empty array.
 */
class AdminSafeArrayGoldenTest {
    @Serializable
    private data class GoldenRow(
        val name: String,
        @SerialName("input") val input: JsonElement,
        @SerialName("expected") val expected: JsonElement,
    )

    private val json = Json

    private fun rows(): List<GoldenRow> = json.decodeFromString(GOLDEN)

    @Test
    fun goldenFileParsesAndCoversEveryNonArrayKind() {
        val names = rows().map { it.name }.toSet()
        assertTrue(rows().size >= 8, "safeArray golden should be comprehensive, got ${rows().size}")
        // Every non-array JSON kind the web guard must collapse is represented.
        listOf(
            "empty_array",
            "non_empty_array",
            "array_of_objects",
            "json_null",
            "object",
            "number",
            "string",
            "boolean",
        ).forEach { assertTrue(it in names, "golden missing the '$it' case") }
    }

    @Test
    fun everyGoldenRowMatchesSafeArray() {
        for (row in rows()) {
            val actual: JsonArray = safeArray(row.input)
            assertEquals(
                row.expected,
                actual,
                "safeArray('${row.name}') expected ${row.expected} but got $actual",
            )
        }
    }

    private companion object {
        val GOLDEN =
            """
            [
              { "name": "empty_array",      "input": [],                 "expected": [] },
              { "name": "non_empty_array",  "input": [1, 2, 3],          "expected": [1, 2, 3] },
              { "name": "array_of_objects", "input": [{"id":"k1"}],      "expected": [{"id":"k1"}] },
              { "name": "json_null",        "input": null,               "expected": [] },
              { "name": "object",           "input": {"unexpected":true},"expected": [] },
              { "name": "number",           "input": 42,                 "expected": [] },
              { "name": "string",           "input": "oops",             "expected": [] },
              { "name": "boolean",          "input": true,               "expected": [] }
            ]
            """.trimIndent()
    }
}
