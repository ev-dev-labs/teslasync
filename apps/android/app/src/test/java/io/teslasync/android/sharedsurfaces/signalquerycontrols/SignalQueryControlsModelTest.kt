package io.teslasync.android.sharedsurfaces.signalquerycontrols

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryPoint
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Off-device unit coverage of the pure SignalQueryControls model — the typed `{ts, kind, value}` → legacy
 * `SignalLogEntry` adapter that motivated the web helper, the value-type discriminator + formatter, the
 * `datetime-local` parse/format + preset matcher, the selection algebra, and the cache-then-network projection
 * that drives the loading / content / empty / error / stale / offline matrix. Runs in `:app:testReleaseUnitTest`.
 */
class SignalQueryControlsModelTest {
    // ── BE → FE adapter ──

    @Test
    fun adapterProjectsANumericPointToValueNum() {
        val entry = adaptSignalHistoryPoint(point(JsonPrimitive(64.0)), "VehicleSpeed")
        assertEquals("VehicleSpeed", entry.signal)
        assertEquals(64.0, entry.valueNum!!, 0.0)
        assertNull(entry.valueStr)
        assertNull(entry.valueBool)
        assertEquals(SignalValueType.Num, entry.valueType())
        assertEquals("64", entry.formatValue())
    }

    @Test
    fun adapterProjectsAStringPointToValueStr() {
        val entry = adaptSignalHistoryPoint(point(JsonPrimitive("Charging")), "ChargeState")
        assertEquals("Charging", entry.valueStr)
        assertEquals(SignalValueType.Str, entry.valueType())
        assertEquals("Charging", entry.formatValue())
    }

    @Test
    fun adapterProjectsABooleanPointToValueBool() {
        val entry = adaptSignalHistoryPoint(point(JsonPrimitive(true)), "Locked")
        assertEquals(true, entry.valueBool)
        assertEquals(SignalValueType.Bool, entry.valueType())
        assertEquals("true", entry.formatValue())
    }

    @Test
    fun adapterLeavesAllValuesNullForAJsonNullOrAbsentValue() {
        val nulled = adaptSignalHistoryPoint(point(JsonNull), "X")
        val absent = adaptSignalHistoryPoint(SignalHistoryPoint(ts = "2026-01-01T00:00:00Z", kind = "k", value = null), "X")
        for (entry in listOf(nulled, absent)) {
            assertNull(entry.valueNum)
            assertNull(entry.valueStr)
            assertNull(entry.valueBool)
            assertEquals(SignalValueType.Null, entry.valueType())
            assertEquals("\u2014", entry.formatValue())
        }
    }

    @Test
    fun adaptRespMapsEveryRowAndCarriesTheSignalName() {
        val response =
            SignalHistoryResponse(
                signal = "VehicleSpeed",
                data = listOf(point(JsonPrimitive(1.0)), point(JsonPrimitive(2.0))),
            )
        val rows = adaptSignalHistoryResp(response)
        assertEquals(2, rows.size)
        assertTrue(rows.all { it.signal == "VehicleSpeed" })
        assertEquals(listOf(1.0, 2.0), rows.map { it.valueNum })
    }

    @Test
    fun adaptRespOfNullIsEmpty() {
        assertEquals(emptyList<SignalLogEntry>(), adaptSignalHistoryResp(null))
    }

    @Test
    fun typeTokenAndBadgeVariantMatchTheWebMaps() {
        assertEquals("num", typeToken(SignalValueType.Num))
        assertEquals("str", typeToken(SignalValueType.Str))
        assertEquals("bool", typeToken(SignalValueType.Bool))
        assertEquals("null", typeToken(SignalValueType.Null))
    }

    // ── datetime-local + presets ──

    @Test
    fun datetimeRoundTripsThroughSecondsPrecision() {
        val moment = LocalDateTime.of(2026, 1, 2, 3, 4, 5)
        val text = SignalQueryTime.toLocalDatetimeStr(moment)
        assertEquals("2026-01-02T03:04:05", text)
        assertEquals(moment, SignalQueryTime.parseLocalDatetime(text))
    }

