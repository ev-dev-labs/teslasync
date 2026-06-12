package io.teslasync.android.featureviews.frontenderrorscard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the FrontendErrorsCard's pure logic — the native analogue of every derivation
 * the web component performs (web/src/features/system/components/status/FrontendErrorsCard.tsx): the
 * `/admin/web-errors/summary` payload adapter ([WebErrorsSummary.fromJson] / [WebErrorEntry.fromJson]), the
 * `fmtInt(total)` / `fmtInt(entry.count ?? 0)` figures, the `value || '—'` blank fallback, the
 * `top.length > 0` offenders switch, the cache-then-network [Resource] → [io.teslasync.android.data.UiState]
 * mapping ([toWebErrorsSummaryUiState], covering loading / content / empty / error / offline), and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate. Locale.US fixes the
 * grouping/separator so the assertions are deterministic.
 */
class FrontendErrorsCardModelTest {
    private fun entryJson(
        name: String = "ChargingChart",
        route: String = "/charging",
        count: Long = 18,
    ): JsonObject =
        buildJsonObject {
            put("name", name)
            put("route", route)
            put("count", count)
        }

    private fun summaryJson(
        total: Long = 42,
        offenders: Int = 2,
    ): JsonObject =
        buildJsonObject {
            put("total", total)
            put("window_seconds", 3_600)
            putJsonArray("top") {
                if (offenders >= 1) add(entryJson(name = "ChargingChart", route = "/charging", count = 18))
                if (offenders >= 2) add(entryJson(name = "DriveMap", route = "/drives/123", count = 12))
            }
        }

    // ── Data adapter: fromJson (cached payload → typed projection) ───────────────────

    @Test
    fun entryFromJsonParsesEverySnakeCaseFieldThisCardReads() {
        val entry = WebErrorEntry.fromJson(entryJson())

        requireNotNull(entry)
        assertEquals("ChargingChart", entry.name)
        assertEquals("/charging", entry.route)
        assertEquals(18.0, requireNotNull(entry.count), DELTA)
    }

