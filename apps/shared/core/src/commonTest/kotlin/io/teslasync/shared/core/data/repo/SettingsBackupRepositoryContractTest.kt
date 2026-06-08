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
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundleSections
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks every [HttpSettingsBackupRepository] call to the exact endpoint/method/body the web
 * `useSettingsBackup` hooks issue: `GET /settings/export`, and `POST /settings/import` with a
 * `{ dry_run, bundle }` body whose opaque sections round-trip verbatim. A path/method/body
 * regression is caught at build time instead of as a silent always-fails settings backup screen.
 */
class SettingsBackupRepositoryContractTest {
    private val json = Json

    // A bundle the typed `SettingsBundle` export read can decode, with opaque section payloads.
    private val bundleBody =
        """
        {"schema_version":1,"exported_at":"2026-01-01T00:00:00Z",
         "sections":{"settings":{"theme":"dark"},"alert_rules":[{"id":7,"name":"low battery"}],
                     "geofences":[],"quiet_hours":[{"start":"22:00"}]}}
        """.trimIndent()

    // An import result body both dry-run and apply can decode.
    private val resultBody =
        """
        {"dry_run":true,"sections":{"settings":{"added":1,"updated":2,"skipped":0},
         "alert_rules":{"added":3,"updated":0,"skipped":1,"conflicts":["dup-name"]}}}
        """.trimIndent()

    private fun repo(
        body: String,
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSettingsBackupRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSettingsBackupRepository(api)
    }

    private fun sampleBundle(): SettingsBundle =
        SettingsBundle(
            schemaVersion = 1,
            exportedAt = "2026-01-01T00:00:00Z",
            sections =
                SettingsBundleSections(
                    settings = JsonObject(mapOf("theme" to JsonPrimitive("dark"))),
                    alertRules = JsonArray(listOf(JsonObject(mapOf("id" to JsonPrimitive(7))))),
                ),
        )

    // ---- Export: method + path + decode -------------------------------------------

    @Test
    fun exportSettingsGetsSettingsExportAndDecodesBundle() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(bundleBody) { seen = it }

            val result = r.exportSettings()

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Get, req.method)
            assertEquals("/api/v1/settings/export", req.url.encodedPath)
            val bundle = result.getOrThrow()
            assertEquals(1, bundle.schemaVersion)
            assertEquals("2026-01-01T00:00:00Z", bundle.exportedAt)
            // Opaque sections decoded shape-preserving.
            val theme = bundle.sections.settings?.get("theme")
            assertEquals("dark", theme?.jsonPrimitive?.content)
            assertEquals(1, bundle.sections.alertRules?.size)
            assertEquals(1, bundle.sections.quietHours?.size)
        }

    // ---- Dry-run import: method + path + body -------------------------------------

    @Test
    fun dryRunImportPostsSettingsImportWithDryRunTrueAndBundle() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(resultBody) { seen = it }

            val result = r.dryRunImport(sampleBundle())

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/settings/import", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text).jsonObject
            assertTrue(body["dry_run"]!!.jsonPrimitive.boolean)
            // The bundle is nested verbatim under `bundle`.
            val sentBundle = body["bundle"]!!.jsonObject
            assertEquals(1, sentBundle["schema_version"]!!.jsonPrimitive.content.toInt())
            val sentSections = sentBundle["sections"]!!.jsonObject
            val sentSettings = sentSections["settings"]!!.jsonObject
            assertEquals("dark", sentSettings["theme"]!!.jsonPrimitive.content)
            // Decoded preview result carries per-section diffs incl. conflicts.
            val sections = result.getOrThrow().sections
            assertEquals(3, sections["alert_rules"]?.added)
            assertEquals(listOf("dup-name"), sections["alert_rules"]?.conflicts)
        }

    @Test
    fun applyImportPostsSettingsImportWithDryRunFalse() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(resultBody.replace("\"dry_run\":true", "\"dry_run\":false")) { seen = it }

            val result = r.applyImport(sampleBundle())

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/settings/import", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text).jsonObject
            // Apply path sends dry_run=false; the only difference from the preview body.
            assertFalse(body["dry_run"]!!.jsonPrimitive.boolean)
            assertTrue(body.containsKey("bundle"))
        }

    @Test
    fun importBundleRoundTripsOpaqueSectionsAndDropsAbsentOnes() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(resultBody) { seen = it }

            // Only `settings` and `alert_rules` are set on the bundle; geofences/quiet_hours are null.
            r.dryRunImport(sampleBundle())

            val req = requireNotNull(seen)
            val body = json.parseToJsonElement((req.body as TextContent).text).jsonObject
            val sentBundle = body["bundle"]!!.jsonObject
            val sentSections = sentBundle["sections"]!!.jsonObject
            // Present sections preserved verbatim.
            val firstRule = sentSections["alert_rules"]!!.jsonArray[0].jsonObject
            assertEquals(7, firstRule["id"]!!.jsonPrimitive.content.toInt())
            // Absent (null) sections are dropped (explicitNulls = false), mirroring JSON.stringify.
            assertFalse(sentSections.containsKey("geofences"))
            assertFalse(sentSections.containsKey("quiet_hours"))
        }

    // ---- Failure semantics --------------------------------------------------------

    @Test
    fun exportFailureSurfacesAsResultFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpSettingsBackupRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)))

            assertTrue(r.exportSettings().isFailure)
        }

    @Test
    fun applyFailureSurfacesAsResultFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("denied", HttpStatusCode.Unauthorized) }
            val r = HttpSettingsBackupRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)))

            assertTrue(r.applyImport(sampleBundle()).isFailure)
        }
}
