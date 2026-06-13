package io.teslasync.android.sharedsurfaces.daterangefilter

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Off-device coverage of the pure DateRangeFilter model — the eleven presets resolved against a fixed local
 * "today" (web `DATE_PRESETS`), the canonical preset match (web `matchPresetId`), the all-time clamp, and the
 * projection of the URL-state read onto the render-ready display across loading / content / empty / error /
 * stale / offline plus the error-bucket mapping, and the PII-safe `view.opened` diagnostic (slug only). No
 * Android, no coroutines — the composable stays a thin render layer over these functions.
 */
class DateRangeFilterModelTest {
    private val today = LocalDate.of(2026, 6, 13)

    @Test
    fun presetsResolveAgainstLocalToday() {
        assertEquals(DatePresetRange("2026-06-13", "2026-06-13"), resolve("today"))
        assertEquals(DatePresetRange("2026-06-12", "2026-06-12"), resolve("yesterday"))
        assertEquals(DatePresetRange("2026-06-07", "2026-06-13"), resolve("7d"))
        assertEquals(DatePresetRange("2026-05-15", "2026-06-13"), resolve("30d"))
        assertEquals(DatePresetRange("2026-06-01", "2026-06-13"), resolve("mtd"))
        assertEquals(DatePresetRange("2026-04-01", "2026-06-13"), resolve("qtd"))
        assertEquals(DatePresetRange("2026-01-01", "2026-06-13"), resolve("ytd"))
        assertEquals(DatePresetRange("2026-05-01", "2026-05-31"), resolve("lastMonth"))
        assertEquals(DatePresetRange("2015-01-01", "2026-06-13"), resolve("all"))
    }

    @Test
    fun rollingWindowOffsetsAreInclusive() {
        // The N-day presets are inclusive of today, so the start is N-1 days back (web `setDate(-(N-1))`).
        assertEquals("2026-06-07", resolve("7d").start)
        assertEquals(today.minusDays(89).toString(), resolve("90d").start)
        assertEquals(today.minusYears(1).toString(), resolve("1y").start)
    }

    @Test
    fun defaultPresetIdsMatchWeb() {
        assertEquals(listOf("today", "7d", "30d", "mtd", "ytd", "all"), DEFAULT_PRESET_IDS)
    }

    @Test
    fun getDatePresetLooksUpById() {
        assertEquals("30d", getDatePreset("30d")?.id)
        assertNull(getDatePreset("does-not-exist"))
    }

    @Test
    fun matchPresetIdReturnsCanonicalId() {
        assertEquals("today", matchPresetId("2026-06-13", "2026-06-13", today))
        assertEquals("7d", matchPresetId("2026-06-07", "2026-06-13", today))
        assertEquals("mtd", matchPresetId("2026-06-01", "2026-06-13", today))
        assertNull(matchPresetId("1999-01-01", "2000-01-01", today))
        assertNull(matchPresetId("", "", today))
    }

    @Test
    fun resolveAllTimeStartClampsToBaseline() {
        assertEquals(ALL_TIME_BASELINE, resolveAllTimeStart(null))
        assertEquals(ALL_TIME_BASELINE, resolveAllTimeStart(""))
        assertEquals("2024-01-01", resolveAllTimeStart("2024-01-01"))
        assertEquals(ALL_TIME_BASELINE, resolveAllTimeStart("2010-01-01"))
    }

    @Test
    fun projectLoadingHasNoSelection() {
        val display = DateRangeFilterProjection.project(UiState.loading(), today)
        assertEquals(UiPhase.Loading, display.phase)
        assertNull(display.activePresetId)
    }

    @Test
    fun projectContentMatchesActivePreset() {
        val state = UiState(UiPhase.Content, data = DateRangeSelection("2026-06-07", "2026-06-13"), fetchedAt = 1L)
        val display = DateRangeFilterProjection.project(state, today)
        assertEquals(UiPhase.Content, display.phase)
        assertEquals("2026-06-07", display.start)
        assertEquals("2026-06-13", display.end)
        assertEquals("7d", display.activePresetId)
    }

    @Test
    fun projectEmptyWhenUnset() {
        val state = UiState(UiPhase.Empty, data = DateRangeSelection.EMPTY, fetchedAt = 1L)
        val display = DateRangeFilterProjection.project(state, today)
        assertEquals(UiPhase.Empty, display.phase)
        assertEquals(DateRangeFilterRegistration.EMPTY_VALUE, display.displayStart)
        assertEquals(DateRangeFilterRegistration.EMPTY_VALUE, display.displayEnd)
        assertNull(display.activePresetId)
    }

    @Test
    fun projectErrorExposesKindAndNoPreset() {
        val state = UiState<DateRangeSelection>(UiPhase.Error, errorKind = ErrorKind.Network)
        val display = DateRangeFilterProjection.project(state, today)
        assertEquals(UiPhase.Error, display.phase)
        assertEquals(ErrorKind.Network, display.errorKind)
        assertTrue(display.canRetry)
        assertNull(display.activePresetId)
    }

    @Test
    fun projectStaleFlagsStaleNotOffline() {
        val state =
            UiState(UiPhase.Content, data = DateRangeSelection("2026-06-07", "2026-06-13"), fetchedAt = 1L, stale = true)
        val display = DateRangeFilterProjection.project(state, today)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun projectCachedErrorFlagsOfflineNotStale() {
        val state =
            UiState(
                UiPhase.Content,
                data = DateRangeSelection("2026-06-07", "2026-06-13"),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            )
        val display = DateRangeFilterProjection.project(state, today)
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun queryErrorKindMapsRecoveryBuckets() {
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.ServerError, kindFor(null, null))
    }

    @Test
    fun viewOpenedDiagnosticCarriesSlugOnly() {
        val logger = RecordingLogger()
        recordDateRangeFilterOpened(logger)
        val opened = logger.events.single { it.first == EVENT_VIEW_OPENED }
        assertEquals(mapOf(FIELD_SURFACE to DateRangeFilterRegistration.SLUG), opened.second)
    }

    private fun resolve(id: String): DatePresetRange = getDatePreset(id)!!.resolve(today)

    private fun kindFor(
        kind: ErrorKind?,
        status: Int?,
    ): QueryErrorKind =
        DateRangeFilterProjection.queryErrorKind(
            DateRangeFilterDisplay(phase = UiPhase.Error, errorKind = kind, httpStatus = status),
        )

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

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 503
    }
}
