// Off-device unit coverage for the ChargingTab feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the lifecycle classifier the composable switches on (per-state
// coverage), the six summary-tile value formatters (the web `fmtInt` / `fmtNumber` / `formatCurrency` +
// `powerStats ? … : '—'` parity, incl. the `null`-data and present-but-NaN branches), the donut / bar /
// combo chart projections (data + the labels that feed the legend, accessible summary, and fallback
// table — a11y label coverage), the `safe` / rounding helpers, and the PII-safe `view.opened` diagnostic.
// No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtab

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class ChargingTabModelTest {
    private val locale = Locale.US

    private val fullData =
        ChargingTabData(
            totalSessions = 248.0,
            totalEnergyKwh = 4321.6,
            totalCost = 612.49,
            powerAvg = 48.2,
            durationAvg = 41.0,
            efficiencyAvg = 91.4,
            chargerTypes =
                listOf(
                    ChargerTypeSlice("Supercharger", 120.0),
                    ChargerTypeSlice("Home", 80.0),
                ),
            startBatteryDist =
                listOf(
                    StartBatteryBucket("0-20%", 18.0),
                    StartBatteryBucket("20-40%", 64.0),
                ),
            hourlyPattern =
                listOf(
                    HourlyChargePoint(hour = 0, charges = 2.0, energy = 14.8),
                    HourlyChargePoint(hour = 9, charges = 3.0, energy = 22.2),
                ),
        )

    // ── Lifecycle projection (per-state coverage) ────────────────────────────────────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, ChargingTabProjection.projectUiState(fullData, isLoading = true).phase)
        assertEquals(UiPhase.Loading, ChargingTabProjection.projectUiState(null, isLoading = true).phase)

        val content = ChargingTabProjection.projectUiState(fullData, isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(fullData, content.data)

        val empty = ChargingTabProjection.projectUiState(null, isLoading = false)
        assertEquals(UiPhase.Empty, empty.phase)
        assertEquals(null, empty.data)
    }

    // ── Summary tile values (web fmtInt / fmtNumber / formatCurrency + stat fallbacks) ────────────

    @Test
    fun metricValuesFormatEverySixTileInWebSourceOrder() {
        val values = ChargingTabProjection.metricValues(fullData, currencySymbol = "$", locale = locale)
        assertEquals(
            listOf(
                ChargingMetric.Sessions,
                ChargingMetric.TotalEnergy,
                ChargingMetric.TotalCost,
                ChargingMetric.AvgPower,
                ChargingMetric.AvgDuration,
                ChargingMetric.ChargeEfficiency,
            ),
            values.map { it.metric },
        )
        val byMetric = values.associate { it.metric to it.value }
        assertEquals("248", byMetric[ChargingMetric.Sessions])
        assertEquals("4,321.6", byMetric[ChargingMetric.TotalEnergy])
        assertEquals("$612.49", byMetric[ChargingMetric.TotalCost])
        assertEquals("48.2", byMetric[ChargingMetric.AvgPower])
        assertEquals("41", byMetric[ChargingMetric.AvgDuration])
        assertEquals("91.4", byMetric[ChargingMetric.ChargeEfficiency])
    }

    @Test
    fun metricValuesWithNullDataZeroTheTilesAndDashTheStats() {
        val values = ChargingTabProjection.metricValues(null, currencySymbol = "$", locale = locale)
        val byMetric = values.associate { it.metric to it.value }
        // The three plain tiles use the web `safeNumber → 0`.
        assertEquals("0", byMetric[ChargingMetric.Sessions])
        assertEquals("0.0", byMetric[ChargingMetric.TotalEnergy])
        assertEquals("$0.00", byMetric[ChargingMetric.TotalCost])
        // The three stat tiles are absent → the web `'—'`.
        assertEquals(CHARGING_EM_DASH, byMetric[ChargingMetric.AvgPower])
        assertEquals(CHARGING_EM_DASH, byMetric[ChargingMetric.AvgDuration])
        assertEquals(CHARGING_EM_DASH, byMetric[ChargingMetric.ChargeEfficiency])
    }

    @Test
    fun metricValuesHonorTheCurrencySymbol() {
        val values = ChargingTabProjection.metricValues(fullData, currencySymbol = "€", locale = locale)
        assertEquals("€612.49", values.first { it.metric == ChargingMetric.TotalCost }.value)
    }

    @Test
    fun statAverageDistinguishesAbsentFromPresentButNonFinite() {
        // Absent stats object → em dash (web `powerStats ? … : '—'`).
        assertEquals(CHARGING_EM_DASH, ChargingTabProjection.formatStatAvg(null, 1, locale))
        // Present but NaN → `safe(avg)` → 0 (web `fmtNumber(safe(avg), 1)`).
        assertEquals("0.0", ChargingTabProjection.formatStatAvg(Double.NaN, 1, locale))
        assertEquals("0", ChargingTabProjection.formatStatAvg(Double.NEGATIVE_INFINITY, 0, locale))
        assertEquals("48.2", ChargingTabProjection.formatStatAvg(48.2, 1, locale))
    }

    // ── Donut projection (data + legend / a11y / table labels) ───────────────────────────────────

    @Test
    fun donutComputesSharesAndLabels() {
        val model = ChargingTabProjection.donut(fullData, locale)
        assertFalse(model.isEmpty)
        assertEquals(2, model.slices.size)

        val sc = model.slices[0]
        assertEquals("Supercharger", sc.type)
        assertEquals(0.6, sc.fraction, 1e-9)
        assertEquals("120", sc.countLabel)
        assertEquals("60%", sc.percentLabel)

        val home = model.slices[1]
        assertEquals(0.4, home.fraction, 1e-9)
        assertEquals("80", home.countLabel)
        assertEquals("40%", home.percentLabel)
    }

    @Test
    fun donutIsEmptyForNullOrNoTypesAndSafeForZeroTotal() {
        assertTrue(ChargingTabProjection.donut(null, locale).isEmpty)
        assertTrue(
            ChargingTabProjection.donut(fullData.copy(chargerTypes = emptyList()), locale).isEmpty,
        )
        // A zero-total set must not divide by zero — every share is 0 % rather than NaN.
        val zero =
            ChargingTabProjection.donut(
                fullData.copy(
                    chargerTypes = listOf(ChargerTypeSlice("A", 0.0), ChargerTypeSlice("B", 0.0)),
                ),
                locale,
            )
        assertFalse(zero.isEmpty)
        assertTrue(zero.slices.all { it.fraction == 0.0 && it.percentLabel == "0%" })
    }

    // ── Start-battery bar projection ─────────────────────────────────────────────────────────────

    @Test
    fun startBatteryBarsMirrorTheBucketsAndAccessibleTable() {
        val model = ChargingTabProjection.startBatteryBars(fullData, locale)
        assertFalse(model.isEmpty)
        assertEquals(listOf("0-20%", "20-40%"), model.xLabels)
        assertEquals(listOf<Double?>(18.0, 64.0), model.values)
        assertEquals(listOf(listOf("0-20%", "18"), listOf("20-40%", "64")), model.tableRows)
    }

    @Test
    fun startBatteryBarsAreEmptyWithoutData() {
        val model = ChargingTabProjection.startBatteryBars(null, locale)
        assertTrue(model.isEmpty)
        assertTrue(model.xLabels.isEmpty())
        assertTrue(model.values.isEmpty())
        assertTrue(model.tableRows.isEmpty())
    }

    // ── Hourly combo projection ──────────────────────────────────────────────────────────────────

    @Test
    fun hourlyPatternFormatsHoursAndBothSeries() {
        val model = ChargingTabProjection.hourlyPattern(fullData, locale)
        assertFalse(model.isEmpty)
        assertEquals(listOf("0:00", "9:00"), model.xLabels)
        assertEquals(listOf<Double?>(2.0, 3.0), model.charges)
        assertEquals(listOf<Double?>(14.8, 22.2), model.energy)
        assertEquals(
            listOf(listOf("0:00", "2", "14.8"), listOf("9:00", "3", "22.2")),
            model.tableRows,
        )
    }

    @Test
    fun hourlyPatternIsEmptyWithoutData() {
        assertTrue(ChargingTabProjection.hourlyPattern(null, locale).isEmpty)
        assertEquals("0:00", ChargingTabProjection.hourLabel(0))
        assertEquals("23:00", ChargingTabProjection.hourLabel(23))
    }

    // ── Number helpers (web safe / fmtNumber rounding parity) ────────────────────────────────────

    @Test
    fun safeNumberMatchesTheWebFiniteGuard() {
        assertEquals(5.0, ChargingTabProjection.safeNumber(5.0), 0.0)
        assertEquals(0.0, ChargingTabProjection.safeNumber(null), 0.0)
        assertEquals(0.0, ChargingTabProjection.safeNumber(Double.NaN), 0.0)
        assertEquals(0.0, ChargingTabProjection.safeNumber(Double.POSITIVE_INFINITY), 0.0)
    }

    @Test
    fun formatNumberGroupsAndRoundsHalfAwayFromZero() {
        assertEquals("1,234.5", ChargingTabProjection.formatNumber(1234.5, 1, locale))
        assertEquals("1,234", ChargingTabProjection.formatInt(1234.0, locale))
        // HALF_UP (web `Intl` halfExpand), not Java's default HALF_EVEN which would yield "2".
        assertEquals("3", ChargingTabProjection.formatNumber(2.5, 0, locale))
        assertEquals("$0.00", ChargingTabProjection.formatCurrency(null, "$", 2, locale))
    }

    // ── Diagnostics + constants (a11y / slug coverage) ───────────────────────────────────────────

    @Test
    fun recordChargingTabOpenedEmitsThePiiSafeViewOpenedEvent() {
        val logger = RecordingLogger()
        recordChargingTabOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChargingTab"), fields)
    }

    @Test
    fun surfaceSlugAndUnitConstantsAreStable() {
        assertEquals("ChargingTab", CHARGING_TAB_SLUG)
        assertEquals("$", CHARGING_DEFAULT_CURRENCY)
        assertEquals("kWh", CHARGING_UNIT_KWH)
        assertEquals("kW", CHARGING_UNIT_KW)
        assertEquals("%", CHARGING_UNIT_PERCENT)
    }

    /** A recording [Logger] that captures every structured record for assertion. */
    private class RecordingLogger : Logger {
        data class Record(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(Record(level, event, fields))
        }
    }
}
