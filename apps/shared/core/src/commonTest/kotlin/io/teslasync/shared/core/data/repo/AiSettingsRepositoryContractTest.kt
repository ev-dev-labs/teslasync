package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderReason
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpAiSettingsRepository] call to the exact endpoint/method/params/body the web
 * `useAiSettings` hooks issue, the settings-merge rule, the cache invalidation, and the
 * 422→Failure / other-error→failure split. A path/param/body/merge regression is caught at build
 * time instead of as a silent always-fails AI-settings panel in production.
 */
class AiSettingsRepositoryContractTest {
    private val json = Json

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        status: HttpStatusCode = HttpStatusCode.OK,
        body: String = "{}",
        maxRetries: Int = 1,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpAiSettingsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig(maxRetries = maxRetries))
        return HttpAiSettingsRepository(api, store)
    }

    // ---- saveAiSettings -----------------------------------------------------------

    @Test
    fun saveAiSettingsMergesPatchOverCachedDocAndPutsSettings() =
        runTestBlocking {
            val store = MapCacheStore()
            // Cached full settings document (the analogue of qc.getQueryData(settingsKeys.settings)).
            store.putRaw(CacheDomain.Settings, "settings", "{\"theme\":\"dark\",\"ai_mode\":\"off\"}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "{\"theme\":\"dark\",\"ai_mode\":\"cloud\",\"ai_provider\":\"openai\"}") { seen = it }

            val patch =
                json.parseToJsonElement("{\"ai_mode\":\"cloud\",\"ai_provider\":\"openai\"}") as JsonObject
            val result = r.saveAiSettings(patch)

            assertTrue(result.isSuccess)
            val req = assertNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/settings", req.url.encodedPath)
            val sentBody = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            // Verbatim { ...current, ...patch }: untouched key preserved, overridden key wins, new key added.
            assertEquals("dark", sentBody["theme"]!!.jsonPrimitive.content)
            assertEquals("cloud", sentBody["ai_mode"]!!.jsonPrimitive.content)
            assertEquals("openai", sentBody["ai_provider"]!!.jsonPrimitive.content)
            // invalidateQueries(settingsKeys.settings) analogue: the cached document is evicted.
            assertNull(store.read(CacheDomain.Settings, "settings"))
        }

    @Test
    fun saveAiSettingsFailsClosedWhenCacheEmptyAndIssuesNoRequest() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo { seen = it } // empty store

            val result = r.saveAiSettings(json.parseToJsonElement("{\"ai_mode\":\"cloud\"}") as JsonObject)

            assertTrue(result.isFailure)
            assertEquals(
                "settings cache empty — refresh the page and try again",
                result.exceptionOrNull()?.message,
            )
            // Fail-closed: no PUT is attempted, so saved preferences can never be partial-overwritten.
            assertNull(seen)
        }

    @Test
    fun saveAiSettingsFailureDoesNotInvalidateCache() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Settings, "settings", "{\"ai_mode\":\"off\"}", 1)
            val r = repo(store, status = HttpStatusCode.InternalServerError, body = "nope", maxRetries = 0)

            val result = r.saveAiSettings(json.parseToJsonElement("{\"ai_mode\":\"cloud\"}") as JsonObject)

            assertTrue(result.isFailure)
            // A failed save must leave the cached document untouched.
            assertNotNull(store.read(CacheDomain.Settings, "settings"))
        }

    // ---- validateAiProvider -------------------------------------------------------

    @Test
    fun validateProviderPostsBodyOmittingNullsAndParsesSuccess() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r =
                repo(
                    body =
                        "{\"ok\":true,\"mode\":\"local\",\"base_url\":\"http://localhost:11434\"," +
                            "\"pinned_ip\":\"127.0.0.1\",\"probed_model\":\"llama3\",\"note\":\"reachable\"}",
                ) { seen = it }

            val result =
                r.validateAiProvider(
                    ValidateAiProviderRequest(mode = "local", baseUrl = "http://localhost:11434"),
                )

            assertTrue(result.isSuccess)
            val req = assertNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/settings/ai/validate-config", req.url.encodedPath)
            val sentBody = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("local", sentBody["mode"]!!.jsonPrimitive.content)
            assertEquals("http://localhost:11434", sentBody["base_url"]!!.jsonPrimitive.content)
            // Null cloud fields are omitted, mirroring JSON.stringify dropping undefined keys.
            assertFalse(sentBody.containsKey("api_key"))
            assertFalse(sentBody.containsKey("provider"))

            val success = result.getOrNull() as ValidateAiProviderResult.Success
            assertEquals("local", success.mode)
            assertEquals("http://localhost:11434", success.baseUrl)
            assertEquals("127.0.0.1", success.pinnedIp)
            assertEquals("llama3", success.probedModel)
            assertEquals("reachable", success.note)
        }

    @Test
    fun validateProviderSendsCloudFieldsWithSnakeCaseKeys() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{\"ok\":true,\"mode\":\"cloud\",\"base_url\":\"https://api.openai.com\"}") { seen = it }

            r.validateAiProvider(
                ValidateAiProviderRequest(
                    mode = "cloud",
                    provider = "azure",
                    apiKey = "sk-test",
                    model = "gpt-4o",
                    apiVersion = "2024-02-01",
                    flavor = "azure-openai",
                    deployment = "gpt4o-deploy",
                    embeddingModel = "text-embedding-3-small",
                    embeddingDeployment = "embed-deploy",
                ),
            )

            val sentBody = json.parseToJsonElement((assertNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals("azure", sentBody["provider"]!!.jsonPrimitive.content)
            assertEquals("sk-test", sentBody["api_key"]!!.jsonPrimitive.content)
            assertEquals("gpt-4o", sentBody["model"]!!.jsonPrimitive.content)
            assertEquals("2024-02-01", sentBody["api_version"]!!.jsonPrimitive.content)
            assertEquals("azure-openai", sentBody["flavor"]!!.jsonPrimitive.content)
            assertEquals("gpt4o-deploy", sentBody["deployment"]!!.jsonPrimitive.content)
            assertEquals("text-embedding-3-small", sentBody["embedding_model"]!!.jsonPrimitive.content)
            assertEquals("embed-deploy", sentBody["embedding_deployment"]!!.jsonPrimitive.content)
            // camelCase keys must never leak onto the wire.
            assertFalse(sentBody.containsKey("apiKey"))
            assertFalse(sentBody.containsKey("apiVersion"))
            assertFalse(sentBody.containsKey("embeddingModel"))
        }

    @Test
    fun validateProvider422IsReshapedIntoFailureVariant() =
        runTestBlocking {
            val r =
                repo(
                    status = HttpStatusCode.UnprocessableEntity,
                    body = "{\"error\":\"base URL resolved to a public address\",\"code\":\"not_local\"}",
                    maxRetries = 0,
                )

            val result =
                r.validateAiProvider(ValidateAiProviderRequest(mode = "local", baseUrl = "http://1.2.3.4"))

            // A 422 is a validation OUTCOME, not an error: success Result carrying Failure.
            assertTrue(result.isSuccess)
            val failure = result.getOrNull() as ValidateAiProviderResult.Failure
            assertEquals(ValidateAiProviderReason.NOT_LOCAL, failure.reason)
            assertEquals("base URL resolved to a public address", failure.message)
        }

    @Test
    fun validateProvider422WithUnknownCodeCollapsesToUnknownReason() =
        runTestBlocking {
            val r =
                repo(
                    status = HttpStatusCode.UnprocessableEntity,
                    body = "{\"error\":\"weird\",\"code\":\"brand_new_code\"}",
                    maxRetries = 0,
                )

            val result = r.validateAiProvider(ValidateAiProviderRequest(mode = "cloud", provider = "x"))

            val failure = result.getOrNull() as ValidateAiProviderResult.Failure
            assertEquals(ValidateAiProviderReason.UNKNOWN, failure.reason)
            assertEquals("weird", failure.message)
        }

    @Test
    fun validateProviderNon422ErrorSurfacesAsFailureResult() =
        runTestBlocking {
            val r =
                repo(
                    status = HttpStatusCode.InternalServerError,
                    body = "{\"error\":\"boom\"}",
                    maxRetries = 0,
                )

            val result = r.validateAiProvider(ValidateAiProviderRequest(mode = "cloud", provider = "x"))

            // Non-422 (network/5xx) must re-fail so the consumer's error path fires.
            assertTrue(result.isFailure)
        }
}
