@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage for the framework-free APIKeysPage projection (APIKeysPageModel.kt). Exercises the
 * `safeArray` list parse, the permission mapping, the created-key extraction, and the expiry predicate — the
 * native ports of the web page's derivations — with no Compose/Android/HTTP in scope.
 */
class APIKeysPageModelTest {
    @Test
    fun parseList_readsEveryFieldFromSnakeCaseRows() {
        val payload =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7)
                        put("name", "Grafana")
                        put("permissions", "read-write")
                        put("key_prefix", "ts_abc123...")
                        put("created_at", "2024-05-01T08:30:00Z")
                        put("last_used_at", "2024-06-01T10:00:00Z")
                        put("expires_at", JsonNull)
                    },
                )
            }

        val keys = ApiKeysProjection.parseList(payload)

        assertEquals(1, keys.size)
        val key = keys.first()
        assertEquals(7L, key.id)
        assertEquals("Grafana", key.name)
        assertEquals(PermissionLevel.ReadWrite, key.permission)
        assertEquals("ts_abc123...", key.keyPrefix)
        assertEquals(parseIsoMillis("2024-05-01T08:30:00Z"), key.createdAtMillis)
        assertEquals(parseIsoMillis("2024-06-01T10:00:00Z"), key.lastUsedAtMillis)
        assertNull(key.expiresAtMillis)
    }

    @Test
    fun parseList_guardsNonArrayAndDropsRowsWithoutId() {
        // A non-array collapses to empty (the shared safeArray contract).
        assertTrue(ApiKeysProjection.parseList(buildJsonObject { put("oops", true) }).isEmpty())
        assertTrue(ApiKeysProjection.parseList(null).isEmpty())

        // A row missing the required id is dropped rather than crashing the list.
        val payload =
            buildJsonArray {
                add(buildJsonObject { put("name", "no id") })
                add(
                    buildJsonObject {
                        put("id", 1)
                        put("name", "ok")
                        put("permissions", "read")
                    },
                )
            }
        val keys = ApiKeysProjection.parseList(payload)
        assertEquals(1, keys.size)
        assertEquals(1L, keys.first().id)
        // Absent prefix/dates degrade gracefully rather than throwing.
        assertEquals("", keys.first().keyPrefix)
        assertNull(keys.first().createdAtMillis)
    }

    @Test
    fun parseCreatedKey_extractsKeyOrNull() {
        val created = buildJsonObject { put("id", 1); put("key", "ts_secret_value"); put("name", "App") }
        assertEquals("ts_secret_value", ApiKeysProjection.parseCreatedKey(created))
        assertNull(ApiKeysProjection.parseCreatedKey(buildJsonObject { put("id", 1) }))
        assertNull(ApiKeysProjection.parseCreatedKey(buildJsonObject { put("key", "") }))
        assertNull(ApiKeysProjection.parseCreatedKey(null))
    }

    @Test
    fun permissionLevel_mapsWireTokensWithReadFallback() {
        assertEquals(PermissionLevel.Read, PermissionLevel.fromWire("read"))
        assertEquals(PermissionLevel.ReadWrite, PermissionLevel.fromWire("read-write"))
        assertEquals(PermissionLevel.Admin, PermissionLevel.fromWire("admin"))
        assertEquals(PermissionLevel.Read, PermissionLevel.fromWire("nonsense"))
        assertEquals(PermissionLevel.Read, PermissionLevel.fromWire(null))
    }

    @Test
    fun isExpired_followsTheWebExpiresAtPredicate() {
        val now = 1_700_000_000_000L
        val past = ApiKey(1, "a", PermissionLevel.Read, "p", null, null, now - 1)
        val future = ApiKey(2, "b", PermissionLevel.Read, "p", null, null, now + 1)
        val never = ApiKey(3, "c", PermissionLevel.Read, "p", null, null, null)

        assertTrue(past.isExpired(now))
        assertFalse(future.isExpired(now))
        assertFalse(never.isExpired(now))
    }

    @Test
    fun isEmpty_isTrueOnlyForAnEmptyList() {
        assertTrue(ApiKeysProjection.isEmpty(emptyList()))
        assertFalse(ApiKeysProjection.isEmpty(InMemoryApiKeysSource.SAMPLE_KEYS))
    }
}
