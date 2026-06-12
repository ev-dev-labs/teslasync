// Off-device unit coverage for the MoreDetailsPanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-key tests). Exercises the settings -> display-prefs adapter (units, precision, locale — the
// web `useUnits` + global `fmtNumber` derivation), the SI -> display cell projection (the six primary + four-to-
// six secondary cells incl. the two conditional temperature cells, the `convert*FromSI` conversions, the
// `fmtNumber`/`fmtInt`/`fmtWithUnit`/`toEfficiencyDisplay` formats, the `'—'`/`'?'` guards, the kWh-vs-Wh
// threshold, and the `safeNumber` null guards), the lifecycle classifier the composable switches on (per-state
// coverage), the cell labels + accessibility announcements (a11y-key coverage), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.moredetailspanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MoreDetailsPanelModelTest {
    private val metric = MoreDetailsDisplayPrefs.DEFAULT
    private val imperial = MoreDetailsDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))
    private val fahrenheit = MoreDetailsDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_temp":"F"}"""))
    private val onePlace = MoreDetailsDisplayPrefs.from(Json.parseToJsonElement("""{"decimal_precision":1}"""))

    private val strings =
        MoreDetailsStrings(
            title = "More Details",
            odometer = "Odometer (From \u2192 To)",
            rangeStartEnd = "Range (Start \u2192 End)",
            elevSummary = "Elevation Summary",
            energyConsumed = "Energy Consumed",
            energyRecovered = "Energy Recovered",
            consumptionRate = "Consumption",
            avgPower = "Avg Power",
            avgOutsideTemp = "Avg Outside Temp",
            avgInsideTemp = "Avg Inside Temp",
            minSpeed = "Min Speed",
            batteryUsed = "Battery Used",
            netEnergy = "Net Consumption",
            noData = "No data available",
        )

    // A clean drive: 12,345 -> 12,357 km odometer, 350 -> 320 km range, +120/-80 m elevation, 9 kWh used /
    // 1.5 kWh regen over 12 km, 45 kW avg, 20/22 °C outside/inside, 10 m/s (36 km/h) min, 80% -> 60%.
    private val drive =
        MoreDetailsSnapshot(
            odometerStartM = 12_345_000.0,
            odometerEndM = 12_357_000.0,
            startRangeM = 350_000.0,
            endRangeM = 320_000.0,
            elevGainM = 120.0,
            elevLossM = 80.0,
            energyWh = 9_000.0,
            regenWh = 1_500.0,
            distanceM = 12_000.0,
            avgPowerKw = 45.0,
            avgOutsideTempC = 20.0,
            avgInsideTempC = 22.0,
            minSpeedMps = 10.0,
            startBatteryPct = 80.0,
            endBatteryPct = 60.0,
        )

    private fun rows(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ) = MoreDetailsProjection.primaryRows(snapshot, prefs, strings) +
        MoreDetailsProjection.secondaryRows(snapshot, prefs, strings)

    private fun valueOf(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        detail: MoreDetail,
    ): MoreDetailValue? = rows(snapshot, prefs).firstOrNull { it.detail == detail }?.value

    private fun textOf(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        detail: MoreDetail,
    ): String? = (valueOf(snapshot, prefs, detail) as? MoreDetailValue.Measure)?.value

    private fun unitOf(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        detail: MoreDetail,
    ): String? = (valueOf(snapshot, prefs, detail) as? MoreDetailValue.Measure)?.unit

    // ── Settings -> display-prefs adapter (web `useUnits` + global `fmtNumber`) ───

    @Test
    fun defaultPrefsAreMetricTwoDecimalsEnUs() {
        assertEquals(DistanceUnitPref.KM, metric.units.distance)
        assertEquals(SpeedUnitPref.KMH, metric.units.speed)
        assertEquals(TemperatureUnitPref.CELSIUS, metric.units.temperature)
        assertEquals(2, metric.precision)
        assertEquals("en-US", metric.locale.toLanguageTag())
    }

    @Test
    fun imperialSettingsSelectMilesAndMph() {
        assertEquals(DistanceUnitPref.MI, imperial.units.distance)
        assertEquals(SpeedUnitPref.MPH, imperial.units.speed)
    }

    @Test
    fun fahrenheitSettingSelectsFahrenheit() {
        assertEquals(TemperatureUnitPref.FAHRENHEIT, fahrenheit.units.temperature)
        // Temperature preference is independent of the (unset) length preference.
        assertEquals(DistanceUnitPref.KM, fahrenheit.units.distance)
    }

    @Test
    fun decimalPrecisionSettingDrivesTheGlobalPrecision() {
        assertEquals(1, onePlace.precision)
    }

    // ── Grid composition + source order ──────────────────────────────────────────

    @Test
    fun primaryGridHasSixCellsInWebSourceOrder() {
        val order = MoreDetailsProjection.primaryRows(drive, metric, strings).map { it.detail }
        assertEquals(
            listOf(
                MoreDetail.Odometer,
                MoreDetail.Range,
                MoreDetail.Elevation,
                MoreDetail.EnergyConsumed,
                MoreDetail.EnergyRecovered,
                MoreDetail.Consumption,
            ),
            order,
        )
    }

    @Test
    fun secondaryGridHasAllSixCellsInWebSourceOrderWhenTempsPresent() {
        val order = MoreDetailsProjection.secondaryRows(drive, metric, strings).map { it.detail }
        assertEquals(
            listOf(
                MoreDetail.AvgPower,
                MoreDetail.AvgOutsideTemp,
                MoreDetail.AvgInsideTemp,
                MoreDetail.MinSpeed,
                MoreDetail.BatteryUsed,
                MoreDetail.NetConsumption,
            ),
            order,
        )
    }

    // ── Cell values: metric (web conversions + formats) ──────────────────────────

    @Test
    fun metricCellValuesMatchTheWebFormatting() {
        assertEquals("12,345.00 \u2192 12,357.00", textOf(drive, metric, MoreDetail.Odometer))
        assertEquals("km", unitOf(drive, metric, MoreDetail.Odometer))
        assertEquals("350.00 \u2192 320.00", textOf(drive, metric, MoreDetail.Range))
        assertEquals("km", unitOf(drive, metric, MoreDetail.Range))
        assertEquals("9.00 kWh", textOf(drive, metric, MoreDetail.EnergyConsumed))
        assertEquals("1.50 kWh", textOf(drive, metric, MoreDetail.EnergyRecovered))
        assertEquals("750.00", textOf(drive, metric, MoreDetail.Consumption))
        assertEquals("Wh/km", unitOf(drive, metric, MoreDetail.Consumption))
        assertEquals("45.00", textOf(drive, metric, MoreDetail.AvgPower))
        assertEquals("kW", unitOf(drive, metric, MoreDetail.AvgPower))
        assertEquals("20.00\u00B0C", textOf(drive, metric, MoreDetail.AvgOutsideTemp))
        assertEquals("22.00\u00B0C", textOf(drive, metric, MoreDetail.AvgInsideTemp))
        assertEquals("36 km/h", textOf(drive, metric, MoreDetail.MinSpeed))
        assertEquals("20%", textOf(drive, metric, MoreDetail.BatteryUsed))
        assertEquals("7.50 kWh", textOf(drive, metric, MoreDetail.NetConsumption))
    }

    @Test
    fun elevationCellRendersGainAndLossInMetres() {
        val elevation = valueOf(drive, metric, MoreDetail.Elevation) as MoreDetailValue.Elevation
        assertEquals("120.00 m", elevation.gain)
        assertEquals("80.00 m", elevation.loss)
    }

    // ── Cell values: imperial + fahrenheit (display-boundary conversions) ─────────

    @Test
    fun distanceConvertsThroughTheImperialBoundary() {
        // 16,093.44 m -> 10 mi, 32,186.88 m -> 20 mi.
        val cleanMiles = drive.copy(odometerStartM = 16_093.44, odometerEndM = 32_186.88)
        assertEquals("10.00 \u2192 20.00", textOf(cleanMiles, imperial, MoreDetail.Odometer))
        assertEquals("mi", unitOf(cleanMiles, imperial, MoreDetail.Odometer))
    }

    @Test
    fun speedAndEfficiencyConvertThroughTheImperialBoundary() {
        // 10 m/s -> 22 mph (fmtInt); 750 Wh/km * 1.609344 -> 1207.008 -> "1,207.01" Wh/mi.
        assertEquals("22 mph", textOf(drive, imperial, MoreDetail.MinSpeed))
        assertEquals("1,207.01", textOf(drive, imperial, MoreDetail.Consumption))
        assertEquals("Wh/mi", unitOf(drive, imperial, MoreDetail.Consumption))
    }

    @Test
    fun temperatureConvertsThroughTheFahrenheitBoundary() {
        // 20 °C -> 68 °F, 22 °C -> 71.6 °F.
        assertEquals("68.00\u00B0F", textOf(drive, fahrenheit, MoreDetail.AvgOutsideTemp))
        assertEquals("71.60\u00B0F", textOf(drive, fahrenheit, MoreDetail.AvgInsideTemp))
    }

    @Test
    fun precisionSettingDrivesEveryFmtNumberCellButNotFmtInt() {
        assertEquals("9.0 kWh", textOf(drive, onePlace, MoreDetail.EnergyConsumed))
        assertEquals("750.0", textOf(drive, onePlace, MoreDetail.Consumption))
        assertEquals("45.0", textOf(drive, onePlace, MoreDetail.AvgPower))
        // Min Speed always uses fmtInt (0 decimals), independent of the global precision.
        assertEquals("36 km/h", textOf(drive, onePlace, MoreDetail.MinSpeed))
    }

    // ── Conditional temperature cells (web `avgTemp !== null` guards) ─────────────

    @Test
    fun nullOutsideTempDropsOnlyThatCell() {
        val noOutside = drive.copy(avgOutsideTempC = null)
        val order = MoreDetailsProjection.secondaryRows(noOutside, metric, strings).map { it.detail }
        assertEquals(5, order.size)
        assertFalse(order.contains(MoreDetail.AvgOutsideTemp))
        assertTrue(order.contains(MoreDetail.AvgInsideTemp))
    }

    @Test
    fun nullBothTempsDropsBothCellsLeavingFour() {
        val noTemps = drive.copy(avgOutsideTempC = null, avgInsideTempC = null)
        val order = MoreDetailsProjection.secondaryRows(noTemps, metric, strings).map { it.detail }
        assertEquals(
            listOf(MoreDetail.AvgPower, MoreDetail.MinSpeed, MoreDetail.BatteryUsed, MoreDetail.NetConsumption),
            order,
        )
    }

    // ── '—' / '?' guards (web truthiness + null branches) ─────────────────────────

    @Test
    fun zeroOdometerRendersEmDashButKeepsTheUnit() {
        val noOdometer = drive.copy(odometerStartM = 0.0)
        assertEquals("\u2014", textOf(noOdometer, metric, MoreDetail.Odometer))
        assertEquals("km", unitOf(noOdometer, metric, MoreDetail.Odometer))
    }

    @Test
    fun nullStartRangeRendersEmDash() {
        val noRange = drive.copy(startRangeM = null)
        assertEquals("\u2014", textOf(noRange, metric, MoreDetail.Range))
    }

    @Test
    fun nullEndRangeRendersQuestionMarkForTheEnd() {
        val noEnd = drive.copy(endRangeM = null)
        assertEquals("350.00 \u2192 ?", textOf(noEnd, metric, MoreDetail.Range))
    }

    @Test
    fun zeroDistanceRendersConsumptionEmDash() {
        val noDistance = drive.copy(distanceM = 0.0)
        assertEquals("\u2014", textOf(noDistance, metric, MoreDetail.Consumption))
        assertEquals("Wh/km", unitOf(noDistance, metric, MoreDetail.Consumption))
    }

    @Test
    fun nullBatteryPercentagesRenderEmDash() {
        val noBattery = drive.copy(startBatteryPct = null)
        assertEquals("\u2014", textOf(noBattery, metric, MoreDetail.BatteryUsed))
    }

    // ── kWh-vs-Wh threshold (web `> 1000`) + plain battery delta ──────────────────

    @Test
    fun energyBelowOrAtThousandWhStaysInWattHours() {
        assertEquals("500.00 Wh", textOf(drive.copy(energyWh = 500.0), metric, MoreDetail.EnergyConsumed))
        // Exactly 1000 is NOT greater than 1000, so it stays in Wh.
        assertEquals("1,000.00 Wh", textOf(drive.copy(energyWh = 1_000.0), metric, MoreDetail.EnergyConsumed))
        assertEquals("1.00 kWh", textOf(drive.copy(energyWh = 1_001.0), metric, MoreDetail.EnergyConsumed))
    }

    @Test
    fun netConsumptionBelowThresholdStaysInWattHours() {
        val small = drive.copy(energyWh = 2_000.0, regenWh = 1_500.0)
        assertEquals("500.00 Wh", textOf(small, metric, MoreDetail.NetConsumption))
    }

    @Test
    fun batteryDeltaIsRenderedAsAPlainInteger() {
        assertEquals("20%", textOf(drive, metric, MoreDetail.BatteryUsed))
        assertEquals("5%", textOf(drive.copy(startBatteryPct = 65.0, endBatteryPct = 60.0), metric, MoreDetail.BatteryUsed))
    }

    // ── Null / non-finite guards (web `safeNumber` + min-speed zero) ──────────────

    @Test
    fun zeroMinSpeedRendersZeroNotEmDash() {
        assertEquals("0 km/h", textOf(drive.copy(minSpeedMps = 0.0), metric, MoreDetail.MinSpeed))
    }

    // ── i18n / a11y labels + announcements (web `t('driveDetail.*')`) ─────────────

    @Test
    fun cellLabelsComeFromTheSuppliedI18nStrings() {
        val byDetail = rows(drive, metric).associateBy { it.detail }
        assertEquals("Odometer (From \u2192 To)", byDetail.getValue(MoreDetail.Odometer).label)
        assertEquals("Elevation Summary", byDetail.getValue(MoreDetail.Elevation).label)
        assertEquals("Net Consumption", byDetail.getValue(MoreDetail.NetConsumption).label)
        assertEquals("Avg Outside Temp", byDetail.getValue(MoreDetail.AvgOutsideTemp).label)
    }

    @Test
    fun measureAnnouncementJoinsTheValueAndUnitForTalkBack() {
        assertEquals("12,345.00 \u2192 12,357.00 km", valueOf(drive, metric, MoreDetail.Odometer)!!.announce)
        // A unit-less cell announces just its value.
        assertEquals("9.00 kWh", valueOf(drive, metric, MoreDetail.EnergyConsumed)!!.announce)
    }

    @Test
    fun elevationAnnouncementCarriesDirectionalArrows() {
        val announce = valueOf(drive, metric, MoreDetail.Elevation)!!.announce
        assertEquals("\u2197 120.00 m, \u2198 80.00 m", announce)
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────

    @Test
    fun projectUiStateCoversLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, MoreDetailsProjection.projectUiState(drive, isLoading = true).phase)
        assertEquals(UiPhase.Empty, MoreDetailsProjection.projectUiState(null, isLoading = false).phase)
        val content = MoreDetailsProjection.projectUiState(drive, isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(drive, content.data)
    }

    @Test
    fun offlineCachedStateStaysContentAndIsFlaggedStale() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = drive,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertFalse(offline.isEmpty)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        // Cached data still renders the full primary grid while stale.
        assertEquals(6, MoreDetailsProjection.primaryRows(offline.data!!, metric, strings).size)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        MoreDetailsPanelDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "MoreDetailsPanel"), record.fields)
        assertEquals("MoreDetailsPanel", MoreDetailsPanelDiagnostics.SLUG)
        assertNull(emptyList<MoreDetailRow>().firstOrNull())
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
