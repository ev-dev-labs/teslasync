package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpSystemDiagnosticRepository] call to the exact endpoint/method/body the web
 * `useRunDiagnostic` hook issues: a bodyless `POST /system/diagnostic` that decodes the aggregated
 * [io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport]. A path/method/body or
 * decode regression is caught at build time instead of as a silent runtime bug.
 */
class SystemDiagnosticRepositoryContractTest {
    private val reportBody =
        """
        {"generated_at":"2026-06-05T12:00:00Z","overall_status":"degraded","checks":[
          {"id":"tesla_token","name":"Tesla token","status":"ok","detail":"valid","duration_ms":12},
          {"id":"signal_log","name":"signal_log freshness","status":"warn","detail":"stale","remediation":"check ingest","duration_ms":40}
        ]}
        """.trimIndent()

    private fun repo(
        body: String = reportBody,
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSystemDiagnosticRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSystemDiagnosticRepository(api)
    }

    @Test
    fun runDiagnosticPostsSystemDiagnosticWithNoBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo { seen = it }

            val result = r.runDiagnostic()

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/system/diagnostic", req.url.encodedPath)
            // The web hook sends `{ method: 'POST' }` with no payload — assert no JSON body went out.
            assertNull(req.body as? TextContent)
            assertEquals(0L, req.body.contentLength)
        }

    @Test
    fun runDiagnosticDecodesTheAggregatedReport() =
        runTestBlocking {
            val report = repo().runDiagnostic().getOrThrow()

            assertEquals("2026-06-05T12:00:00Z", report.generatedAt)
            assertEquals("degraded", report.overallStatus)
            assertEquals(2, report.checks.size)
            val token = report.checks.first()
            assertEquals("tesla_token", token.id)
            assertEquals("ok", token.status)
            assertEquals(12, token.durationMs)
            assertNull(token.remediation)
            val signalLog = report.checks[1]
            assertEquals("check ingest", signalLog.remediation)
            assertEquals(40, signalLog.durationMs)
        }

    @Test
    fun failedRunSurfacesAsResultFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("boom", HttpStatusCode.InternalServerError) }
            val r = HttpSystemDiagnosticRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)))

            assertTrue(r.runDiagnostic().isFailure)
        }
}
