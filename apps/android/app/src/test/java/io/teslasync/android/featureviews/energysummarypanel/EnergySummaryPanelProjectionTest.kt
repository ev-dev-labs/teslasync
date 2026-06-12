package io.teslasync.android.featureviews.energysummarypanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the EnergySummaryPanel's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/driving/components/drive-detail/EnergySummaryPanel.tsx and the
 * `lib/numberFormat` helpers it calls) plus the `useUnits` settings adapter. Covers the P3 acceptance test
 * triad: the settings -> display-prefs adapter (`cached -> projection`), the per-state lifecycle + the per-tile
 * projection (each projected value is exactly what the thin composable renders, so the cases double as the
 * per-state "snapshot"), and the merged accessibility label (asserted non-blank and well-formed for every tile).
 */
class EnergySummaryPanelProjectionTest {
    private val metric = EnergySummaryDisplayPrefs.DEFAULT
    private val imperial = EnergySummaryDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))

    private val strings =
        EnergySummaryStrings(
            title = "Energy Summary",
            energyConsumed = "Energy Consumed",
            energyRecovered = "Energy Recovered",
            netConsumption = "Net Consumption",
            efficiency = "Efficiency",
            batteryUsed = "Battery Used",
            rangeUsed = "Range Used",
            noData = "No data available",
        )

    // 9.4 kWh used, 2.1 kWh regen, 168 Wh/km, 82% -> 57%, 210 -> 180 range.
    private val drive =
        EnergySummarySnapshot(
            energyWh = 9_400.0,
            regenWh = 2_100.0,
            consumptionWhKm = 168.0,
            startRange = 210.0,
            endRange = 180.0,
            startBatteryPct = 82.0,
            endBatteryPct = 57.0,
        )

    private fun valueOf(
        snapshot: EnergySummarySnapshot,
        prefs: EnergySummaryDisplayPrefs,
        stat: EnergyStat,
    ): String? = EnergySummaryPanelProjection.tiles(snapshot, prefs, strings).firstOrNull { it.stat == stat }?.value

    private fun sublineOf(
        snapshot: EnergySummarySnapshot,
        prefs: EnergySummaryDisplayPrefs,
        stat: EnergyStat,
    ): String? = EnergySummaryPanelProjection.tiles(snapshot, prefs, strings).firstOrNull { it.stat == stat }?.subline

    // ── Settings -> display-prefs adapter (web `useUnits`) ───────────────────────

    @Test
    fun defaultPrefsAreMetricEnUsTwoDecimals() {
        assertEquals(DistanceUnitPref.KM, metric.units.distance)
        assertEquals(SpeedUnitPref.KMH, metric.units.speed)
        assertFalse(metric.isMiles)
        assertEquals("Wh/km", metric.efficiencyUnit)
        assertEquals("km", metric.distanceLabel)
        assertEquals(2, metric.precision)
        assertEquals("en-US", metric.locale.toLanguageTag())
    }

    @Test
    fun imperialSettingsSelectMilesAndWhPerMile() {
        assertEquals(DistanceUnitPref.MI, imperial.units.distance)
        assertTrue(imperial.isMiles)
        assertEquals("Wh/mi", imperial.efficiencyUnit)
        assertEquals("mi", imperial.distanceLabel)
    }

    @Test
    fun settingsPrecisionAndLocaleFlowIntoPrefs() {
        val prefs = EnergySummaryDisplayPrefs.from(Json.parseToJsonElement("""{"decimal_precision":1,"locale":"de-DE"}"""))
        assertEquals(1, prefs.precision)
        assertEquals("de-DE", prefs.locale.toLanguageTag())
    }

    // ── projectUiState(): per-state lifecycle the composable switches on ─────────

    @Test
    fun loadingProjectsToLoadingRegardlessOfSnapshot() {
        val state = EnergySummaryPanelProjection.projectUiState(drive, isLoading = true)
        assertTrue(state.isLoading)
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun nullSnapshotProjectsToEmpty() {
        val state = EnergySummaryPanelProjection.projectUiState(null, isLoading = false)
        assertTrue(state.isEmpty)
    }

    @Test
    fun presentSnapshotProjectsToContent() {
        val state = EnergySummaryPanelProjection.projectUiState(drive, isLoading = false)
        assertTrue(state.isContent)
        assertEquals(drive, state.data)
    }

    // ── tiles(): the resolved six-tile "snapshot" (metric) ───────────────────────

    @Test
    fun tilesAreSixInWebSourceOrder() {
        val tiles = EnergySummaryPanelProjection.tiles(drive, metric, strings)
        assertEquals(
            listOf(
                EnergyStat.EnergyConsumed,
                EnergyStat.EnergyRecovered,
                EnergyStat.NetConsumption,
                EnergyStat.Efficiency,
                EnergyStat.BatteryUsed,
                EnergyStat.RangeUsed,
            ),
            tiles.map { it.stat },
        )
    }

    @Test
    fun metricTilesRenderEveryWebValue() {
        assertEquals("9.40 kWh", valueOf(drive, metric, EnergyStat.EnergyConsumed))
        assertEquals("2.10 kWh", valueOf(drive, metric, EnergyStat.EnergyRecovered))
        assertEquals("7.30 kWh", valueOf(drive, metric, EnergyStat.NetConsumption))
        assertEquals("168.00 Wh/km", valueOf(drive, metric, EnergyStat.Efficiency))
        assertEquals("25%", valueOf(drive, metric, EnergyStat.BatteryUsed))
        assertEquals("82% \u2192 57%", sublineOf(drive, metric, EnergyStat.BatteryUsed))
        assertEquals("30.00 km", valueOf(drive, metric, EnergyStat.RangeUsed))
    }

    @Test
    fun imperialConvertsEfficiencyAndLabelsRangeWithoutConverting() {
        // Efficiency converts Wh/km -> Wh/mi (168 * 1.609344 = 270.369792 -> 270.37); the range is only
        // re-labeled (the parent supplies it already in the display unit), matching the web source verbatim.
        assertEquals("270.37 Wh/mi", valueOf(drive, imperial, EnergyStat.Efficiency))
        assertEquals("30.00 mi", valueOf(drive, imperial, EnergyStat.RangeUsed))
        // Energy + battery are unit-agnostic, so they read identically under imperial.
        assertEquals("9.40 kWh", valueOf(drive, imperial, EnergyStat.EnergyConsumed))
        assertEquals("25%", valueOf(drive, imperial, EnergyStat.BatteryUsed))
    }

    // ── tiles(): the per-value empty branches (web `'—'`) ────────────────────────

    @Test
    fun zeroConsumptionRendersEfficiencyEmDash() {
        assertEquals("\u2014", valueOf(drive.copy(consumptionWhKm = 0.0), metric, EnergyStat.Efficiency))
        assertEquals("\u2014", valueOf(drive.copy(consumptionWhKm = -5.0), metric, EnergyStat.Efficiency))
    }

    @Test
    fun missingBatteryRendersEmDashValueButStillRendersDetailWithQuestionMark() {
        val noStart = drive.copy(startBatteryPct = null)
        assertEquals("\u2014", valueOf(noStart, metric, EnergyStat.BatteryUsed))
        assertEquals("?% \u2192 57%", sublineOf(noStart, metric, EnergyStat.BatteryUsed))

        val none = drive.copy(startBatteryPct = null, endBatteryPct = null)
        assertEquals("?% \u2192 ?%", sublineOf(none, metric, EnergyStat.BatteryUsed))
    }

    @Test
    fun missingRangeRendersEmDash() {
        assertEquals("\u2014", valueOf(drive.copy(startRange = null), metric, EnergyStat.RangeUsed))
        assertEquals("\u2014", valueOf(drive.copy(endRange = null), metric, EnergyStat.RangeUsed))
    }

    // ── formatEnergy(): web `> 1000 ? kWh : Wh` strict boundary ──────────────────

    @Test
    fun energyShowsKwhStrictlyAboveOneThousandWhElseWh() {
        assertEquals("500.00 Wh", EnergySummaryPanelProjection.formatEnergy(500.0))
        // Exactly 1000 is NOT above the threshold -> Wh (web `> 1000`).
        assertEquals("1,000.00 Wh", EnergySummaryPanelProjection.formatEnergy(1_000.0))
        assertEquals("1.00 kWh", EnergySummaryPanelProjection.formatEnergy(1_000.01))
        assertEquals("9.40 kWh", EnergySummaryPanelProjection.formatEnergy(9_400.0))
    }

    // ── formatNumber(): web `fmtNumber` (precision, safeNumber, grouping, half-up) ─

    @Test
    fun formatNumberRendersWithLocaleGroupingAtPrecision() {
        assertEquals("85.40", EnergySummaryPanelProjection.formatNumber(85.4, Locale.US, 2))
        assertEquals("1,204.00", EnergySummaryPanelProjection.formatNumber(1204.0, Locale.US, 2))
        assertEquals("168.0", EnergySummaryPanelProjection.formatNumber(168.0, Locale.US, 1))
    }

    @Test
    fun formatNumberRoundsHalfUpToMatchIntlNumberFormat() {
        // 0.125 is exactly representable in binary; HALF_UP (Intl "halfExpand") -> "0.13", not banker's "0.12".
        assertEquals("0.13", EnergySummaryPanelProjection.formatNumber(0.125, Locale.US, 2))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", EnergySummaryPanelProjection.formatNumber(Double.NaN, Locale.US, 2))
        assertEquals("0.00", EnergySummaryPanelProjection.formatNumber(Double.POSITIVE_INFINITY, Locale.US, 2))
        assertEquals("0.00", EnergySummaryPanelProjection.formatNumber(Double.NEGATIVE_INFINITY, Locale.US, 2))
    }

    @Test
    fun formatNumberUsesLocaleSpecificGroupingSeparators() {
        val german = EnergySummaryPanelProjection.formatNumber(1204.0, Locale.GERMANY, 2)
        assertTrue(german.endsWith(",00"))
        assertFalse(german == "1,204.00")
    }

    @Test
    fun formatWithUnitAppendsUnitAfterASpace() {
        assertEquals("12.50 kWh", EnergySummaryPanelProjection.formatWithUnit(12.5, "kWh", Locale.US, 2))
    }

    // ── toEfficiencyDisplay(): web `mi ? whPerKm * 1.609344 : whPerKm` ───────────

    @Test
    fun efficiencyConversionScalesByMilesPerKmOnlyForMiles() {
        assertEquals(168.0, EnergySummaryPanelProjection.toEfficiencyDisplay(168.0, isMiles = false), 0.0)
        assertEquals(270.369792, EnergySummaryPanelProjection.toEfficiencyDisplay(168.0, isMiles = true), 1e-9)
    }

    // ── formatPlain(): web bare template-literal number rendering ────────────────

    @Test
    fun formatPlainDropsTheFractionForWholeNumbers() {
        assertEquals("25", EnergySummaryPanelProjection.formatPlain(25.0))
        assertEquals("82", EnergySummaryPanelProjection.formatPlain(82.0))
        assertEquals("-5", EnergySummaryPanelProjection.formatPlain(-5.0))
    }

    @Test
    fun formatPlainKeepsTheFractionForNonWholeNumbers() {
        assertEquals("24.5", EnergySummaryPanelProjection.formatPlain(24.5))
    }

    // ── batteryValue / batterySubline / rangeValue direct paths ──────────────────

    @Test
    fun batteryValueIsDeltaPercentOrEmDash() {
        assertEquals("25%", EnergySummaryPanelProjection.batteryValue(82.0, 57.0))
        assertEquals("\u2014", EnergySummaryPanelProjection.batteryValue(null, 57.0))
        assertEquals("\u2014", EnergySummaryPanelProjection.batteryValue(82.0, null))
    }

    @Test
    fun batterySublineJoinsStartAndEndWithArrowAndQuestionMarkFallback() {
        assertEquals("82% \u2192 57%", EnergySummaryPanelProjection.batterySubline(82.0, 57.0))
        assertEquals("?% \u2192 ?%", EnergySummaryPanelProjection.batterySubline(null, null))
    }

    @Test
    fun rangeValueLabelsTheDeltaWithTheDistanceUnitWithoutConverting() {
        assertEquals("30.00 km", EnergySummaryPanelProjection.rangeValue(210.0, 180.0, metric))
        assertEquals("30.00 mi", EnergySummaryPanelProjection.rangeValue(210.0, 180.0, imperial))
        assertEquals("\u2014", EnergySummaryPanelProjection.rangeValue(null, 180.0, metric))
    }

    // ── accessibilityLabel(): merged TalkBack reading per tile ───────────────────

    @Test
    fun accessibilityLabelJoinsLabelValueAndDetailWhenPresent() {
        assertEquals(
            "Battery Used: 25%, 82% \u2192 57%",
            EnergySummaryPanelProjection.accessibilityLabel("Battery Used", "25%", "82% \u2192 57%"),
        )
    }

    @Test
    fun accessibilityLabelOmitsDetailWhenAbsentOrBlank() {
        assertEquals(
            "Energy Consumed: 9.40 kWh",
            EnergySummaryPanelProjection.accessibilityLabel("Energy Consumed", "9.40 kWh", null),
        )
        assertEquals(
            "Energy Consumed: 9.40 kWh",
            EnergySummaryPanelProjection.accessibilityLabel("Energy Consumed", "9.40 kWh", "   "),
        )
    }

    @Test
    fun everyTileHasANonBlankAccessibleReading() {
        val tiles = EnergySummaryPanelProjection.tiles(drive, metric, strings)
        tiles.forEach { tile ->
            val label = EnergySummaryPanelProjection.accessibilityLabel(tile.label, tile.value, tile.subline)
            assertTrue(label.isNotBlank())
            assertTrue(label.startsWith(tile.label))
        }
        assertNull(tiles.first { it.stat == EnergyStat.EnergyConsumed }.subline)
    }
}
