package io.teslasync.android.featureviews.livesignalstable

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
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
 * Off-device verification of the LiveSignalsTable pure projection — the native port of the web component's
 * `rowFromEntry` + `renderValue` field reads, the `Date.parse` timestamp coercion, the name/timestamp sort
 * comparator, the case-insensitive name filter, the relative "Last update" label, the `QueryError`
 * classification, and the PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx).
 */
class LiveSignalsTableProjectionTest {
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

    // ── renderValue (web renderValue) ─────────────────────────────────────────────────────────────────

    @Test
    fun renderValueAbsentIsEmDash() {
        assertEquals(EM_DASH, LiveSignalsTableProjection.renderValue(null))
    }

    @Test
    fun renderValueJsonNullIsNullLiteral() {
        assertEquals("null", LiveSignalsTableProjection.renderValue(JsonNull))
    }

    @Test
    fun renderValueStringIsRawContent() {
        assertEquals("Drive", LiveSignalsTableProjection.renderValue(JsonPrimitive("Drive")))
    }

    @Test
    fun renderValueNumberAndBooleanAreLiterals() {
        assertEquals("42", LiveSignalsTableProjection.renderValue(JsonPrimitive(42)))
        assertEquals("42.5", LiveSignalsTableProjection.renderValue(JsonPrimitive(42.5)))
        assertEquals("true", LiveSignalsTableProjection.renderValue(JsonPrimitive(true)))
    }

    @Test
    fun renderValueCompoundIsCompactJson() {
        val obj =
            buildJsonObject {
                put("lat", 1.5)
                put("lon", 2.0)
            }
        assertEquals("{\"lat\":1.5,\"lon\":2.0}", LiveSignalsTableProjection.renderValue(obj))
        val arr =
            buildJsonArray {
                add(JsonPrimitive(1))
                add(JsonPrimitive(2))
            }
        assertEquals("[1,2]", LiveSignalsTableProjection.renderValue(arr))
    }

    // ── rowFromEntry (web rowFromEntry) ───────────────────────────────────────────────────────────────

    @Test
    fun rowFromEntryUnwrapsEnvelope() {
        val raw =
            buildJsonObject {
                put("value", 64)
                put("timestamp", "2026-06-11T12:00:00Z")
            }
        val row = LiveSignalsTableProjection.rowFromEntry("VehicleSpeed", raw)
        assertEquals("VehicleSpeed", row.name)
        assertEquals("64", row.value)
        assertEquals(LiveSignalsTableProjection.parseTimestampMillis("2026-06-11T12:00:00Z"), row.timestampMillis)
    }

    @Test
    fun rowFromEntryBareScalarHasNoTimestamp() {
        val row = LiveSignalsTableProjection.rowFromEntry("Gear", JsonPrimitive("D"))
        assertEquals("D", row.value)
        assertNull(row.timestampMillis)
    }

    @Test
    fun rowFromEntryObjectWithoutValueKeyIsStringified() {
        // A compound without a `value` key is not an envelope — the whole object becomes the rendered value.
        val raw =
            buildJsonObject {
                put("lat", 1.0)
                put("lon", 2.0)
            }
        val row = LiveSignalsTableProjection.rowFromEntry("Location", raw)
        assertEquals("{\"lat\":1.0,\"lon\":2.0}", row.value)
        assertNull(row.timestampMillis)
    }

    @Test
    fun rowFromEntryEnvelopeWithNullValueRendersNullLiteral() {
        val raw =
            buildJsonObject {
                put("value", JsonNull)
                put("timestamp", "2026-06-11T12:00:00Z")
            }
        val row = LiveSignalsTableProjection.rowFromEntry("Maybe", raw)
        assertEquals("null", row.value)
    }

    @Test
    fun projectRowsMapsEverySignalInOrder() {
        val response =
            VehicleLiveSignalsResponse(
                vehicleId = 1L,
                signals =
                    linkedMapOf(
                        "Beta" to JsonPrimitive("b"),
                        "Alpha" to JsonPrimitive("a"),
                    ),
            )
        val rows = LiveSignalsTableProjection.projectRows(response)
        assertEquals(listOf("Beta", "Alpha"), rows.map { it.name })
    }

    @Test
    fun projectRowsNullResponseIsEmpty() {
        assertTrue(LiveSignalsTableProjection.projectRows(null).isEmpty())
    }

    // ── parseTimestampMillis (web Date.parse) ───────────────────────────────────────────────────────────

    @Test
    fun parseTimestampMillisValidIso() {
        assertEquals(1_000L, LiveSignalsTableProjection.parseTimestampMillis("1970-01-01T00:00:01Z"))
        assertEquals(
            java.time.Instant
                .parse("2026-06-11T12:00:00Z")
                .toEpochMilli(),
            LiveSignalsTableProjection.parseTimestampMillis("2026-06-11T12:00:00Z"),
        )
    }

