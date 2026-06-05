package io.teslasync.shared.core.presentation.notifications

import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.acknowledgeBody
import io.teslasync.shared.core.data.repo.alertDetailKey
import io.teslasync.shared.core.data.repo.alertsKey
import io.teslasync.shared.core.data.repo.bellUnreadKey
import io.teslasync.shared.core.data.repo.bulkMarkReadBody
import io.teslasync.shared.core.data.repo.notificationFilterKey
import io.teslasync.shared.core.data.repo.notificationFilterParams
import io.teslasync.shared.core.data.repo.notificationGroupsKey
import io.teslasync.shared.core.data.repo.notificationGroupsParams
import io.teslasync.shared.core.data.repo.notificationLogsKey
import io.teslasync.shared.core.data.repo.unreadCountKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Language-neutral golden vectors locking the non-trivial, client-side derivations ported from the
 * web `useNotifications` domain (web/src/api/hooks/useNotifications.ts) so the Windows C# port and
 * the KMP core cannot drift (ADR-004):
 *
 *  1. [notificationFilterParams] — the web `serializeNotificationFilters` (ordered snake_case map;
 *     multi-value → CSV; bool stringified only when non-null; string only when non-blank; number
 *     always when present).
 *  2. [notificationGroupsParams] — the web `useNotificationGroups` params (`grouped=true` first,
 *     then the filters with `group_key` dropped — the backend mutual-exclusion contract).
 *  3. [bulkMarkReadBody] — the web `useBulkMarkRead` body (exactly one of `ids` | `all` | `group_key`).
 *  4. [acknowledgeBody] — the web `useAcknowledgeAlert` body (`{ note }` only when the trimmed note
 *     is non-empty, sending the VERBATIM trimmed value; otherwise `{}`).
 *  5. The cache/feed key builders (the web TanStack `notificationKeys.*`), including the shared
 *     `notification-logs:` prefix every log-family key sits under.
 *
 * The same vectors are mirrored verbatim in apps/shared/core/spec/notifications-golden.json — the
 * shared source of truth the C# port consumes. Fixtures are inlined here to stay within this slice's
 * allowed file scope.
 */
class NotificationsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- filter serialization -----------------------------------------------------

    @Serializable
    private data class FilterRow(
        val name: String,
        val severity: List<String>? = null,
        val vehicleId: List<Long>? = null,
        val ruleId: List<Long>? = null,
        val from: String? = null,
        val to: String? = null,
        val read: Boolean? = null,
        val archived: Boolean? = null,
        val q: String? = null,
        val groupKey: String? = null,
        val limit: Int? = null,
        val offset: Int? = null,
        val expected: Map<String, String>,
    )

    private fun FilterRow.toFilters(): NotificationFilters =
        NotificationFilters(
            severity = severity,
            vehicleId = vehicleId,
            ruleId = ruleId,
            from = from,
            to = to,
            read = read,
            archived = archived,
            q = q,
            groupKey = groupKey,
            limit = limit,
            offset = offset,
        )

    @Test
    fun filterParamsMatchGolden() {
        val rows: List<FilterRow> = json.decodeFromString(FILTER_GOLDEN)
        assertTrue(
            rows.map { it.name }.containsAll(
                listOf("empty", "csvMultiValue", "boolsAndBlanks", "groupKeyKept", "zeroNumbers"),
            ),
        )
        for (row in rows) {
            assertEquals(row.expected, notificationFilterParams(row.toFilters()), "notificationFilterParams('${row.name}')")
        }
    }

    @Test
    fun filterParamOrderIsCanonical() {
        // Order is part of the contract (the web serializer appends in this exact sequence).
        val params =
            notificationFilterParams(
                NotificationFilters(
                    severity = listOf("critical"),
                    vehicleId = listOf(2),
                    ruleId = listOf(3),
                    from = "a",
                    to = "b",
                    read = false,
                    archived = true,
                    q = "x",
                    groupKey = "g",
                    limit = 10,
                    offset = 20,
                ),
            )
        assertEquals(
            listOf("severity", "vehicle_id", "rule_id", "from", "to", "read", "archived", "q", "group_key", "limit", "offset"),
            params.keys.toList(),
        )
    }

    @Test
    fun groupsParamsPutGroupedFirstAndDropGroupKey() {
        val params = notificationGroupsParams(NotificationFilters(read = true, groupKey = "drop-me"))
        assertEquals("true", params["grouped"])
        assertEquals(listOf("grouped", "read"), params.keys.toList(), "grouped is first; group_key is gone")
        assertEquals("true", params["read"])
        assertTrue(!params.containsKey("group_key"))
    }

    // ---- bulk mark-read body ------------------------------------------------------

    @Test
    fun bulkMarkReadBodyMatchesGolden() {
        assertEquals("""{"ids":[1,2]}""", bulkMarkReadBody(BulkMarkReadVars.Ids(listOf(1, 2))).toString())
        assertEquals("""{"all":true}""", bulkMarkReadBody(BulkMarkReadVars.All).toString())
        assertEquals("""{"group_key":"t-1"}""", bulkMarkReadBody(BulkMarkReadVars.Group("t-1")).toString())
    }

    @Test
    fun bulkMarkReadBodyCarriesExactlyOneKey() {
        for (vars in listOf(BulkMarkReadVars.Ids(listOf(9)), BulkMarkReadVars.All, BulkMarkReadVars.Group("g"))) {
            assertEquals(1, bulkMarkReadBody(vars).size, "exactly one mutually-exclusive key")
        }
    }

    // ---- acknowledge body ---------------------------------------------------------

    @Serializable
    private data class AckRow(
        val name: String,
        val note: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun acknowledgeBodyMatchesGolden() {
        val rows: List<AckRow> = json.decodeFromString(ACK_GOLDEN)
        assertTrue(rows.map { it.name }.containsAll(listOf("null", "blank", "trimmed", "verbatim")))
        for (row in rows) {
            val expected = json.parseToJsonElement(json.encodeToString(row.expected)) as JsonObject
            assertEquals(expected, acknowledgeBody(row.note), "acknowledgeBody('${row.name}')")
        }
    }

    // ---- cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMatchGolden() {
        assertEquals("alerts", alertsKey())
        assertEquals("alert-detail:7", alertDetailKey(7))
        assertEquals("notification-logs:unread-count", unreadCountKey())
        assertEquals("notification-logs:bell-unread:5", bellUnreadKey(5))
        // Every log-family key sits under the shared prefix the inbox writes invalidate.
        assertTrue(notificationLogsKey(NotificationFilters()).startsWith("notification-logs:"))
        assertTrue(notificationGroupsKey(NotificationFilters()).startsWith("notification-logs:"))
        assertTrue(unreadCountKey().startsWith("notification-logs:"))
        assertTrue(bellUnreadKey(5).startsWith("notification-logs:"))
    }

    @Test
    fun structurallyEqualFiltersFoldToOneFeedKey() {
        val a = NotificationFilters(severity = listOf("a"), read = false)
        val b = NotificationFilters(severity = listOf("a"), read = false)
        assertEquals(notificationFilterKey(a), notificationFilterKey(b))
        assertEquals(notificationLogsKey(a), notificationLogsKey(b))
    }

    @Test
    fun bellLimitLowerBoundConstantIsOne() {
        assertEquals(1, NotificationsRepository.MIN_BELL_LIMIT)
    }

    private companion object {
        val FILTER_GOLDEN =
            """
            [
              { "name": "empty", "expected": {} },
              {
                "name": "csvMultiValue",
                "severity": ["critical", "warning"], "vehicleId": [1, 2], "ruleId": [3],
                "expected": { "severity": "critical,warning", "vehicle_id": "1,2", "rule_id": "3" }
              },
              {
                "name": "boolsAndBlanks",
                "read": false, "archived": true, "q": "", "from": "",
                "expected": { "read": "false", "archived": "true" }
              },
              {
                "name": "groupKeyKept",
                "q": "boot", "groupKey": "thread-9",
                "expected": { "q": "boot", "group_key": "thread-9" }
              },
              {
                "name": "zeroNumbers",
                "limit": 0, "offset": 0,
                "expected": { "limit": "0", "offset": "0" }
              }
            ]
            """.trimIndent()

        val ACK_GOLDEN =
            """
            [
              { "name": "null", "expected": {} },
              { "name": "blank", "note": "   ", "expected": {} },
              { "name": "trimmed", "note": "  done  ", "expected": { "note": "done" } },
              { "name": "verbatim", "note": "ack", "expected": { "note": "ack" } }
            ]
            """.trimIndent()
    }
}
