package io.teslasync.android.featureviews.responseviewer

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ResponseViewer's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/admin/components/ResponseViewer.tsx): the `loading`/`response` branch
 * selection, the `statusColor`/`statusBg` tone classifier, the `formatBytes` byte formatter, the
 * `contentType.includes('json') && typeof body !== 'string'` body derivation, the `RequestHistory`
 * projection (incl. the method-badge ternary + the chip `title`), and the four-language `generateSnippet`.
 * Because the surface is purely presentational, the projected [ResponseViewerDisplay] / [HistoryRow] are also
 * the per-state "snapshot": each is exactly what the thin composable renders, and [ResponseContent.body] /
 * [HistoryRow.accessibleLabel] are the text the body / chip expose to TalkBack.
 */
class ResponseViewerProjectionTest {
    private val sampleHeaders = linkedMapOf("content-type" to "application/json", "x-request-id" to "req_1")

    private fun jsonResponse(
        status: Int = 200,
        statusText: String = "OK",
        headers: Map<String, String> = sampleHeaders,
        durationMs: Long = 128L,
        sizeBytes: Long = 1536L,
    ) = ApiResponse(
        status = status,
        statusText = statusText,
        headers = headers,
        body = buildJsonObject { put("id", 7) },
        bodyText = "{\"id\":7}",
        durationMs = durationMs,
        sizeBytes = sizeBytes,
        contentType = "application/json",
    )

    // ── branch selection (web `loading ? … : !response ? … : …`) ───────────────────────

    @Test
    fun loadingBranchWinsEvenWithAResponse() {
        // Web renders `{loading && <Skeleton/>}` first, so a stale response is suppressed while loading.
        val display = ResponseViewerProjection.project(jsonResponse(), loading = true)
        assertEquals(ResponseViewerMode.Loading, display.mode)
        assertNull(display.content)
    }

    @Test
    fun missingResponseYieldsTheEmptyBranch() {
        val display = ResponseViewerProjection.project(response = null, loading = false)
        assertEquals(ResponseViewerMode.Empty, display.mode)
        assertNull(display.content)
    }

    @Test
    fun resolvedResponseYieldsTheContentBranch() {
        val display = ResponseViewerProjection.project(jsonResponse(), loading = false)
        assertEquals(ResponseViewerMode.Content, display.mode)
        assertNotNull(display.content)
    }

    // ── content projection (status line / meta / headers — the per-state snapshot) ──────

    @Test
    fun contentProjectsStatusLineMetaAndHeadersForTalkBack() {
        val content = ResponseViewerProjection.project(jsonResponse(), loading = false).content!!
        // Web status bar `{status} {statusText}` and `{duration}ms · {formatBytes(size)}`.
        assertEquals("200 OK", content.statusLine)
        assertEquals("128ms · 1.5 KB", content.meta)
        assertEquals(ResponseStatusTone.Success, content.tone)
        // Web `Object.entries(headers)` — insertion order preserved.
        assertEquals(listOf("content-type" to "application/json", "x-request-id" to "req_1"), content.headers)
        assertTrue(content.hasHeaders)
        assertEquals(2, content.headerCount)
    }

    @Test
    fun emptyHeadersHideTheHeadersToggle() {
        // Web `ResponseHeaders` returns null when there are no entries.
        val content = ResponseViewerProjection.project(jsonResponse(headers = emptyMap()), loading = false).content!!
        assertFalse(content.hasHeaders)
        assertEquals(0, content.headerCount)
    }

    // ── rendered body (web `contentType.includes('json') && typeof body !== 'string'`) ──

    @Test
    fun jsonObjectBodyIsPrettyPrintedWithTwoSpaceIndent() {
        val content = ResponseViewerProjection.project(jsonResponse(), loading = false).content!!
        assertEquals("{\n  \"id\": 7\n}", content.body)
    }

    @Test
    fun stringPrimitiveBodyFallsBackToRawText() {
        // Web `typeof body !== 'string'` is false for a JSON string, so the raw bodyText renders.
        val response =
            jsonResponse().copy(body = JsonPrimitive("just a string"), bodyText = "\"just a string\"")
        assertEquals("\"just a string\"", ResponseViewerProjection.renderedBody(response))
    }

    @Test
    fun nonJsonContentTypeFallsBackToRawText() {
        val response = jsonResponse().copy(contentType = "text/plain", bodyText = "plain text")
        assertEquals("plain text", ResponseViewerProjection.renderedBody(response))
    }

    @Test
    fun jsonNullBodyIsRenderedAsTheNullLiteral() {
        // Web `JSON.stringify(null, null, 2)` is the string "null"; a JSON null is not a JS string.
        val response = jsonResponse().copy(body = JsonNull, bodyText = "ignored")
        assertEquals("null", ResponseViewerProjection.renderedBody(response))
    }