    @Test
    fun parseAcceptsMinutePrecisionAndRejectsGarbage() {
        assertEquals(LocalDateTime.of(2026, 1, 2, 3, 4, 0), SignalQueryTime.parseLocalDatetime("2026-01-02T03:04"))
        assertNull(SignalQueryTime.parseLocalDatetime("not-a-date"))
        assertNull(SignalQueryTime.parseLocalDatetime(""))
    }

    @Test
    fun presetRangeProducesAMatchableWindow() {
        val now = LocalDateTime.of(2026, 1, 1, 12, 0, 0)
        for (preset in TIME_RANGE_PRESETS) {
            val (from, to) = SignalQueryTime.presetRange(preset.hours, now)
            assertEquals(preset.hours, SignalQueryTime.matchTimeRangePreset(from, to))
        }
    }

    @Test
    fun matchReturnsNullForANonPresetSpanOrBlankInput() {
        val now = LocalDateTime.of(2026, 1, 1, 12, 0, 0)
        val from = SignalQueryTime.toLocalDatetimeStr(now.minusHours(2))
        val to = SignalQueryTime.toLocalDatetimeStr(now)
        assertNull(SignalQueryTime.matchTimeRangePreset(from, to))
        assertNull(SignalQueryTime.matchTimeRangePreset("", to))
    }

    @Test
    fun formatTimestampMsRendersMillisAndFallsBackToDash() {
        val stamp = SignalQueryTime.formatTimestampMs("2026-01-01T10:00:00Z", ZoneOffset.UTC)
        assertEquals("2026-01-01 10:00:00.000", stamp)
        assertEquals("\u2014", SignalQueryTime.formatTimestampMs("Invalid Date", ZoneOffset.UTC))
    }

    // ── selection algebra ──

    @Test
    fun toggleAddsRemovesAndRespectsTheCap() {
        assertEquals(listOf("a", "b"), toggleSignal(listOf("a"), "b", max = null))
        assertEquals(listOf("a"), toggleSignal(listOf("a", "b"), "b", max = null))
        assertEquals(listOf("a", "b"), toggleSignal(listOf("a", "b"), "c", max = 2))
        assertTrue(atSignalCap(listOf("a", "b"), max = 2))
    }

    // ── projection ──

    @Test
    fun projectResolvesEveryFeedPhase() {
        assertEquals(SignalPickerPhase.Loading, SignalQueryControlsProjection.project(UiState.loading()).phase)
        assertEquals(
            SignalPickerPhase.Empty,
            SignalQueryControlsProjection.project(UiState(UiPhase.Empty, data = emptyList())).phase,
        )
        val content = SignalQueryControlsProjection.project(UiState(UiPhase.Content, data = listOf("VehicleSpeed")))
        assertEquals(SignalPickerPhase.Content, content.phase)
        assertEquals(listOf("VehicleSpeed"), content.names)
        assertEquals(
            SignalPickerPhase.Error,
            SignalQueryControlsProjection.project(UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500)).phase,
        )
    }

    @Test
    fun projectFlagsStaleAndOfflineDistinctly() {
        val stale = SignalQueryControlsProjection.project(UiState(UiPhase.Content, data = listOf("a"), stale = true))
        assertTrue(stale.stale)
        assertTrue(!stale.offline)

        val offline =
            SignalQueryControlsProjection.project(
                UiState(UiPhase.Content, data = listOf("a"), stale = true, errorKind = ErrorKind.Network),
            )
        assertTrue(offline.offline)
        assertTrue(!offline.stale)
    }

    @Test
    fun queryErrorKindMapsTheRecoveryBuckets() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    @Test
    fun totalPagesCeilDivides() {
        assertEquals(1, totalPages(total = 0, perPage = 25))
        assertEquals(1, totalPages(total = 25, perPage = 25))
        assertEquals(2, totalPages(total = 26, perPage = 25))
        assertEquals(4, totalPages(total = 100, perPage = 25))
    }

    private fun kindFor(
        kind: ErrorKind,
        status: Int?,
    ): QueryErrorKind =
        SignalQueryControlsProjection.queryErrorKind(
            SignalPickerDisplay(phase = SignalPickerPhase.Error, errorKind = kind, httpStatus = status),
        )

    private fun point(value: kotlinx.serialization.json.JsonElement) =
        SignalHistoryPoint(ts = "2026-01-01T10:00:00Z", kind = "kind", value = value)
}
