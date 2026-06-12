package io.teslasync.android.featureviews.signalhistorytable

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the SignalHistoryTable pure model — the native port of the web component's
 * per-row `render` callbacks plus the `valueType` / `formatValue` field reads it imports from
 * `SignalQueryControls` (web/src/features/telemetry/components/SignalHistoryTable.tsx +
 * web/src/components/SignalQueryControls.tsx): the value-type discriminator + verbatim badge label, the
 * displayed value string (with JS `String(number)` parity), the per-signal color index, the row projection,
 * the expandable raw JSON (`JSON.stringify(r, null, 2)`), the header meta, the web-parity UiState mapping,
 * the timestamp formatting, and the PII-safe `view.opened` diagnostic.
 */
class SignalHistoryTableModelTest {
    private fun numEntry(
        value: Double,
        signal: String = "VehicleSpeed",
        createdAt: String = "2026-06-11T11:59:40Z",
    ): SignalLogEntry = SignalLogEntry(createdAt = createdAt, signal = signal, valueNum = value)

    private fun strEntry(
        value: String,
        signal: String = "Gear",
    ): SignalLogEntry = SignalLogEntry(createdAt = "2026-06-11T11:59:38Z", signal = signal, valueStr = value)

    private fun boolEntry(
        value: Boolean,
        signal: String = "Locked",
    ): SignalLogEntry = SignalLogEntry(createdAt = "2026-06-11T11:59:36Z", signal = signal, valueBool = value)

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

    // ── valueType (web valueType) ───────────────────────────────────────────────────────────────────

    @Test
    fun valueTypeDiscriminatesNumberBooleanString() {
        assertEquals(ValueType.Number, valueType(numEntry(1.0)))
        assertEquals(ValueType.Boolean, valueType(boolEntry(true)))
        assertEquals(ValueType.String, valueType(strEntry("D")))
        // A fully-empty row falls through to string, matching the web `else` arm.
        assertEquals(ValueType.String, valueType(SignalLogEntry("2026-06-11T00:00:00Z", "x")))
    }

    @Test
    fun typeLabelReturnsVerbatimWebTokens() {
        assertEquals("number", typeLabel(ValueType.Number))
        assertEquals("boolean", typeLabel(ValueType.Boolean))
        assertEquals("string", typeLabel(ValueType.String))
    }

    // ── formatValue (web formatValue) ───────────────────────────────────────────────────────────────

    @Test
    fun formatValueFollowsWebPrecedence() {
        assertEquals("64", formatValue(numEntry(64.0)))
        assertEquals("D", formatValue(strEntry("D")))
        assertEquals("true", formatValue(boolEntry(true)))
        assertEquals("false", formatValue(boolEntry(false)))
        assertEquals("\u2014", formatValue(SignalLogEntry("2026-06-11T00:00:00Z", "x")))
    }

    @Test
    fun formatSignalNumberMatchesJavaScriptStringConversion() {
        assertEquals("64", formatSignalNumber(64.0))
        assertEquals("0", formatSignalNumber(0.0))
        assertEquals("-12", formatSignalNumber(-12.0))
        assertEquals("64.5", formatSignalNumber(64.5))
        assertEquals("0.25", formatSignalNumber(0.25))
        assertEquals("1000000", formatSignalNumber(1_000_000.0))
    }

    // ── signalColorIndex (web selectedSignals.indexOf) ──────────────────────────────────────────────

    @Test
    fun signalColorIndexMirrorsSelectedSignalsPosition() {
        val selected = listOf("VehicleSpeed", "Gear", "Locked")
        assertEquals(0, signalColorIndex("VehicleSpeed", selected))
        assertEquals(2, signalColorIndex("Locked", selected))
        assertEquals(-1, signalColorIndex("BatteryLevel", selected))
        assertEquals(-1, signalColorIndex("Gear", emptyList()))
    }

    // ── SignalHistoryProjection.project (web per-row render callbacks) ───────────────────────────────

    @Test
    fun projectMapsEveryCellAndColorIndex() {
        val row =
            SignalHistoryProjection
                .project(
                    entries = listOf(numEntry(64.0)),
                    selectedSignals = listOf("VehicleSpeed", "Gear"),
                    formatTime = { iso -> "T:$iso" },
                ).single()

        assertEquals("2026-06-11T11:59:40Z-VehicleSpeed", row.key)
        assertEquals("T:2026-06-11T11:59:40Z", row.time)
        assertEquals("VehicleSpeed", row.signal)
        assertEquals(0, row.colorIndex)
        assertEquals("64", row.value)
        assertEquals(ValueType.Number, row.valueType)
        assertTrue(row.rawJson.contains("\"signal\": \"VehicleSpeed\""))
    }