    @Test
    fun absentBodyFallsBackToRawText() {
        // A web `undefined` body cannot be stringified; the raw text keeps the panel non-blank.
        val response = jsonResponse().copy(body = null, bodyText = "raw fallback")
        assertEquals("raw fallback", ResponseViewerProjection.renderedBody(response))
    }

    // ── status tone (web `statusColor`/`statusBg` ternary) ──────────────────────────────

    @Test
    fun statusToneMatchesTheWebTernaryBoundaries() {
        assertEquals(ResponseStatusTone.Success, ResponseStatusTone.forStatus(200))
        assertEquals(ResponseStatusTone.Success, ResponseStatusTone.forStatus(299))
        assertEquals(ResponseStatusTone.Redirect, ResponseStatusTone.forStatus(300))
        assertEquals(ResponseStatusTone.Redirect, ResponseStatusTone.forStatus(399))
        assertEquals(ResponseStatusTone.Error, ResponseStatusTone.forStatus(400))
        assertEquals(ResponseStatusTone.Error, ResponseStatusTone.forStatus(500))
    }

    // ── method tone (web history method-badge ternary, case-sensitive) ──────────────────

    @Test
    fun methodToneMatchesTheWebTernaryCaseSensitively() {
        assertEquals(HttpMethodTone.Get, HttpMethodTone.forMethod("GET"))
        assertEquals(HttpMethodTone.Post, HttpMethodTone.forMethod("POST"))
        assertEquals(HttpMethodTone.Delete, HttpMethodTone.forMethod("DELETE"))
        assertEquals(HttpMethodTone.Other, HttpMethodTone.forMethod("PUT"))
        // Web compares with `===`, so a lower-case method falls through to the default (amber) tone.
        assertEquals(HttpMethodTone.Other, HttpMethodTone.forMethod("get"))
    }

    // ── byte formatter (web `formatBytes`) ──────────────────────────────────────────────

    @Test
    fun formatBytesReproducesTheWebThresholds() {
        assertEquals("512 B", formatBytes(512L))
        assertEquals("1023 B", formatBytes(1023L))
        assertEquals("1.0 KB", formatBytes(1024L))
        assertEquals("1.5 KB", formatBytes(1536L))
        assertEquals("1.0 MB", formatBytes(1_048_576L))
        assertEquals("1.5 MB", formatBytes(1_572_864L))
    }

    // ── history projection (web `RequestHistory`) ───────────────────────────────────────

    @Test
    fun historyGuardMatchesTheWebLengthCheck() {
        assertFalse(ResponseHistoryProjection.hasHistory(emptyList()))
        assertTrue(ResponseHistoryProjection.hasHistory(listOf(historyEntry())))
    }

    @Test
    fun historyRowCarriesTonesDurationAndTheAccessibleLabel() {
        val rows = ResponseHistoryProjection.rows(listOf(historyEntry()))
        val row = rows.single()
        assertEquals("GET", row.method)
        assertEquals(HttpMethodTone.Get, row.methodTone)
        assertEquals("/api/v1/vehicles", row.path)
        assertEquals(200, row.status)
        assertEquals(ResponseStatusTone.Success, row.statusTone)
        assertEquals("128ms", row.durationText)
        // Web chip `title={`{method} {path} → {status} ({duration}ms)`}` — the chip's accessible name.
        assertEquals("GET /api/v1/vehicles → 200 (128ms)", row.accessibleLabel)
    }

    @Test
    fun historyPreservesOrderAndPerEntryTone() {
        val rows =
            ResponseHistoryProjection.rows(
                listOf(
                    historyEntry(method = "POST", status = 201),
                    historyEntry(method = "DELETE", path = "/api/v1/alerts/3", status = 404, durationMs = 88L),
                ),
            )
        assertEquals(listOf(HttpMethodTone.Post, HttpMethodTone.Delete), rows.map { it.methodTone })
        assertEquals(listOf(ResponseStatusTone.Success, ResponseStatusTone.Error), rows.map { it.statusTone })
        assertEquals("DELETE /api/v1/alerts/3 → 404 (88ms)", rows[1].accessibleLabel)
    }

    // ── snippet generation (web `generateSnippet`) ──────────────────────────────────────

    @Test
    fun curlSnippetForGetOmitsBodyLines() {
        val snippet = SnippetModel.generate("GET", "https://x/api", SnippetFormat.Curl, body = null)
        val expected =
            "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies\n" +
                "curl -X GET 'https://x/api'"
        assertEquals(expected, snippet)
    }

