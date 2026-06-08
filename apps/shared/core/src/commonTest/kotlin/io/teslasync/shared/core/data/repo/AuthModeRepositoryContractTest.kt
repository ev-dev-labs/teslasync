package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Locks the [HttpAuthModeRepository] read to the exact endpoint/method the web `useAuthMode` hook
 * issues (web/src/api/hooks/useAuthMode.ts). A path regression — e.g. a double `/api/v1` prefix —
 * is caught at build time instead of as a silently-always-failing auth-mode contract in
 * production, and the typed contract shape (mode/subject/capabilities) is asserted to round-trip.
 */
class AuthModeRepositoryContractTest {
    private val body =
        """
        {
          "mode": "forward_auth",
          "subject_header": "X-Forwarded-User",
          "subject": "alice@example.com",
          "provider_hint": "Authentik",
          "capabilities": {
            "step_up_reauth": true,
            "totp_enrollment": true,
            "session_list": true,
            "impersonation": true,
            "rbac": true
          }
        }
        """.trimIndent()

    private fun repo(
        respondBody: String = body,
        onRequest: (Url) -> Unit = {},
    ): HttpAuthModeRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(respondBody, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAuthModeRepository(api, MapCacheStore())
    }

    @Test
    fun authModeHitsSystemAuthMode() =
        runTestBlocking {
            var url: Url? = null
            val r = repo { url = it }
            r.authMode().toList()
            assertEquals("/api/v1/system/auth-mode", url!!.encodedPath)
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val emissions = repo().authMode().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val last = emissions.last()
            assertTrue(last is Resource.Success, "terminal emission is the network success")
            assertEquals("forward_auth", last.data.mode)
            assertEquals("alice@example.com", last.data.subject)
            assertEquals("X-Forwarded-User", last.data.subjectHeader)
            assertEquals("Authentik", last.data.providerHint)
            assertTrue(last.data.capabilities.rbac)
            assertTrue(last.data.capabilities.impersonation)
        }

    @Test
    fun openModePayloadDecodesWithSafeDefaults() =
        runTestBlocking {
            val openBody =
                """
                {"mode":"open","capabilities":{"step_up_reauth":false,"totp_enrollment":false,
                "session_list":false,"impersonation":false,"rbac":false}}
                """.trimIndent().replace("\n", "")
            val emissions = repo(respondBody = openBody).authMode().toList()
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertEquals("open", last.data.mode)
            assertEquals(null, last.data.subject)
            assertEquals(null, last.data.subjectHeader)
            assertEquals(false, last.data.capabilities.rbac)
        }
}
