// Off-device unit coverage for the Battery analytics feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-key tests). Exercises the `battery_trend` parser (snake_case, camelCase dual-shape, null
// tolerance, missing/empty document — the web `data?.battery_trend ?? []` analogue), the SI -> display
// projection (the latest-point metric cards + chart series + accessible tables), the `safe`/date-slice
// helpers, the lifecycle classifier the composable switches on (per-state coverage), the web-parity
// state builder, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterytab

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class BatteryTabModelTest {
    private val metric = UnitFormatter.default()
    private val imperial = UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi"}""")))

    private val twoRows =
        """
        {"battery_trend":[
          {"date":"2026-03-01","health_score":98.0,"capacity_wh":74000,"degradation_pct":1.5,"range_km":470,"cycle_count":150},
          {"date":"2026-04-01","health_score":97.5,"capacity_wh":73000,"degradation_pct":2.25,"range_km":455,"cycle_count":168}
        ]}
        """.trimIndent()

    private fun parse(json: String) = BatteryTrend.parse(Json.parseToJsonElement(json))

    // ── Parser (web `data?.battery_trend ?? []`) ────────────────────────────────

    @Test
    fun parsesSnakeCaseTrendRowsInOrder() {
        val trend = parse(twoRows)
        assertEquals(2, trend.size)
        assertEquals(
            BatteryTrendPoint("2026-03-01", 98.0, 74000.0, 1.5, 470.0, 150.0),
            trend.first(),
        )
        assertEquals("2026-04-01", trend.last().date)
        assertEquals(168.0, trend.last().cycleCount)
    }

    @Test
    fun parsesCamelCaseDualShape() {
        val trend =
            parse(
                """
                {"batteryTrend":[
                  {"date":"2026-05-01","healthScore":95.0,"capacityWh":72000,"degradationPct":3.1,"rangeKm":450,"cycleCount":180}
                ]}
                """.trimIndent(),
            )
        assertEquals(1, trend.size)
        assertEquals(BatteryTrendPoint("2026-05-01", 95.0, 72000.0, 3.1, 450.0, 180.0), trend.first())
    }

    @Test
    fun parserToleratesMissingNullAndPartialRows() {
        assertTrue(BatteryTrend.parse(null).isEmpty())
        assertTrue(parse("""{"total_vehicles":3}""").isEmpty())
        assertTrue(parse("""{"battery_trend":null}""").isEmpty())
        assertTrue(parse("""[1,2,3]""").isEmpty())
        val partial = parse("""{"battery_trend":[{"date":"2026-04-01"}]}""")
        assertEquals(1, partial.size)
        assertEquals(BatteryTrendPoint("2026-04-01", null, null, null, null, null), partial.first())
    }

    // ── Helpers (web `safe` + `v.slice(5)`) ─────────────────────────────────────

    @Test
    fun safeValueCoercesNullAndNonFiniteToZero() {
        assertEquals(12.5, safeValue(12.5), 0.0)
        assertEquals(0.0, safeValue(null), 0.0)
        assertEquals(0.0, safeValue(Double.NaN), 0.0)
        assertEquals(0.0, safeValue(Double.POSITIVE_INFINITY), 0.0)
    }

    @Test
    fun sliceDateLabelDropsTheYearPrefix() {
        assertEquals("04-01", sliceDateLabel("2026-04-01"))
        assertEquals("abc", sliceDateLabel("abc"))
    }

    // ── Projection: metric cards (web `latest` + `fmtNumber`/`fmtInt`/`formatEnergy`) ─────

    @Test
    fun projectsLatestPointMetricCardsInMetricUnits() {
        val display = BatteryTabProjection.project(parse(twoRows), metric, Locale.US)
        assertFalse(display.isEmpty)
        assertEquals("97.5", display.healthScoreValue)
        assertEquals("73.0 kWh", display.capacityValue)
        assertEquals("2.25", display.degradationValue)
        assertEquals("455", display.estRangeValue)
        assertEquals("168", display.cyclesValue)
        assertEquals("km", display.distanceUnit)
    }

    @Test
    fun projectsRangeCardAndUnitThroughTheImperialUnitsBoundary() {
        val display = BatteryTabProjection.project(parse(twoRows), imperial, Locale.US)
        // 455 km -> 282.7 mi, rounded to whole miles (web `fmtNumber(fromKm(range_km), 0)`).
        assertEquals("283", display.estRangeValue)
        assertEquals("mi", display.distanceUnit)
        assertEquals(282.7, display.rangeValues.last()!!, 0.1)
    }

    @Test
    fun missingLatestFieldsRenderAsZeroNotEmDash() {
        val display = BatteryTabProjection.project(parse("""{"battery_trend":[{"date":"2026-04-01"}]}"""), metric, Locale.US)
        assertEquals("0.0", display.healthScoreValue)
        assertEquals("0.0 kWh", display.capacityValue)
        assertEquals("0.00", display.degradationValue)
        assertEquals("0", display.estRangeValue)
        assertEquals("0", display.cyclesValue)
    }

    // ── Projection: chart series + x labels + accessible tables ──────────────────

    @Test
    fun projectsChartSeriesAndAxisLabelsInSourceOrder() {
        val display = BatteryTabProjection.project(parse(twoRows), metric, Locale.US)
        assertEquals(listOf("03-01", "04-01"), display.xLabels)
        assertEquals(listOf(98.0, 97.5), display.healthValues)
        assertEquals(listOf(74000.0, 73000.0), display.capacityValues)
        assertEquals(listOf(470.0, 455.0), display.rangeValues)
        assertEquals(listOf(1.5, 2.25), display.degradationValues)
        assertEquals(listOf(150.0, 168.0), display.cycleValues)
    }

    @Test
    fun projectsAccessibleDataTablesForEveryChart() {
        val display = BatteryTabProjection.project(parse(twoRows), metric, Locale.US)
        assertEquals(listOf("2026-03-01", "98.0"), display.healthTable.first())
        assertEquals(listOf("2026-04-01", "73.0 kWh"), display.capacityTable.last())
        assertEquals(listOf("2026-03-01", "470"), display.rangeTable.first())
        assertEquals(listOf("2026-04-01", "2.25", "168"), display.degradationCyclesTable.last())
    }

    @Test
    fun emptyTrendProjectsEmptyDisplayWithEmDashCards() {
        val display = BatteryTabProjection.project(emptyList(), metric, Locale.US)
        assertTrue(display.isEmpty)
        assertEquals(BATTERY_EM_DASH, display.healthScoreValue)
        assertEquals(BATTERY_EM_DASH, display.capacityValue)
        assertTrue(display.xLabels.isEmpty())
        assertTrue(display.healthValues.isEmpty())
    }

    @Test
    fun nullChartSamplesStayNullForGapDrawing() {
        val display = BatteryTabProjection.project(parse("""{"battery_trend":[{"date":"2026-04-01"}]}"""), metric, Locale.US)
        assertEquals(listOf<Double?>(null), display.healthValues)
        assertEquals(listOf<Double?>(null), display.rangeValues)
        assertEquals(listOf("2026-04-01", BATTERY_EM_DASH), display.healthTable.first())
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(BatteryTabSurface.Loading, batteryTabSurface(UiState.loading<List<BatteryTrendPoint>>()))
        assertEquals(
            BatteryTabSurface.Error,
            batteryTabSurface(UiState<List<BatteryTrendPoint>>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(BatteryTabSurface.Empty, batteryTabSurface(UiState(UiPhase.Empty, data = emptyList<BatteryTrendPoint>())))
        assertEquals(BatteryTabSurface.Content, batteryTabSurface(UiState(UiPhase.Content, data = parse(twoRows))))
    }

    @Test
    fun offlineCachedStateStaysContentAndIsFlaggedStale() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = parse(twoRows),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertEquals(BatteryTabSurface.Content, batteryTabSurface(offline))
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
    }

    // ── Web-parity state builder (web `data` + `isLoading` props) ────────────────

    @Test
    fun stateBuilderClassifiesLoadingEmptyAndContent() {
        assertEquals(UiPhase.Loading, batteryTabStateOf(null, loading = true).phase)
        assertEquals(UiPhase.Empty, batteryTabStateOf(null, loading = false).phase)
        val content = batteryTabStateOf(Json.parseToJsonElement(twoRows), loading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(2, content.data?.size)
        // Cache-then-network: data present while a refresh is in flight stays Content, not Loading.
        assertEquals(UiPhase.Content, batteryTabStateOf(Json.parseToJsonElement(twoRows), loading = true).phase)
    }

    // ── Diagnostics (P1/S11 `view.opened`) + registry ────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordBatteryTabOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "BatteryTab"), record.fields)
    }

    @Test
    fun registrationSlugAndPercentConstantMatchTheSurfaceContract() {
        assertEquals("BatteryTab", BatteryTabRegistration.SLUG)
        assertEquals("battery-tab", BatteryTabRegistration.ID)
        assertEquals("%", BATTERY_PERCENT)
        assertNull(emptyList<BatteryTrendPoint>().lastOrNull())
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