    @Test
    fun entryFromJsonReturnsNullForANonObjectElement() {
        assertNull(WebErrorEntry.fromJson(null))
        assertNull(WebErrorEntry.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun entryFromJsonLeavesBlankNameAndAbsentCountAtTheirDefaults() {
        val sparse = buildJsonObject { put("route", "/x") }

        val entry = WebErrorEntry.fromJson(sparse)

        requireNotNull(entry)
        assertEquals("", entry.name)
        assertEquals("/x", entry.route)
        assertNull(entry.count)
    }

    @Test
    fun summaryFromJsonParsesTheTotalAndEveryTopOffender() {
        val summary = WebErrorsSummary.fromJson(summaryJson())

        requireNotNull(summary)
        assertEquals(42.0, requireNotNull(summary.total), DELTA)
        assertEquals(2, summary.top.size)
        assertEquals("ChargingChart", summary.top.first().name)
        assertTrue(summary.hasOffenders)
        assertFalse(summary.isEmpty)
    }

    @Test
    fun summaryFromJsonReturnsNullForANonObjectPayload() {
        assertNull(WebErrorsSummary.fromJson(null))
        assertNull(WebErrorsSummary.fromJson(JsonPrimitive(7)))
    }

    @Test
    fun summaryFromJsonCollapsesAMissingTopToAnEmptyList() {
        val noTop = buildJsonObject { put("total", 0) }

        val summary = WebErrorsSummary.fromJson(noTop)

        requireNotNull(summary)
        assertEquals(0.0, requireNotNull(summary.total), DELTA)
        assertTrue(summary.top.isEmpty())
        assertTrue(summary.isEmpty)
    }

    @Test
    fun summaryFromJsonDropsNonObjectTopElements() {
        val mixed =
            buildJsonObject {
                put("total", 3)
                putJsonArray("top") {
                    addJsonObject {
                        put("name", "A")
                        put("route", "/a")
                        put("count", 3)
                    }
                    add(JsonPrimitive("garbage"))
                }
            }

        val summary = WebErrorsSummary.fromJson(mixed)

        requireNotNull(summary)
        assertEquals(1, summary.top.size)
        assertEquals("A", summary.top.single().name)
    }

    // ── Projection: total + offender rows ────────────────────────────────────────────

    @Test
    fun projectFormatsTheTotalAndEveryOffenderRow() {
        val display = FrontendErrorsProjection.project(requireNotNull(WebErrorsSummary.fromJson(summaryJson())), Locale.US)

        assertEquals("42", display.totalText)
        assertTrue(display.hasOffenders)
        assertEquals(2, display.rows.size)
        assertEquals("ChargingChart", display.rows.first().name)
        assertEquals("/charging", display.rows.first().route)
        assertEquals("18", display.rows.first().count)
    }

    @Test
    fun projectFallsBackToTheEmDashForBlankNameAndRouteButRendersZeroCount() {
        val blank = WebErrorsSummary(total = 5.0, top = listOf(WebErrorEntry(name = "", route = "", count = null)))

        val row = FrontendErrorsProjection.project(blank, Locale.US).rows.single()

        assertEquals(FRONTEND_ERRORS_EM_DASH, row.name)
        assertEquals(FRONTEND_ERRORS_EM_DASH, row.route)
        // A missing count renders "0" (web `fmtInt(entry.count ?? 0)`), never the em dash.
        assertEquals("0", row.count)
    }

    @Test
    fun projectRendersTheCleanHourAsZeroTotalWithoutOffenders() {
        val display = FrontendErrorsProjection.project(WebErrorsSummary.EMPTY, Locale.US)

        assertEquals("0", display.totalText)
        assertFalse(display.hasOffenders)
        assertTrue(display.rows.isEmpty())
    }

    @Test
    fun formatIntGroupsThousandsAndCoercesNonFiniteToZero() {
        assertEquals("1,234", FrontendErrorsProjection.formatInt(1_234.0, Locale.US))
        assertEquals("0", FrontendErrorsProjection.formatInt(0.0, Locale.US))
        assertEquals("0", FrontendErrorsProjection.formatInt(null, Locale.US))
        assertEquals("0", FrontendErrorsProjection.formatInt(Double.NaN, Locale.US))
        assertEquals("0", FrontendErrorsProjection.formatInt(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun valueOrDashReplacesOnlyTheEmptyString() {
        assertEquals(FRONTEND_ERRORS_EM_DASH, FrontendErrorsProjection.valueOrDash(""))
        assertEquals("/drives", FrontendErrorsProjection.valueOrDash("/drives"))
    }

    // ── Cache-then-network mapping (Resource → UiState) ───────────────────────────────

    @Test
    fun loadingWithNoCacheMapsToTheLoadingPhase() {
        val state =
            Resource
                .Loading<JsonElement>(cached = null, fetchedAt = null, stale = false)
                .toWebErrorsSummaryUiState()

        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun successWithOffendersMapsToContentWithTheParsedPayload() {
        val state = Resource.Success(data = summaryJson(), fetchedAt = 1L, stale = false).toWebErrorsSummaryUiState()
        val summary = requireNotNull(state.data)

        assertTrue(state.isContent)
        assertEquals(42.0, requireNotNull(summary.total), DELTA)
        assertEquals(2, summary.top.size)
    }

    @Test
    fun successWithNoOffendersMapsToTheEmptyPhase() {
        val state =
            Resource
                .Success(data = summaryJson(total = 0, offenders = 0), fetchedAt = 1L, stale = false)
                .toWebErrorsSummaryUiState()

        assertTrue(state.isEmpty)
        assertFalse(requireNotNull(state.data).hasOffenders)
    }

    @Test
    fun errorWithNoCacheMapsToTheErrorPhase() {
        val state =
            Resource
                .Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
                .toWebErrorsSummaryUiState()

        assertTrue(state.isError)
        assertNull(state.data)
    }

    @Test
    fun errorWithCacheKeepsTheLastKnownValueAsOffline() {
        val state =
            Resource
                .Error(
                    cached = summaryJson(),
                    fetchedAt = 1_700_000_000_000L,
                    stale = true,
                    error = RuntimeException("offline"),
                ).toWebErrorsSummaryUiState()

        assertTrue(state.isContent)
        assertTrue(state.stale)
        assertTrue(state.hasError)
        assertTrue(state.isOffline)
        assertEquals(42.0, requireNotNull(state.data?.total), DELTA)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        FrontendErrorsCardDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FrontendErrorsCard"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        const val DELTA: Double = 1e-9
    }
}