    @Test
    fun parseTimestampMillisBlankOrUnparseableIsNull() {
        assertNull(LiveSignalsTableProjection.parseTimestampMillis(null))
        assertNull(LiveSignalsTableProjection.parseTimestampMillis("   "))
        assertNull(LiveSignalsTableProjection.parseTimestampMillis("not-a-date"))
    }

    // ── filterRows (web filtered) ─────────────────────────────────────────────────────────────────────

    @Test
    fun filterBlankReturnsEveryRow() {
        val rows = listOf(row("Speed"), row("Gear"))
        assertEquals(rows, LiveSignalsTableProjection.filterRows(rows, "   "))
    }

    @Test
    fun filterIsCaseInsensitiveSubstring() {
        val rows = listOf(row("VehicleSpeed"), row("Gear"), row("BatteryLevel"))
        val filtered = LiveSignalsTableProjection.filterRows(rows, "e")
        assertEquals(listOf("VehicleSpeed", "Gear", "BatteryLevel"), filtered.map { it.name })
        assertEquals(listOf("VehicleSpeed"), LiveSignalsTableProjection.filterRows(rows, "speed").map { it.name })
    }

    @Test
    fun filterNoMatchIsEmpty() {
        val rows = listOf(row("Speed"), row("Gear"))
        assertTrue(LiveSignalsTableProjection.filterRows(rows, "zzz").isEmpty())
    }

    // ── sortRows (web useSortToggle comparator) ─────────────────────────────────────────────────────────

    @Test
    fun sortByNameAscendingAndDescending() {
        val rows = listOf(row("Charlie"), row("alpha"), row("Bravo"))
        val asc = LiveSignalsTableProjection.sortRows(rows, SortState(COL_NAME, SortDirection.Asc))
        assertEquals(listOf("Bravo", "Charlie", "alpha"), asc.map { it.name })
        val desc = LiveSignalsTableProjection.sortRows(rows, SortState(COL_NAME, SortDirection.Desc))
        assertEquals(listOf("alpha", "Charlie", "Bravo"), desc.map { it.name })
    }

    @Test
    fun sortByTimestampTreatsMissingAsZero() {
        val rows =
            listOf(
                row("A", millis = 300L),
                row("B", millis = null),
                row("C", millis = 100L),
            )
        val asc = LiveSignalsTableProjection.sortRows(rows, SortState(COL_TIMESTAMP, SortDirection.Asc))
        assertEquals(listOf("B", "C", "A"), asc.map { it.name })
        val desc = LiveSignalsTableProjection.sortRows(rows, SortState(COL_TIMESTAMP, SortDirection.Desc))
        assertEquals(listOf("A", "C", "B"), desc.map { it.name })
    }

    @Test
    fun sortByUnknownKeyLeavesOrderUntouched() {
        val rows = listOf(row("B"), row("A"))
        assertEquals(rows, LiveSignalsTableProjection.sortRows(rows, SortState(COL_VALUE, SortDirection.Asc)))
    }

    // ── relativeTimestampLabel (web TimeStamp relative) ─────────────────────────────────────────────────

    @Test
    fun relativeLabelNullWhenNoTimestamp() {
        assertNull(LiveSignalsTableProjection.relativeTimestampLabel(null, 10_000L))
    }

    @Test
    fun relativeLabelBucketsAge() {
        val now = 1_000_000_000L
        assertEquals("just now", LiveSignalsTableProjection.relativeTimestampLabel(now - 5_000L, now))
        assertEquals("2m ago", LiveSignalsTableProjection.relativeTimestampLabel(now - 120_000L, now))
    }

    // ── queryErrorKindOf (web classifyQueryError) ───────────────────────────────────────────────────────

    @Test
    fun queryErrorKindFromHttpStatus() {
        assertEquals(QueryErrorKind.NotFound, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Http(404)))
        assertEquals(QueryErrorKind.Unauthorized, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Http(401)))
        assertEquals(QueryErrorKind.Unauthorized, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Http(403)))
        assertEquals(QueryErrorKind.ServerError, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Http(503)))
        assertEquals(QueryErrorKind.Network, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Http(400)))
    }

    @Test
    fun queryErrorKindFromTransport() {
        assertEquals(QueryErrorKind.Network, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Network()))
        assertEquals(QueryErrorKind.Network, LiveSignalsTableProjection.queryErrorKindOf(ApiError.Timeout()))
        assertEquals(QueryErrorKind.Waiting, LiveSignalsTableProjection.queryErrorKindOf(ApiError.CircuitOpen()))
        assertEquals(QueryErrorKind.Network, LiveSignalsTableProjection.queryErrorKindOf(null))
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordLiveSignalsTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "LiveSignalsTable"), opened.single().second)
    }

    private fun row(
        name: String,
        millis: Long? = null,
    ): LiveSignalRow = LiveSignalRow(name = name, value = "v", timestampMillis = millis)
}
