package io.teslasync.android.featureviews.telemetryerrorspanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TelemetryErrorsPanel's pure projection — the native port of the web
 * component's `if (!requested) … loading … error … errors.length > 0 … else` render ladder, the empty
 * badge selection (`ok ? '0' : '?'`), the raw-response disclosure gate (`!ok && rawData != null`), the
 * export filename + JSON blob, and the PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx).
 */
class TelemetryErrorsPanelProjectionTest {
    private val sampleErrors =
        listOf(
            TelemetryError(rowKey = "0", timestamp = "2026-06-11T12:00:00Z", code = "STREAM_DISCONNECTED", message = "Stream dropped"),
            TelemetryError(rowKey = "1", timestamp = "2026-06-11T11:00:00Z", code = "GATEWAY_TIMEOUT", message = "Upstream timed out"),
        )

    @Suppress("LongParameterList")
    private fun project(
        requested: Boolean = true,
        loading: Boolean = false,
        error: String? = null,
        errors: List<TelemetryError> = emptyList(),
        ok: Boolean = true,
        vin: String = "5YJ3E1EA1KF000001",
        rawData: kotlinx.serialization.json.JsonElement? = null,
    ): TelemetryErrorsPanelState = TelemetryErrorsPanelProjection.project(requested, loading, error, errors, ok, vin, rawData)

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── Branch precedence (web if-ladder) ───────────────────────────────────────────────────────────

    @Test
    fun idleWhenNotRequested() {
        assertEquals(TelemetryErrorsPanelState.Idle, project(requested = false, loading = true, error = "boom", errors = sampleErrors))
    }

    @Test
    fun loadingWhenRequestedAndLoading() {
        assertEquals(TelemetryErrorsPanelState.Loading, project(loading = true))
    }

    @Test
    fun loadingTakesPrecedenceOverError() {
        assertEquals(TelemetryErrorsPanelState.Loading, project(loading = true, error = "ignored while loading"))
    }

    @Test
    fun failureWhenErrorPresent() {
        val state = project(error = "Request failed: 502")
        assertTrue(state is TelemetryErrorsPanelState.Failure)
        assertEquals("Request failed: 502", (state as TelemetryErrorsPanelState.Failure).message)
    }

    @Test
    fun emptyErrorStringIsNotFailure() {
        // The web `if (error)` treats "" as falsy, so an empty string is "no error".
        val state = project(error = "", ok = true)
        assertTrue(state is TelemetryErrorsPanelState.Empty)
    }

    @Test
    fun dataWhenErrorsPresent() {
        val state = project(errors = sampleErrors)
        assertTrue(state is TelemetryErrorsPanelState.Data)
        assertEquals(sampleErrors, (state as TelemetryErrorsPanelState.Data).errors)
    }

    @Test
    fun dataTakesPrecedenceOverEmptyEvenWhenNotOk() {
        val state = project(errors = sampleErrors, ok = false)
        assertTrue(state is TelemetryErrorsPanelState.Data)
    }

    // ── Empty branch: badge + raw disclosure ────────────────────────────────────────────────────────

    @Test
    fun emptyHealthyWhenOkAndNoErrors() {
        val state = project(ok = true) as TelemetryErrorsPanelState.Empty
        assertEquals(TelemetryErrorsEmptyBadge.Healthy, state.badge)
        assertEquals("0", state.badge.text)
    }

    @Test
    fun emptyUnknownWhenNotOk() {
        val state = project(ok = false) as TelemetryErrorsPanelState.Empty
        assertEquals(TelemetryErrorsEmptyBadge.Unknown, state.badge)
        assertEquals("?", state.badge.text)
    }

    @Test
    fun emptyHealthyNeverDisclosesRawEvenWhenRawDataPresent() {
        val raw = buildJsonObject { put("response", "ok") }
        val state = project(ok = true, rawData = raw) as TelemetryErrorsPanelState.Empty
        assertNull(state.rawJson)
    }

    @Test
    fun emptyUnknownDisclosesRawWhenRawDataPresent() {
        val raw = buildJsonObject { put("unexpected", "shape") }
        val state = project(ok = false, rawData = raw) as TelemetryErrorsPanelState.Empty
        val rawJson = requireNotNull(state.rawJson)
        assertTrue(rawJson.contains("unexpected"))
        assertTrue(rawJson.contains("shape"))
    }

    @Test
    fun emptyUnknownHidesRawWhenRawDataNull() {
        val state = project(ok = false, rawData = null) as TelemetryErrorsPanelState.Empty
        assertNull(state.rawJson)
    }

    @Test
    fun emptyUnknownHidesRawWhenJsonNull() {
        // A JSON `null` is treated as absent, mirroring the JS `rawData != null` nullish check.
        val state = project(ok = false, rawData = JsonNull) as TelemetryErrorsPanelState.Empty
        assertNull(state.rawJson)
    }

    // ── Export blob (web Blob download) ─────────────────────────────────────────────────────────────

    @Test
    fun downloadFileNameUsesVin() {
        assertEquals("telemetry-errors-5YJ3E1EA1KF000001.json", TelemetryErrorsPanelProjection.downloadFileName("5YJ3E1EA1KF000001"))
    }

    @Test
    fun downloadFileNameFallsBackToAllWhenBlank() {
        assertEquals("telemetry-errors-all.json", TelemetryErrorsPanelProjection.downloadFileName(""))
        assertEquals("telemetry-errors-all.json", TelemetryErrorsPanelProjection.downloadFileName("   "))
    }

    @Test
    fun downloadJsonContainsPrettyPrintedErrorFields() {
        val download = TelemetryErrorsPanelProjection.downloadOf("VIN", sampleErrors)
        assertEquals("telemetry-errors-VIN.json", download.fileName)
        assertTrue(download.json.contains("\"code\": \"STREAM_DISCONNECTED\""))
        assertTrue(download.json.contains("\"rowKey\": \"0\""))
        // Pretty-printed (newline-separated), matching web JSON.stringify(errors, null, 2).
        assertTrue(download.json.contains("\n"))
    }

    @Test
    fun dataStatePrecomputesDownloadFromAllErrors() {
        val state = project(errors = sampleErrors, vin = "ABC") as TelemetryErrorsPanelState.Data
        assertEquals("telemetry-errors-ABC.json", state.download.fileName)
        assertTrue(state.download.json.contains("GATEWAY_TIMEOUT"))
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordTelemetryErrorsPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TelemetryErrorsPanel"), opened.single().second)
    }
}