    @Test
    fun projectGivesUnselectedSignalsNegativeColorIndex() {
        val row =
            SignalHistoryProjection
                .project(listOf(strEntry("D", signal = "Gear")), selectedSignals = listOf("VehicleSpeed")) { "T" }
                .single()
        assertEquals(-1, row.colorIndex)
        assertEquals(ValueType.String, row.valueType)
    }

    @Test
    fun rowKeyJoinsCreatedAtAndSignal() {
        assertEquals(
            "2026-06-11T11:59:40Z-VehicleSpeed",
            SignalHistoryProjection.rowKey(numEntry(1.0)),
        )
    }

    // ── toPrettyJson (web JSON.stringify(r, null, 2)) ────────────────────────────────────────────────

    @Test
    fun prettyJsonEmitsWebFieldOrderWithTwoSpaceIndent() {
        val json = toPrettyJson(numEntry(64.0))
        // Keys present, in web field order.
        val order =
            listOf("created_at", "signal", "value_num", "value_str", "value_bool")
                .map { json.indexOf("\"$it\"") }
        assertTrue(order.all { it >= 0 })
        assertEquals(order.sorted(), order)
        // Two-space indented entries (web `JSON.stringify(r, null, 2)`).
        assertTrue(json.contains("\n  \"created_at\""))
    }

    @Test
    fun prettyJsonEncodesIntegralNumberWithoutDecimalAndNullsForAbsent() {
        val json = toPrettyJson(numEntry(64.0))
        assertTrue(json.contains("\"value_num\": 64"))
        assertTrue(!json.contains("\"value_num\": 64.0"))
        assertTrue(json.contains("\"value_str\": null"))
        assertTrue(json.contains("\"value_bool\": null"))
    }

    @Test
    fun prettyJsonKeepsDecimalAndBooleanValues() {
        assertTrue(toPrettyJson(numEntry(64.5)).contains("\"value_num\": 64.5"))
        val boolJson = toPrettyJson(boolEntry(true))
        assertTrue(boolJson.contains("\"value_bool\": true"))
        assertTrue(boolJson.contains("\"value_num\": null"))
    }

    // ── headerMeta + formatRowCount (web `Page X · fmtInt(total) total`) ─────────────────────────────

    @Test
    fun headerMetaAssemblesWebMetaLine() {
        assertEquals("Page 3 \u00B7 1,234 total", headerMeta("Page", 3, "1,234", "total"))
    }

    @Test
    fun formatRowCountGroupsThousands() {
        assertEquals("1,234", formatRowCount(1_234, Locale.US))
        assertEquals("128", formatRowCount(128, Locale.US))
        assertEquals("0", formatRowCount(0, Locale.US))
    }

    // ── projectUiState (web loading ? skeleton : rows>0 ? table : empty) ─────────────────────────────

    @Test
    fun projectUiStateMapsLoadingEmptyAndContent() {
        val populated = SignalHistoryData(listOf(numEntry(1.0)), listOf("VehicleSpeed"), page = 1, pageSize = 50, totalRows = 1)
        val empty = SignalHistoryData.EMPTY

        assertEquals(UiPhase.Loading, projectUiState(populated, loading = true).phase)
        assertEquals(UiPhase.Empty, projectUiState(empty, loading = false).phase)
        assertEquals(UiPhase.Content, projectUiState(populated, loading = false).phase)
        // The page bundle is preserved on the state for the renderer.
        assertEquals(populated, projectUiState(populated, loading = false).data)
    }

    // ── SignalHistoryTimeFormatting (web useDateFormat().formatDateTime) ─────────────────────────────

    @Test
    fun timeFormattingRendersAbsoluteTimeAndEmDashForBadInput() {
        val formatted = SignalHistoryTimeFormatting.format("2026-06-11T11:59:40Z", ZoneOffset.UTC, Locale.US)
        assertTrue(formatted.contains("2026"))
        assertEquals("\u2014", SignalHistoryTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals("\u2014", SignalHistoryTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordSignalHistoryTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SignalHistoryTable"), opened.single().second)
    }
}
