package io.teslasync.android.telemetry.signallogviewer

import io.teslasync.android.data.UiPhase
import io.teslasync.android.featureviews.signalhistorytable.SignalLogEntry
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryPoint
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Off-device verification of the SignalLogViewerPage pure model — the native port of the web page's
 * `adaptSignalHistoryResp` BE→FE adapter, the `new Date(...).toISOString()` query window, the deferred-query
 * lifecycle, the local-pagination slice, and the newest-first merge
 * (web/src/features/telemetry/pages/SignalLogViewerPage.tsx + web/src/components/SignalQueryControls.tsx). Pure
 * functions only, so the page's interaction logic is exercised without a UI host.
 */
class SignalLogViewerPageModelTest {
    private val today: LocalDate = LocalDate.of(2026, 6, 15)

    private fun point(
        ts: String,
        value: kotlinx.serialization.json.JsonElement?,
    ): SignalHistoryPoint = SignalHistoryPoint(ts = ts, kind = "", value = value)

    // ── adaptSignalHistory (web adaptSignalHistoryResp / adaptSignalHistoryPoint) ─────────────────────

    @Test
    fun adaptSteersEachJsonPrimitiveIntoTheRightUnion() {
        val response =
            SignalHistoryResponse(
                signal = "VehicleSpeed",
                data =
                    listOf(
                        point("2026-06-15T10:00:00Z", JsonPrimitive(64.0)),
                        point("2026-06-15T10:00:01Z", JsonPrimitive(42)),
                        point("2026-06-15T10:00:02Z", JsonPrimitive("Charging")),
                        point("2026-06-15T10:00:03Z", JsonPrimitive(true)),
                        point("2026-06-15T10:00:04Z", JsonNull),
                    ),
            )

        val rows = adaptSignalHistory(response)

        assertEquals(5, rows.size)
        rows.forEach { assertEquals("VehicleSpeed", it.signal) }
        assertEquals(64.0, rows[0].valueNum!!, 0.0)
        assertEquals(42.0, rows[1].valueNum!!, 0.0)
        assertEquals("Charging", rows[2].valueStr)
        assertEquals(true, rows[3].valueBool)
        // A null value yields a genuinely empty row (the web em-dash case): all three slots null.
        assertNull(rows[4].valueNum)
        assertNull(rows[4].valueStr)
        assertNull(rows[4].valueBool)
    }

    // ── signalLogIsoRange (web new Date(`${d}T00:00:00`).toISOString()) ───────────────────────────────

    @Test
    fun isoRangeSpansLocalMidnightToEndOfDayAsUtcInstants() {
        val (from, to) = signalLogIsoRange(today, today, ZoneOffset.UTC)
        assertEquals("2026-06-15T00:00:00Z", from)
        assertEquals("2026-06-15T23:59:59.999Z", to)
    }

    // ── projectResults (web loading/empty/content + the deferred-query error tier) ────────────────────

    @Test
    fun projectNotQueriedIsEmpty() {
        val state = projectResults(SignalLogQueryPhase.NotQueried, selectedSignals = emptyList(), page = 1, perPage = 50)
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun projectLoadingIsLoading() {
        val state = projectResults(SignalLogQueryPhase.Loading, selectedSignals = listOf("a"), page = 1, perPage = 50)
        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun projectFailedIsErrorWithClassifiedKind() {
        val phase = SignalLogQueryPhase.Failed(ApiError.Network("boom"))
        val state = projectResults(phase, selectedSignals = listOf("a"), page = 1, perPage = 50)
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
    }

    @Test
    fun projectLoadedSlicesTheBatchLocallyAndKeepsTheUnpagedTotal() {
        val rows = (1..5).map { SignalLogEntry(createdAt = "2026-06-15T10:00:0${it}Z", signal = "s$it") }
        val page1 = projectResults(SignalLogQueryPhase.Loaded(rows), selectedSignals = listOf("s1"), page = 1, perPage = 2)
        val page1Data = page1.data!!
        assertEquals(UiPhase.Content, page1.phase)
        assertEquals(2, page1Data.rows.size)
        assertEquals(5, page1Data.totalRows)
        assertEquals("s1", page1Data.rows.first().signal)

        val page3 = projectResults(SignalLogQueryPhase.Loaded(rows), selectedSignals = listOf("s1"), page = 3, perPage = 2)
        val page3Data = page3.data!!
        assertEquals(1, page3Data.rows.size)
        assertEquals("s5", page3Data.rows.first().signal)
    }

    @Test
    fun projectLoadedEmptyBatchIsEmpty() {
        val state = projectResults(SignalLogQueryPhase.Loaded(emptyList()), selectedSignals = listOf("a"), page = 1, perPage = 50)
        assertEquals(UiPhase.Empty, state.phase)
        assertEquals(0, state.data!!.totalRows)
    }

    // ── mergeSignalLogRows (web flatMap + sort newest-first) ──────────────────────────────────────────

    @Test
    fun mergeFlattensAndSortsNewestFirst() {
        val a = listOf(SignalLogEntry("2026-06-15T10:00:00Z", "a"), SignalLogEntry("2026-06-15T12:00:00Z", "a"))
        val b = listOf(SignalLogEntry("2026-06-15T11:00:00Z", "b"))
        val merged = mergeSignalLogRows(listOf(a, b))
        assertEquals(listOf("2026-06-15T12:00:00Z", "2026-06-15T11:00:00Z", "2026-06-15T10:00:00Z"), merged.map { it.createdAt })
    }

    @Test
    fun mergeSortsUnparseableTimestampsLast() {
        val rows = listOf(listOf(SignalLogEntry("not-a-date", "x"), SignalLogEntry("2026-06-15T10:00:00Z", "y")))
        val merged = mergeSignalLogRows(rows)
        assertEquals("2026-06-15T10:00:00Z", merged.first().createdAt)
        assertEquals("not-a-date", merged.last().createdAt)
    }

    // ── error message + initial state ─────────────────────────────────────────────────────────────────

    @Test
    fun errorMessageIsTheFailureDetailOrNull() {
        assertEquals("boom", signalLogErrorMessage(SignalLogQueryPhase.Failed(ApiError.Network("boom"))))
        assertNull(signalLogErrorMessage(SignalLogQueryPhase.NotQueried))
        assertNull(signalLogErrorMessage(SignalLogQueryPhase.Loading))
    }

    @Test
    fun initialControlsAndStateUseTheTodayWindowAndNeverQueried() {
        val controls = SignalLogViewerControls.initial(today)
        assertEquals(today, controls.from)
        assertEquals(today, controls.to)
        assertEquals(SIGNAL_LOG_DEFAULT_PER_PAGE, controls.perPage)
        assertEquals(1, controls.page)
        assertFalse(controls.hasQueried)
        assertTrue(controls.selectedSignals.isEmpty())

        val state = SignalLogViewerUiState.initial(today)
        assertNull(state.vehicleId)
        assertFalse(state.hasVehicle)
        assertFalse(state.canQuery)
        assertEquals(0, state.totalRecords)
        assertNull(state.errorMessage)
    }
}
