package io.teslasync.android.featureviews.signaldifftable

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SignalDiffTable pure projection — the native port of the web component's
 * `formatRaw` / `asNumber` cell reads, the `deltaLabel` numeric/changed/none classification, the
 * case-insensitive name filter and pinned-first sort the web parent applies, the `QueryError` classification,
 * and the PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/telemetry/components/SignalDiffTable.tsx).
 */
class SignalDiffTableProjectionTest {
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

    // ── formatRaw (web formatRaw) ───────────────────────────────────────────────────────────────────────

    @Test
    fun formatRawAbsentOrNullIsEmDash() {
        assertEquals(EM_DASH, SignalDiffTableProjection.formatRaw(null))
        assertEquals(EM_DASH, SignalDiffTableProjection.formatRaw(JsonNull))
    }

    @Test
    fun formatRawNumberUsesGroupedTwoDecimals() {
        assertEquals("64.00", SignalDiffTableProjection.formatRaw(JsonPrimitive(64)))
        assertEquals("1,234.50", SignalDiffTableProjection.formatRaw(JsonPrimitive(1234.5)))
    }

    @Test
    fun formatRawBooleanIsLiteral() {
        assertEquals("true", SignalDiffTableProjection.formatRaw(JsonPrimitive(true)))
        assertEquals("false", SignalDiffTableProjection.formatRaw(JsonPrimitive(false)))
    }

    @Test
    fun formatRawStringIsVerbatim() {
        assertEquals("Drive", SignalDiffTableProjection.formatRaw(JsonPrimitive("Drive")))
    }

    @Test
    fun formatRawCompoundIsCompactJson() {
        val obj =
            buildJsonObject {
                put("lat", 1.5)
                put("lon", 2.0)
            }
        assertEquals("{\"lat\":1.5,\"lon\":2.0}", SignalDiffTableProjection.formatRaw(obj))
        val arr =
            buildJsonArray {
                add(JsonPrimitive(1))
                add(JsonPrimitive(2))
            }
        assertEquals("[1,2]", SignalDiffTableProjection.formatRaw(arr))
    }

    // ── asNumber (web asNumber) ─────────────────────────────────────────────────────────────────────────

    @Test
    fun asNumberFromNumberStringAndBoolean() {
        assertEquals(64.0, SignalDiffTableProjection.asNumber(JsonPrimitive(64)))
        assertEquals(12.5, SignalDiffTableProjection.asNumber(JsonPrimitive("12.5")))
        assertEquals(1.0, SignalDiffTableProjection.asNumber(JsonPrimitive(true)))
        assertEquals(0.0, SignalDiffTableProjection.asNumber(JsonPrimitive(false)))
    }

    @Test
    fun asNumberRejectsBlankNonNumericAndNull() {
        assertNull(SignalDiffTableProjection.asNumber(null))
        assertNull(SignalDiffTableProjection.asNumber(JsonNull))
        assertNull(SignalDiffTableProjection.asNumber(JsonPrimitive("   ")))
        assertNull(SignalDiffTableProjection.asNumber(JsonPrimitive("Drive")))
    }

    // ── deltaOf (web deltaLabel) ────────────────────────────────────────────────────────────────────────

    @Test
    fun deltaNumericPositiveHasSignedDeltaAndPercent() {
        val delta = SignalDiffTableProjection.deltaOf(JsonPrimitive(40), JsonPrimitive(64))
        delta as SignalDiffDelta.Numeric
        assertEquals(24.0, delta.delta, 0.0)
        assertEquals(DeltaSign.Positive, delta.sign)
        assertEquals("+24.00 (+60.0%)", delta.text)
    }

    @Test
    fun deltaNumericNegativeHasNoLeadingPlus() {
        val delta = SignalDiffTableProjection.deltaOf(JsonPrimitive(64), JsonPrimitive(40))
        delta as SignalDiffDelta.Numeric
        assertEquals(DeltaSign.Negative, delta.sign)
        assertEquals("-24.00 (-37.5%)", delta.text)
    }

    @Test
    fun deltaNumericZeroBaseOmitsPercent() {
        val delta = SignalDiffTableProjection.deltaOf(JsonPrimitive(0), JsonPrimitive(5))
        delta as SignalDiffDelta.Numeric
        assertEquals(DeltaSign.Positive, delta.sign)
        assertEquals("+5.00", delta.text)
    }

    @Test
    fun deltaNumericEqualIsZeroSign() {
        val delta = SignalDiffTableProjection.deltaOf(JsonPrimitive(5), JsonPrimitive(5))
        delta as SignalDiffDelta.Numeric
        assertEquals(DeltaSign.Zero, delta.sign)
        assertEquals("0.00 (+0.0%)", delta.text)
    }

    @Test
    fun deltaEqualNonNumericIsNone() {
        assertEquals(SignalDiffDelta.None, SignalDiffTableProjection.deltaOf(JsonPrimitive("D"), JsonPrimitive("D")))
    }

    @Test
    fun deltaDifferingNonNumericIsChanged() {
        assertEquals(SignalDiffDelta.Changed, SignalDiffTableProjection.deltaOf(JsonPrimitive("P"), JsonPrimitive("D")))
    }

    // ── projectRows / rowFrom ───────────────────────────────────────────────────────────────────────────

    @Test
    fun projectRowsNullResponseIsEmpty() {
        assertTrue(SignalDiffTableProjection.projectRows(null).isEmpty())
    }