    @Test
    fun curlSnippetForPostIncludesTheContinuedBodyLines() {
        val snippet = SnippetModel.generate("POST", "https://x/api", SnippetFormat.Curl, body = "{\"a\":1}")
        val expected =
            "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies\n" +
                "curl -X POST 'https://x/api' \\\n" +
                "  -H 'Content-Type: application/json' \\\n" +
                "  -d '{\"a\":1}'"
        assertEquals(expected, snippet)
    }

    @Test
    fun javascriptSnippetForPostIncludesHeadersAndBody() {
        val snippet = SnippetModel.generate("POST", "https://x/api", SnippetFormat.JavaScript, body = "{\"a\":1}")
        val expected =
            "// Auth: include credentials or X-API-Key header\n" +
                "const response = await fetch('https://x/api', {\n" +
                "  method: 'POST',\n" +
                "  headers: { 'Content-Type': 'application/json' },\n" +
                "  body: JSON.stringify({\"a\":1}),\n" +
                "});\n" +
                "const data = await response.json();"
        assertEquals(expected, snippet)
    }

    @Test
    fun javascriptSnippetForGetOmitsHeadersAndBody() {
        val snippet = SnippetModel.generate("GET", "https://x/api", SnippetFormat.JavaScript, body = null)
        val expected =
            "// Auth: include credentials or X-API-Key header\n" +
                "const response = await fetch('https://x/api', {\n" +
                "  method: 'GET',\n" +
                "});\n" +
                "const data = await response.json();"
        assertEquals(expected, snippet)
    }

    @Test
    fun pythonSnippetForPostPassesJsonKeyword() {
        val snippet = SnippetModel.generate("POST", "https://x/api", SnippetFormat.Python, body = "{\"a\":1}")
        val expected =
            "# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}\n" +
                "import requests\n" +
                "\n" +
                "response = requests.post('https://x/api', json={\"a\":1})\n" +
                "data = response.json()"
        assertEquals(expected, snippet)
    }

    @Test
    fun pythonSnippetForGetLowercasesTheMethodAndOmitsJson() {
        val snippet = SnippetModel.generate("GET", "https://x/api", SnippetFormat.Python, body = null)
        val expected =
            "# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}\n" +
                "import requests\n" +
                "\n" +
                "response = requests.get('https://x/api')\n" +
                "data = response.json()"
        assertEquals(expected, snippet)
    }

    @Test
    fun goSnippetForGetUsesHttpGet() {
        val snippet = SnippetModel.generate("GET", "https://x/api", SnippetFormat.Go, body = null)
        val expected =
            "// Auth: add X-API-Key header to the request\n" +
                "resp, err := http.Get(\"https://x/api\")\n" +
                "if err != nil { log.Fatal(err) }\n" +
                "defer resp.Body.Close()"
        assertEquals(expected, snippet)
    }

    @Test
    fun goSnippetForPostBuildsARequestWithTheBody() {
        val snippet = SnippetModel.generate("POST", "https://x/api", SnippetFormat.Go, body = "{\"a\":1}")
        val expected =
            "// Auth: add X-API-Key header to the request\n" +
                "body := strings.NewReader(`{\"a\":1}`)\n" +
                "req, _ := http.NewRequest(\"POST\", \"https://x/api\", body)\n" +
                "req.Header.Set(\"Content-Type\", \"application/json\")\n" +
                "resp, err := http.DefaultClient.Do(req)\n" +
                "if err != nil { log.Fatal(err) }\n" +
                "defer resp.Body.Close()"
        assertEquals(expected, snippet)
    }

    @Test
    fun goSnippetForPostWithoutBodyFallsBackToEmptyObject() {
        // Web `body ?? '{}'`: a missing body is sent as an empty JSON object literal.
        val snippet = SnippetModel.generate("POST", "https://x/api", SnippetFormat.Go, body = null)
        assertTrue(snippet.contains("strings.NewReader(`{}`)"))
    }

    @Test
    fun formatSelectorExposesTheFourWebLanguagesInOrder() {
        assertEquals(
            listOf("curl", "javascript", "python", "go"),
            SnippetModel.formats.map { it.key },
        )
        assertEquals(listOf("cURL", "JavaScript", "Python", "Go"), SnippetModel.formats.map { it.label })
        assertEquals(SnippetFormat.Curl, SnippetFormat.fromKey("curl"))
        // An unknown key falls back to the web initial value (`curl`).
        assertEquals(SnippetFormat.Curl, SnippetFormat.fromKey("unknown"))
    }

    private fun historyEntry(
        method: String = "GET",
        path: String = "/api/v1/vehicles",
        status: Int = 200,
        durationMs: Long = 128L,
    ) = HistoryEntry(method = method, path = path, status = status, durationMs = durationMs, timestamp = "t")
}
