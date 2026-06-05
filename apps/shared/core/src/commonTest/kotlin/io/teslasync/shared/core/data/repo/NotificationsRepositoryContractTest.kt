package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.notifications.AlertRuleInput
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleUpdate
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestTarget
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreviewInput
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpNotificationsRepository] call to the exact endpoint/method/params/body the web
 * `useNotifications` hooks issue (web/src/api/hooks/useNotifications.ts). A path/param/body/method
 * regression — a double `/api/v1` prefix, a camelCase query param, a forgotten `grouped=true`, a
 * `group_key` that should have been stripped, or a create/update verb swap — is caught at build time
 * instead of as a silently-broken Notifications screen.
 */
class NotificationsRepositoryContractTest {
    private val json = Json

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpNotificationsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpNotificationsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpNotificationsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private suspend fun captureMutation(
        body: String,
        status: HttpStatusCode = HttpStatusCode.OK,
        call: suspend (HttpNotificationsRepository) -> Result<*>,
    ): HttpRequestData {
        var seen: HttpRequestData? = null
        val r = repo(body = body, status = status) { seen = it }
        val result = call(r)
        assertTrue(result.isSuccess, "mutation should succeed; was $result")
        return requireNotNull(seen)
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: paths + query params ----------------------------------------------

    @Test
    fun alertsHitsAlertsRoot() =
        runTestBlocking {
            assertEquals("/api/v1/alerts", captureRead { it.alerts() }.encodedPath)
        }

    @Test
    fun alertDetailHitsIdScopedPath() =
        runTestBlocking {
            assertEquals("/api/v1/alerts/5", captureRead("""{"id":5}""") { it.alertDetail(5) }.encodedPath)
        }

    @Test
    fun alertRulesAndMetricsHitTheirRoots() =
        runTestBlocking {
            assertEquals("/api/v1/alerts/rules", captureRead { it.alertRules() }.encodedPath)
            assertEquals("/api/v1/alerts/metrics", captureRead { it.alertMetrics() }.encodedPath)
        }

    @Test
    fun channelsListHitsNotificationsRoot() =
        runTestBlocking {
            assertEquals("/api/v1/notifications", captureRead { it.notificationChannels() }.encodedPath)
        }

    @Test
    fun notificationLogsSerializesFiltersAsSnakeCaseCsv() =
        runTestBlocking {
            val url =
                captureRead {
                    it.notificationLogs(
                        NotificationFilters(
                            severity = listOf("critical", "warning"),
                            vehicleId = listOf(1, 2),
                            read = false,
                            q = "boot",
                            limit = 50,
                        ),
                    )
                }
            assertEquals("/api/v1/notifications/logs", url.encodedPath)
            assertEquals("critical,warning", url.parameters["severity"])
            assertEquals("1,2", url.parameters["vehicle_id"])
            assertEquals("false", url.parameters["read"])
            assertEquals("boot", url.parameters["q"])
            assertEquals("50", url.parameters["limit"])
        }

    @Test
    fun notificationGroupsPutsGroupedFlagAndDropsGroupKey() =
        runTestBlocking {
            val url =
                captureRead {
                    it.notificationGroups(NotificationFilters(read = true, groupKey = "should-be-dropped"))
                }
            assertEquals("/api/v1/notifications/logs", url.encodedPath)
            assertEquals("true", url.parameters["grouped"])
            assertEquals("true", url.parameters["read"])
            assertNull(url.parameters["group_key"], "grouped query must not carry group_key (mutual exclusion)")
        }

    @Test
    fun groupMembersReusesFlatEndpointWithGroupKey() =
        runTestBlocking {
            val url = captureRead { it.groupMembers("thread-9", NotificationFilters(read = false)) }
            assertEquals("/api/v1/notifications/logs", url.encodedPath)
            assertEquals("thread-9", url.parameters["group_key"])
            assertEquals("false", url.parameters["read"])
        }

    @Test
    fun unreadCountHitsItsEndpoint() =
        runTestBlocking {
            assertEquals(
                "/api/v1/notifications/unread-count",
                captureRead("""{"count":3}""") { it.unreadCount() }.encodedPath,
            )
        }

    @Test
    fun unreadNotificationsBoundsLimitAndFixesReadArchived() =
        runTestBlocking {
            val url = captureRead { it.unreadNotifications(0) }
            assertEquals("/api/v1/notifications/logs", url.encodedPath)
            assertEquals("false", url.parameters["read"])
            assertEquals("false", url.parameters["archived"])
            assertEquals("1", url.parameters["limit"], "web Math.max(1, n) lower-bound")
        }

    @Test
    fun statsHitsItsEndpoint() =
        runTestBlocking {
            assertEquals(
                "/api/v1/notifications/stats",
                captureRead("""{"sent":1}""") { it.notificationStats() }.encodedPath,
            )
        }

    @Test
    fun quietHoursHitsEndpointAndUnwrapsWindows() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = """{"windows":[{"id":7,"enabled":true}]}""")
            val emissions = r.quietHours().toList()
            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals(7L, success.data.first().id)
        }

    @Test
    fun readDecodeFailureSurfacesAsErrorNotThrow() =
        runTestBlocking {
            val r = repo(body = """[{"id":"not-a-number"}]""")
            assertTrue(r.alerts().toList().last() is Resource.Error)
        }

    // ---- Mutations: alerts --------------------------------------------------------

    @Test
    fun markAlertReadPostsReadPath() =
        runTestBlocking {
            val req = captureMutation("", HttpStatusCode.NoContent) { it.markAlertRead(5) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/5/read", req.url.encodedPath)
        }

    @Test
    fun acknowledgeSendsTrimmedNoteWhenPresent() =
        runTestBlocking {
            val req = captureMutation("""{"id":5}""") { it.acknowledgeAlert(5, note = "  done  ") }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/5/acknowledge", req.url.encodedPath)
            assertEquals("done", bodyOf(req)["note"]!!.jsonPrimitive.content)
        }

    @Test
    fun acknowledgeSendsEmptyObjectWhenNoteBlankOrNull() =
        runTestBlocking {
            val req = captureMutation("""{"id":5}""") { it.acknowledgeAlert(5, note = "   ") }
            assertNull(bodyOf(req)["note"], "blank note must be dropped, leaving {}")
        }

    @Test
    fun commentPostsTrimmedNote() =
        runTestBlocking {
            val req = captureMutation("""{"id":5}""") { it.commentAlert(5, note = "  hi  ") }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/5/comment", req.url.encodedPath)
            assertEquals("hi", bodyOf(req)["note"]!!.jsonPrimitive.content)
        }

    @Test
    fun reopenPostsReopenPath() =
        runTestBlocking {
            val req = captureMutation("""{"id":5}""") { it.reopenAlert(5) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/5/reopen", req.url.encodedPath)
        }

    // ---- Mutations: alert rules ---------------------------------------------------

    @Test
    fun saveAlertRuleCreatePostsToRulesRoot() =
        runTestBlocking {
            val req =
                captureMutation("""{"id":1}""") {
                    it.saveAlertRule(AlertRuleSaveRequest.Create(AlertRuleInput(name = "Low battery", signalName = "soc")))
                }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/rules", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("Low battery", body["name"]!!.jsonPrimitive.content)
            assertEquals("soc", body["signal_name"]!!.jsonPrimitive.content)
            assertNull(body["id"], "create body must be id-free")
        }

    @Test
    fun saveAlertRuleUpdatePutsToIdPathWithoutIdInBody() =
        runTestBlocking {
            val req =
                captureMutation("""{"id":9}""") {
                    it.saveAlertRule(AlertRuleSaveRequest.Update(id = 9, patch = AlertRuleUpdate(enabled = true)))
                }
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/alerts/rules/9", req.url.encodedPath)
            val body = bodyOf(req)
            assertTrue(body["enabled"]!!.jsonPrimitive.boolean)
            assertNull(body["id"], "the id is carried by the path, not the body")
        }

    @Test
    fun deleteAlertRuleSendsDelete() =
        runTestBlocking {
            val req = captureMutation("", HttpStatusCode.NoContent) { it.deleteAlertRule(9) }
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/alerts/rules/9", req.url.encodedPath)
        }

    @Test
    fun toggleAlertRulePutsEnabledFlag() =
        runTestBlocking {
            val req = captureMutation("""{"id":9,"enabled":false}""") { it.toggleAlertRule(9, enabled = false) }
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/alerts/rules/9", req.url.encodedPath)
            assertFalse(bodyOf(req)["enabled"]!!.jsonPrimitive.boolean)
        }

    @Test
    fun bulkEnableAndDisablePostIdsToTheirPaths() =
        runTestBlocking {
            val enable = captureMutation("""{"updated":2}""") { it.bulkEnableRules(listOf(1, 2)) }
            assertEquals("/api/v1/alerts/rules/bulk/enable", enable.url.encodedPath)
            assertEquals(listOf("1", "2"), bodyOf(enable)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })

            val disable = captureMutation("""{"updated":2}""") { it.bulkDisableRules(listOf(3, 4)) }
            assertEquals("/api/v1/alerts/rules/bulk/disable", disable.url.encodedPath)
            assertEquals(listOf("3", "4"), bodyOf(disable)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        }

    @Test
    fun testAlertRulePostsToAlertsTest() =
        runTestBlocking {
            val req =
                captureMutation("", HttpStatusCode.NoContent) {
                    it.testAlertRule(AlertTestRequest(message = "ping", target = AlertTestTarget(allChannels = true)))
                }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/test", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("ping", body["message"]!!.jsonPrimitive.content)
            assertTrue((body["target"] as JsonObject)["all_channels"]!!.jsonPrimitive.boolean)
        }

    @Test
    fun snoozePostsToSnoozePath() =
        runTestBlocking {
            val req = captureMutation("""{"id":9}""") { it.snoozeAlertRule(9, AlertRuleSnoozeRequest(minutes = 30)) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/rules/9/snooze", req.url.encodedPath)
            assertEquals("30", bodyOf(req)["minutes"]!!.jsonPrimitive.content)
        }

    @Test
    fun previewComputedMetricPostsKindToAlertsTest() =
        runTestBlocking {
            val req =
                captureMutation("{}") {
                    it.previewComputedMetric(
                        ComputedMetricPreviewInput(metricId = "energy", metricWindow = "7d", metricOp = ">", metricThreshold = 5.0),
                    )
                }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/test", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("computed_metric", body["kind"]!!.jsonPrimitive.content)
            assertEquals("energy", body["metric_id"]!!.jsonPrimitive.content)
        }

    // ---- Mutations: notifications inbox -------------------------------------------

    @Test
    fun markNotificationsReadPostsIds() =
        runTestBlocking {
            val req = captureMutation("""{"updated":2}""") { it.markNotificationsRead(listOf(1, 2)) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/mark-read", req.url.encodedPath)
            assertEquals(listOf("1", "2"), bodyOf(req)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        }

    @Test
    fun bulkMarkReadSendsExactlyOneVariantKey() =
        runTestBlocking {
            val ids = captureMutation("""{"updated":1}""") { it.bulkMarkRead(BulkMarkReadVars.Ids(listOf(5))) }
            assertEquals("/api/v1/notifications/mark-read", ids.url.encodedPath)
            with(bodyOf(ids)) {
                assertEquals(listOf("5"), this["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
                assertNull(this["all"])
                assertNull(this["group_key"])
            }

            val all = captureMutation("""{"updated":1}""") { it.bulkMarkRead(BulkMarkReadVars.All) }
            with(bodyOf(all)) {
                assertTrue(this["all"]!!.jsonPrimitive.boolean)
                assertNull(this["ids"])
                assertNull(this["group_key"])
            }

            val group = captureMutation("""{"updated":1}""") { it.bulkMarkRead(BulkMarkReadVars.Group("t-1")) }
            with(bodyOf(group)) {
                assertEquals("t-1", this["group_key"]!!.jsonPrimitive.content)
                assertNull(this["ids"])
                assertNull(this["all"])
            }
        }

    @Test
    fun unreadArchiveUnarchivePostIdsToTheirPaths() =
        runTestBlocking {
            assertEquals(
                "/api/v1/notifications/mark-unread",
                captureMutation("""{"updated":1}""") { it.markNotificationsUnread(listOf(1)) }.url.encodedPath,
            )
            assertEquals(
                "/api/v1/notifications/archive",
                captureMutation("""{"updated":1}""") { it.archiveNotifications(listOf(1)) }.url.encodedPath,
            )
            assertEquals(
                "/api/v1/notifications/unarchive",
                captureMutation("""{"updated":1}""") { it.unarchiveNotifications(listOf(1)) }.url.encodedPath,
            )
        }

    @Test
    fun deleteNotificationsSendsDeleteWithIdsBody() =
        runTestBlocking {
            val req = captureMutation("""{"deleted":2}""") { it.deleteNotifications(listOf(1, 2)) }
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/notifications/logs", req.url.encodedPath)
            assertEquals(listOf("1", "2"), bodyOf(req)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        }

    // ---- Mutations: channels ------------------------------------------------------

    @Test
    fun saveChannelCreatePostsToNotificationsRoot() =
        runTestBlocking {
            val req =
                captureMutation("""{"kind":"discord","id":1,"name":"ops"}""") {
                    it.saveChannel(NotificationChannelInput.Discord(name = "ops", webhookUrl = "https://d"))
                }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("discord", body["kind"]!!.jsonPrimitive.content)
            assertNull(body["id"], "create body must be id-free")
        }

    @Test
    fun saveChannelUpdatePutsToIdPath() =
        runTestBlocking {
            val req =
                captureMutation("""{"kind":"discord","id":3,"name":"ops"}""") {
                    it.saveChannel(NotificationChannelInput.Discord(id = 3, name = "ops", webhookUrl = "https://d"))
                }
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/notifications/3", req.url.encodedPath)
        }

    @Test
    fun deleteChannelSendsDelete() =
        runTestBlocking {
            val req = captureMutation("", HttpStatusCode.NoContent) { it.deleteChannel(3) }
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/notifications/3", req.url.encodedPath)
        }

    @Test
    fun toggleChannelPostsToTogglePath() =
        runTestBlocking {
            val req = captureMutation("""{"kind":"discord","id":3,"name":"ops"}""") { it.toggleChannel(3) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/3/toggle", req.url.encodedPath)
        }

    @Test
    fun testChannelPostsToTestPath() =
        runTestBlocking {
            val req = captureMutation("""{"success":true}""") { it.testChannel(3) }
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/3/test", req.url.encodedPath)
        }

    // ---- Mutations: quiet hours ---------------------------------------------------

    @Test
    fun saveQuietHoursCreatePostsWhenIdNullOrZero() =
        runTestBlocking {
            val create = captureMutation("""{"id":1}""") { it.saveQuietHours(QuietHoursWindowInput(enabled = true)) }
            assertEquals(HttpMethod.Post, create.method)
            assertEquals("/api/v1/notifications/quiet-hours", create.url.encodedPath)

            val zero = captureMutation("""{"id":1}""") { it.saveQuietHours(QuietHoursWindowInput(enabled = true), id = 0) }
            assertEquals(HttpMethod.Post, zero.method)
            assertEquals("/api/v1/notifications/quiet-hours", zero.url.encodedPath)
        }

    @Test
    fun saveQuietHoursUpdatePatchesToIdPath() =
        runTestBlocking {
            val req = captureMutation("""{"id":4}""") { it.saveQuietHours(QuietHoursWindowInput(enabled = false), id = 4) }
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/notifications/quiet-hours/4", req.url.encodedPath)
        }

    @Test
    fun deleteQuietHoursSendsDelete() =
        runTestBlocking {
            val req = captureMutation("", HttpStatusCode.NoContent) { it.deleteQuietHours(4) }
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/notifications/quiet-hours/4", req.url.encodedPath)
        }

    @Test
    fun readsCacheUnderTheNotificationsDomain() =
        runTestBlocking {
            val store = MapCacheStore()
            repo(store, body = "[]").alerts().toList()
            assertTrue(store.read(CacheDomain.Notifications, alertsKey()) != null)
        }
}
