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
import io.teslasync.shared.core.presentation.automations.AutomationActionInput
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import io.teslasync.shared.core.presentation.automations.AutomationConditionInput
import io.teslasync.shared.core.presentation.automations.AutomationFullInput
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpAutomationsRepository] call to the exact endpoint/method/params/body the web
 * `useAutomations` hooks issue (web/src/api/hooks/useAutomations.ts). A path/param/body
 * regression — especially an id-bearing step the strict `DisallowUnknownFields` backend would
 * 400 — is caught at build time instead of as a silently-broken Automations screen.
 */
class AutomationsRepositoryContractTest {
    private val json = Json

    private val listBody =
        """[{"id":1,"name":"Night charge","enabled":true}]"""

    private val fullBody =
        """
        {"id":5,"name":"Night charge","enabled":true,
         "steps":[{"id":11,"automation_id":5,"step_order":0,"kind":"trigger_signal"}],
         "triggers":[{"kind":"trigger_signal","id":11,"automation_id":5,"step_order":0,
                      "signal":"battery_level","op":"<","value_num":20}],
         "conditions":[],"actions":[]}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpAutomationsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAutomationsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpAutomationsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun automationsHitsRootWithNoTrailingSlash() =
        runTestBlocking {
            val url = captureRead(listBody) { it.automations() }
            assertEquals("/api/v1/automations", url.encodedPath)
        }

    @Test
    fun automationsDecodesTypedRowsAndCachesUnderListKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = listBody)
            val emissions = r.automations().toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("Night charge", success.data.first().name)
            assertTrue(store.read(CacheDomain.Automations, automationListKey()) != null)
        }

    @Test
    fun automationHistorySendsLimit() =
        runTestBlocking {
            val url = captureRead("""{"items":[],"total":0}""") { it.automationHistory(50) }
            assertEquals("/api/v1/automations/history", url.encodedPath)
            assertEquals("50", url.parameters["limit"])
        }

    @Test
    fun automationDetailHitsByIdAndDecodesStepsAndLanes() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = fullBody)
            val emissions = r.automation(5).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(5L, success.data.id)
            // Per-step identity preserved on `steps`; the lane array drops the inline ids.
            assertEquals(1, success.data.steps.size)
            assertEquals(
                0,
                success.data.steps
                    .first()
                    .stepOrder,
            )
            assertEquals(1, success.data.triggers.size)
            assertTrue(success.data.triggers.first() is AutomationTriggerInput.Signal)
        }

    @Test
    fun automationDetailUrl() =
        runTestBlocking {
            val url = captureRead(fullBody) { it.automation(5) }
            assertEquals("/api/v1/automations/5", url.encodedPath)
        }

    @Test
    fun presetsOmitsCategoryWhenNullOrBlank() =
        runTestBlocking {
            val none = captureRead("""{"categories":[],"presets":[]}""") { it.automationPresets() }
            assertEquals("/api/v1/automations/presets", none.encodedPath)
            assertNull(none.parameters["category"])

            val blank = captureRead("""{"categories":[],"presets":[]}""") { it.automationPresets("") }
            assertNull(blank.parameters["category"])
        }

    @Test
    fun presetsSendsCategoryWhenPresent() =
        runTestBlocking {
            val url = captureRead("""{"categories":[],"presets":[]}""") { it.automationPresets("comfort") }
            assertEquals("comfort", url.parameters["category"])
        }

    @Test
    fun presetDetailHitsByStringId() =
        runTestBlocking {
            val url = captureRead("""{"id":"p1","name":"Preset"}""") { it.automationPreset("p1") }
            assertEquals("/api/v1/automations/presets/p1", url.encodedPath)
        }

    // ---- Mutations: method + path + body ------------------------------------------

    @Test
    fun toggleSendsPatchWithEnabledBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":5,"enabled":false}""") { seen = it }

            val result = r.toggleAutomation(5, enabled = false)

            assertTrue(result.isSuccess)
            assertEquals(false, result.getOrThrow().enabled)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/automations/5/toggle", req.url.encodedPath)
            assertFalse(bodyOf(req)["enabled"]!!.jsonPrimitive.content.toBoolean())
        }

    @Test
    fun reEnableSendsPatchNoBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":5,"enabled":true,"auto_disabled":false}""") { seen = it }

            val result = r.reEnableAutomation(5)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/automations/5/re-enable", req.url.encodedPath)
        }

    @Test
    fun deleteSendsDeleteById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteAutomation(5)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/automations/5", req.url.encodedPath)
        }

    @Test
    fun bulkPostsIdsAndWireOp() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"updated":2}""") { seen = it }

            val result = r.bulkAutomationsUpdate(listOf(1, 2), AutomationBulkOp.DISABLE)

            assertTrue(result.isSuccess)
            assertEquals(2, result.getOrThrow().updated)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/automations/bulk", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals(listOf("1", "2"), body["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
            assertEquals("disable", body["op"]!!.jsonPrimitive.content)
        }

    @Test
    fun testRunPostsById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "") { seen = it }

            val result = r.testRunAutomation(5)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/automations/5/test-run", req.url.encodedPath)
        }

    @Test
    fun createPostsIdFreeStepsWithKindDiscriminator() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = fullBody) { seen = it }

            val input =
                AutomationFullInput(
                    name = "Night charge",
                    description = "desc",
                    vehicleId = 7,
                    triggers =
                        listOf(
                            AutomationTriggerInput.Signal(
                                stepOrder = 0,
                                signal = "battery_level",
                                op = "<",
                                valueNum = 20.0,
                            ),
                        ),
                    conditions =
                        listOf(
                            AutomationConditionInput.TimeWindow(
                                startTime = "22:00",
                                endTime = "06:00",
                                timezone = "UTC",
                                daysOfWeek = listOf(1, 2),
                            ),
                        ),
                    actions = listOf(AutomationActionInput.Command(commandName = "charge_start")),
                )

            val result = r.createAutomationFull(input)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/automations", req.url.encodedPath)

            val body = bodyOf(req)
            assertEquals("Night charge", body["name"]!!.jsonPrimitive.content)
            assertEquals("desc", body["description"]!!.jsonPrimitive.content)
            assertEquals("7", body["vehicle_id"]!!.jsonPrimitive.content)
            // `enabled` is null ⇒ dropped from the wire (web JSON.stringify parity).
            assertFalse(body.containsKey("enabled"))

            val trigger = body["triggers"]!!.jsonArray.first().jsonObject
            assertEquals("trigger_signal", trigger["kind"]!!.jsonPrimitive.content)
            assertEquals("battery_level", trigger["signal"]!!.jsonPrimitive.content)
            assertEquals("<", trigger["op"]!!.jsonPrimitive.content)
            assertEquals(20.0, trigger["value_num"]!!.jsonPrimitive.double)
            assertEquals(0, trigger["step_order"]!!.jsonPrimitive.content.toInt())
            // Backend rejects id-bearing steps — they must NEVER be on the wire.
            assertFalse(trigger.containsKey("id"))
            assertFalse(trigger.containsKey("automation_id"))
            assertFalse(trigger.containsKey("step_id"))

            val condition = body["conditions"]!!.jsonArray.first().jsonObject
            assertEquals("condition_time_window", condition["kind"]!!.jsonPrimitive.content)
            assertEquals(listOf("1", "2"), condition["days_of_week"]!!.jsonArray.map { it.jsonPrimitive.content })

            val action = body["actions"]!!.jsonArray.first().jsonObject
            assertEquals("action_command", action["kind"]!!.jsonPrimitive.content)
            assertEquals("charge_start", action["command_name"]!!.jsonPrimitive.content)
        }

    @Test
    fun updatePutsById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = fullBody) { seen = it }

            val result = r.updateAutomationFull(5, AutomationFullInput(name = "Edited"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/automations/5", req.url.encodedPath)
            assertEquals("Edited", bodyOf(req)["name"]!!.jsonPrimitive.content)
        }

    @Test
    fun mutationFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpAutomationsRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.deleteAutomation(5)

            assertTrue(result.isFailure)
        }

    @Test
    fun successBodyThatNoLongerMatchesDtoSurfacesAsError() =
        runTestBlocking {
            // A 2xx whose shape drifted (id is not a number) is a contract error, surfaced as
            // Resource.Error WITHOUT throwing across the flow boundary.
            val r = repo(body = """[{"id":"not-a-number","name":"x"}]""")
            val emissions = r.automations().toList()
            assertTrue(emissions.last() is Resource.Error)
        }
}
