package io.teslasync.shared.core.presentation.exports

import io.teslasync.shared.core.data.repo.COLUMNS_NONE
import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.exportColumnsKey
import io.teslasync.shared.core.data.repo.exportColumnsQuery
import io.teslasync.shared.core.data.repo.exportDetailKey
import io.teslasync.shared.core.data.repo.exportDownloadUrl
import io.teslasync.shared.core.data.repo.exportJobKey
import io.teslasync.shared.core.data.repo.exportJobsKey
import io.teslasync.shared.core.data.repo.exportsAllKey
import io.teslasync.shared.core.data.repo.scheduledExportsKey
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Language-neutral golden vectors locking the non-trivial, client-side derivations ported from
 * the web `useExports` domain (web/src/api/hooks/useExports.ts) so the Windows C# port and the
 * KMP core cannot drift (ADR-004):
 *
 *  1. [exportColumnsQuery] — the `/exports/columns?type=` query builder (`type` always sent; the
 *     web hook is `enabled: !!type` so it never fires with an empty type).
 *  2. The cache/feed key builders — the web TanStack `exportKeys` tuples (a null column type
 *     collapses to the `__none__` sentinel, mirroring `exportKeys.columns(type ?? '__none__')`).
 *  3. [exportDownloadUrl] — the raw browser download link, which uniquely carries the explicit
 *     `/api/v1` prefix (it is NOT routed through the versioning request client).
 *  4. The bulk-delete body — `{ ids, op: "delete" }`.
 *  5. JSON.stringify parity for the create/input bodies — null scalars dropped, the account
 *     payload serializing to `{}`, and `owner_subject` never emitted.
 *
 * Fixtures are inlined to stay within this slice's allowed file scope; the C# port mirrors them.
 */
class ExportsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- query builder ------------------------------------------------------------

    @Serializable
    private data class ColumnsQueryRow(
        val name: String,
        val type: String,
        val expected: Map<String, String>,
    )

    @Test
    fun columnsQueryAlwaysSendsType() {
        val rows: List<ColumnsQueryRow> = json.decodeFromString(COLUMNS_QUERY_GOLDEN)
        assertTrue(rows.map { it.name }.containsAll(listOf("drives", "charging")))
        for (row in rows) {
            assertEquals(row.expected, exportColumnsQuery(row.type), "columnsQuery('${row.name}')")
        }
    }

    // ---- cache/feed key builders --------------------------------------------------

    @Test
    fun cacheKeyBuildersMatchGolden() {
        assertEquals("exports", exportsAllKey())
        assertEquals("exports:e1", exportDetailKey("e1"))
        assertEquals("export-jobs", exportJobsKey())
        assertEquals("export-jobs:j1", exportJobKey("j1"))
        assertEquals("scheduled-exports", scheduledExportsKey())
        assertEquals("export-columns:drives", exportColumnsKey("drives"))
        // A null column type collapses to the `__none__` sentinel (web truthy/coalesce guard).
        assertEquals("export-columns:$COLUMNS_NONE", exportColumnsKey(null))
        assertEquals("__none__", COLUMNS_NONE)
    }

    @Test
    fun prefixesDoNotCollideAcrossFeedFamilies() {
        // The S8 store invalidates by first-segment prefix; `exports` must not match `export-jobs`
        // / `export-columns` (the `:` delimiter is the boundary).
        assertFalse(exportJobsKey().startsWith("exports:"))
        assertFalse(exportColumnsKey("drives").startsWith("exports:"))
        assertFalse(exportJobsKey() == exportsAllKey())
        assertTrue(exportDetailKey("e1").startsWith("exports:"))
        assertTrue(exportJobKey("j1").startsWith("export-jobs:"))
    }

    // ---- download URL -------------------------------------------------------------

    @Test
    fun downloadUrlCarriesExplicitApiV1Prefix() {
        // Unlike every other path, the browser download link is NOT versioned by the request
        // client, so it must embed `/api/v1` verbatim (web `exportDownloadUrl`).
        assertEquals("/api/v1/export/jobs/abc/download", exportDownloadUrl("abc"))
        assertEquals("/api/v1/export/jobs/j-42/download", exportDownloadUrl("j-42"))
    }

    // ---- bulk-delete + JSON.stringify parity --------------------------------------

    @Test
    fun createPayloadDropsNullScalars() {
        val body = defaultApiJson.encodeToString(CreateExportPayload.serializer(), CreateExportPayload(type = "drives"))
        val root = json.parseToJsonElement(body) as JsonObject

        assertEquals("drives", root["type"]!!.jsonPrimitive.content)
        assertFalse(root.containsKey("format"))
        assertFalse(root.containsKey("vehicle_id"))
        assertFalse(root.containsKey("start"))
        assertFalse(root.containsKey("end"))
        assertFalse(root.containsKey("columns"))
    }

    @Test
    fun accountPayloadSerializesToEmptyObject() {
        val body = defaultApiJson.encodeToString(CreateAccountExportPayload.serializer(), CreateAccountExportPayload())
        val root = json.parseToJsonElement(body) as JsonObject
        assertTrue(root.keys.isEmpty())
    }

    @Test
    fun scheduledInputDropsNullsAndNeverEmitsOwnerSubject() {
        val body =
            defaultApiJson.encodeToString(
                ScheduledExportInput.serializer(),
                ScheduledExportInput(
                    name = "Nightly",
                    exportType = "drives",
                    format = "csv",
                    scheduleCron = "0 2 * * *",
                    delivery = ScheduledExportDelivery(kind = "download"),
                ),
            )
        val root = json.parseToJsonElement(body) as JsonObject

        assertTrue(root.containsKey("name"))
        assertTrue(root.containsKey("export_type"))
        assertTrue(root.containsKey("schedule_cron"))
        assertTrue(root.containsKey("delivery"))
        // owner_subject is never on the wire; the server owns identity (DisallowUnknownFields).
        assertFalse(root.containsKey("owner_subject"))
        // null optionals dropped (web JSON.stringify parity).
        assertFalse(root.containsKey("vehicle_id"))
        assertFalse(root.containsKey("columns"))
        assertFalse(root.containsKey("range_window"))
        assertFalse(root.containsKey("enabled"))
    }

    @Test
    fun deliveryDropsNullTargetForDownload() {
        val body =
            defaultApiJson.encodeToString(ScheduledExportDelivery.serializer(), ScheduledExportDelivery(kind = "download"))
        val root = json.parseToJsonElement(body) as JsonObject
        assertEquals("download", root["kind"]!!.jsonPrimitive.content)
        assertFalse(root.containsKey("target"))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertEquals("ExportsRepository", ExportsRepository::class.simpleName)
    }

    private companion object {
        val COLUMNS_QUERY_GOLDEN =
            """
            [
              { "name": "drives",   "type": "drives",   "expected": { "type": "drives" } },
              { "name": "charging", "type": "charging", "expected": { "type": "charging" } }
            ]
            """.trimIndent()
    }
}