    @Test
    fun rowFromFormatsBothWindowsAndCarriesSources() {
        val row =
            io.teslasync.shared.core.presentation.telemetry.SignalDiffRow(
                name = "VehicleSpeed",
                valueA = JsonPrimitive(40),
                valueB = JsonPrimitive(64),
                sourceA = "l1",
                sourceB = "l2",
                ageMsA = 1_200L,
                ageMsB = 800L,
                changed = true,
            )
        val vm = SignalDiffTableProjection.rowFrom(row)
        assertEquals("VehicleSpeed", vm.name)
        assertEquals("40.00", vm.valueA)
        assertEquals("64.00", vm.valueB)
        assertEquals("l1", vm.sourceA)
        assertEquals(800L, vm.ageMsB)
        assertTrue(vm.delta is SignalDiffDelta.Numeric)
    }

    // ── filterRows (web parent filter) ──────────────────────────────────────────────────────────────────

    @Test
    fun filterBlankReturnsEveryRow() {
        val rows = listOf(row("Speed"), row("Gear"))
        assertEquals(rows, SignalDiffTableProjection.filterRows(rows, "   "))
    }

    @Test
    fun filterIsCaseInsensitiveSubstring() {
        val rows = listOf(row("VehicleSpeed"), row("Gear"), row("BatteryLevel"))
        assertEquals(listOf("VehicleSpeed"), SignalDiffTableProjection.filterRows(rows, "speed").map { it.name })
    }

    @Test
    fun filterNoMatchIsEmpty() {
        val rows = listOf(row("Speed"), row("Gear"))
        assertTrue(SignalDiffTableProjection.filterRows(rows, "zzz").isEmpty())
    }

    // ── sortRows (web pinned-first + sortable columns) ──────────────────────────────────────────────────

    @Test
    fun sortKeepsPinnedFirstThenNameAscending() {
        val rows = listOf(row("Charlie"), row("Alpha"), row("Bravo"))
        val sorted = SignalDiffTableProjection.sortRows(rows, setOf("Charlie"), SortState(COL_NAME, SortDirection.Asc))
        assertEquals(listOf("Charlie", "Alpha", "Bravo"), sorted.map { it.name })
    }

    @Test
    fun sortNameDescendingWithinUnpinnedGroup() {
        val rows = listOf(row("Charlie"), row("Alpha"), row("Bravo"))
        val sorted = SignalDiffTableProjection.sortRows(rows, emptySet(), SortState(COL_NAME, SortDirection.Desc))
        assertEquals(listOf("Charlie", "Bravo", "Alpha"), sorted.map { it.name })
    }

    @Test
    fun sortByDeltaUsesSignedMagnitude() {
        val rows =
            listOf(
                row("A", delta = SignalDiffDelta.Numeric(10.0, DeltaSign.Positive, "+10.00")),
                row("B", delta = SignalDiffDelta.Numeric(-5.0, DeltaSign.Negative, "-5.00")),
                row("C", delta = SignalDiffDelta.None),
            )
        val asc = SignalDiffTableProjection.sortRows(rows, emptySet(), SortState(COL_DELTA, SortDirection.Asc))
        assertEquals(listOf("B", "C", "A"), asc.map { it.name })
    }

    // ── queryErrorKindOf (web classifyQueryError) ───────────────────────────────────────────────────────

    @Test
    fun queryErrorKindFromHttpStatus() {
        assertEquals(QueryErrorKind.NotFound, SignalDiffTableProjection.queryErrorKindOf(ApiError.Http(404)))
        assertEquals(QueryErrorKind.Unauthorized, SignalDiffTableProjection.queryErrorKindOf(ApiError.Http(401)))
        assertEquals(QueryErrorKind.Unauthorized, SignalDiffTableProjection.queryErrorKindOf(ApiError.Http(403)))
        assertEquals(QueryErrorKind.ServerError, SignalDiffTableProjection.queryErrorKindOf(ApiError.Http(503)))
        assertEquals(QueryErrorKind.Network, SignalDiffTableProjection.queryErrorKindOf(ApiError.Http(400)))
    }

    @Test
    fun queryErrorKindFromTransport() {
        assertEquals(QueryErrorKind.Network, SignalDiffTableProjection.queryErrorKindOf(ApiError.Network()))
        assertEquals(QueryErrorKind.Network, SignalDiffTableProjection.queryErrorKindOf(ApiError.Timeout()))
        assertEquals(QueryErrorKind.Waiting, SignalDiffTableProjection.queryErrorKindOf(ApiError.CircuitOpen()))
        assertEquals(QueryErrorKind.Network, SignalDiffTableProjection.queryErrorKindOf(null))
    }

    // ── formatNumber (web fmtNumber default) ────────────────────────────────────────────────────────────

    @Test
    fun formatNumberGroupsAndFixesFractionDigits() {
        assertEquals("1,234.50", formatNumber(1234.5))
        assertEquals("60.0", formatNumber(60.0, PERCENT_DECIMALS))
        assertEquals(EM_DASH, formatNumber(Double.NaN))
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordSignalDiffTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SignalDiffTable"), opened.single().second)
    }

    private fun row(
        name: String,
        delta: SignalDiffDelta = SignalDiffDelta.None,
    ): SignalDiffRowVm =
        SignalDiffRowVm(
            name = name,
            valueA = "a",
            valueB = "b",
            delta = delta,
            sourceA = null,
            sourceB = null,
            ageMsA = null,
            ageMsB = null,
        )
}
