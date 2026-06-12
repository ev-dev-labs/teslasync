// Off-device unit coverage for the DriveStatCards feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-key tests). Exercises the settings -> display-prefs adapter (units, currency, cost-per-kWh,
// precision, locale — the web `useUnits` + `useFormatting` derivation), the SI -> display tile projection (the
// ten ordered tiles incl. the two conditional cost tiles, the `convertDistanceFromSI`/`convertSpeedFromSI`
// conversions, the `fmtInt`/`fmtWithUnit`/`formatCurrency`/`formatEnergyCost` formats, the `safeNumber` null
// guards), the web `formatDuration` "Xh Ym" helper, the lifecycle classifier the composable switches on
// (per-state coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivestatcards

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DriveStatCardsModelTest {
    private val metric = DriveStatDisplayPrefs.DEFAULT
    private val imperial = DriveStatDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))

    // €/0.30-per-kWh/1-decimal settings: exercises the non-default currency, cost, and precision derivation.
    private val euroSettings = """{"currency_symbol":"€","base_cost_per_kwh":0.30,"decimal_precision":1}"""
    private val euroPrefs = DriveStatDisplayPrefs.from(Json.parseToJsonElement(euroSettings))

    private val strings =
        DriveStatCardsStrings(
            distance = "Distance",
            duration = "Duration",
            maxSpeed = "Max Speed",
            avgSpeed = "Avg Speed",
            soc = "SOC",
            maxPower = "Max Power",
            elevGain = "Elev. Gain",
            elevLoss = "Elev. Loss",
            tripCost = "Trip Cost",
            costPerUnitTemplate = "Cost / %1\$s",
            noData = "No data available",
        )

    // A clean drive: 12 km in 30 min, 30/20 m/s max/avg, 80% -> 60%, 150 kW peak, +120/-81 m, 9 kWh used.
    private val drive =
        DriveStatCardsSnapshot(
            distanceM = 12_000.0,
            durationS = 1_800.0,
            maxSpeedMps = 30.0,
            avgSpeedMps = 20.0,
            startBatteryPct = 80.0,
            endBatteryPct = 60.0,
            powerMaxKw = 150.0,
            elevGainM = 120.4,
            elevLossM = 80.6,
            energyWh = 9_000.0,
        )

    private fun tiles(
        snapshot: DriveStatCardsSnapshot,
        prefs: DriveStatDisplayPrefs,
    ) = DriveStatCardsProjection.tiles(snapshot, prefs, strings)

    private fun valueOf(
        snapshot: DriveStatCardsSnapshot,
        prefs: DriveStatDisplayPrefs,
        stat: DriveStat,
    ): String? = tiles(snapshot, prefs).firstOrNull { it.stat == stat }?.value?.text

    // ── Settings -> display-prefs adapter (web `useUnits` + `useFormatting`) ─────

    @Test
    fun defaultPrefsAreMetricDollarTwoDecimalsEnUs() {
        assertEquals(DistanceUnitPref.KM, metric.units.distance)
        assertEquals(SpeedUnitPref.KMH, metric.units.speed)
        assertEquals("$", metric.currencySymbol)
        assertEquals(0.12, metric.costPerKwh, 0.0)
        assertEquals(2, metric.precision)
        assertEquals("en-US", metric.locale.toLanguageTag())
    }

    @Test
    fun imperialSettingsSelectMilesAndMph() {
        assertEquals(DistanceUnitPref.MI, imperial.units.distance)
        assertEquals(SpeedUnitPref.MPH, imperial.units.speed)
    }

    @Test
    fun currencyAndCostAndPrecisionResolveFromSettings() {
        assertEquals("€", euroPrefs.currencySymbol)
        assertEquals(0.30, euroPrefs.costPerKwh, 0.0)
        assertEquals(1, euroPrefs.precision)
    }

    @Test
    fun blankCurrencySymbolUsesDollarFallback() {
        val prefs = DriveStatDisplayPrefs.from(Json.parseToJsonElement("""{"currency_symbol":"  "}"""))
        assertEquals("$", prefs.currencySymbol)
    }

    // ── Tile projection: metric (web conversions + formats) ──────────────────────

    @Test
    fun projectsTenTilesInWebSourceOrderForMetricUnits() {
        val order = tiles(drive, metric).map { it.stat }
        assertEquals(
            listOf(
                DriveStat.Distance,
                DriveStat.Duration,
                DriveStat.MaxSpeed,
                DriveStat.AvgSpeed,
                DriveStat.Soc,
                DriveStat.MaxPower,
                DriveStat.ElevGain,
                DriveStat.ElevLoss,
                DriveStat.TripCost,
                DriveStat.CostPerUnit,
            ),
            order,
        )
    }

    @Test
    fun metricTileValuesMatchTheWebFormatting() {
        assertEquals("12.0 km", valueOf(drive, metric, DriveStat.Distance))
        assertEquals("30m", valueOf(drive, metric, DriveStat.Duration))
        assertEquals("108 km/h", valueOf(drive, metric, DriveStat.MaxSpeed))
        assertEquals("72 km/h", valueOf(drive, metric, DriveStat.AvgSpeed))
        assertEquals("80% \u2192 60%", valueOf(drive, metric, DriveStat.Soc))
        assertEquals("150.00 kW", valueOf(drive, metric, DriveStat.MaxPower))
        assertEquals("120 m \u2191", valueOf(drive, metric, DriveStat.ElevGain))
        assertEquals("81 m \u2193", valueOf(drive, metric, DriveStat.ElevLoss))
        assertEquals("$1.08", valueOf(drive, metric, DriveStat.TripCost))
        assertEquals("$0.090", valueOf(drive, metric, DriveStat.CostPerUnit))
    }

    @Test
    fun distanceAndSpeedAndCostConvertThroughTheImperialBoundary() {
        // 12000 m -> 7.5 mi; 30 m/s -> 67 mph; cost/mi = 1.08 / 7.4564 mi -> 0.145.
        assertEquals("7.5 mi", valueOf(drive, imperial, DriveStat.Distance))
        assertEquals("67 mph", valueOf(drive, imperial, DriveStat.MaxSpeed))
        assertEquals("45 mph", valueOf(drive, imperial, DriveStat.AvgSpeed))
        assertEquals("$0.145", valueOf(drive, imperial, DriveStat.CostPerUnit))
    }

    @Test
    fun powerAndTripCostHonorTheUserPrecisionButCostPerUnitStaysThreeDecimals() {
        // precision 1: power and trip cost follow it; cost/unit keeps the web-fixed 3 decimals.
        assertEquals("150.0 kW", valueOf(drive, euroPrefs, DriveStat.MaxPower))
        assertEquals("€2.7", valueOf(drive, euroPrefs, DriveStat.TripCost))
        assertEquals("€0.225", valueOf(drive, euroPrefs, DriveStat.CostPerUnit))
    }

    // ── Conditional cost tiles (web `energyWh > 0` / `&& distanceM > 0`) ─────────

    @Test
    fun zeroEnergyDropsBothCostTiles() {
        val noEnergy = drive.copy(energyWh = 0.0)
        val stats = tiles(noEnergy, metric).map { it.stat }
        assertEquals(8, stats.size)
        assertFalse(stats.contains(DriveStat.TripCost))
        assertFalse(stats.contains(DriveStat.CostPerUnit))
        assertEquals(DriveStat.ElevLoss, stats.last())
    }

    @Test
    fun energyWithoutDistanceKeepsTripCostButDropsCostPerUnit() {
        val noDistance = drive.copy(distanceM = 0.0)
        val stats = tiles(noDistance, metric).map { it.stat }
        assertEquals(9, stats.size)
        assertTrue(stats.contains(DriveStat.TripCost))
        assertFalse(stats.contains(DriveStat.CostPerUnit))
    }

    // ── Null / non-finite guards (web `safeNumber` + speed null guard) ───────────

    @Test
    fun nullSpeedsRenderAsZeroNotEmDash() {
        val noSpeed = drive.copy(maxSpeedMps = null, avgSpeedMps = null)
        assertEquals("0 km/h", valueOf(noSpeed, metric, DriveStat.MaxSpeed))
        assertEquals("0 km/h", valueOf(noSpeed, metric, DriveStat.AvgSpeed))
    }

    @Test
    fun nullBatteryPercentagesRenderAsZeroSoc() {
        val noSoc = drive.copy(startBatteryPct = null, endBatteryPct = null)
        assertEquals("0% \u2192 0%", valueOf(noSoc, metric, DriveStat.Soc))
    }

    // ── Animated vs static value typing (web `<AnimatedNumber>` vs plain string) ─

    @Test
    fun fiveTilesAreAnimatedAndCarryTheirNumericParts() {
        val byStat = tiles(drive, metric).associateBy { it.stat }
        val animated = byStat.filterValues { it.value is DriveStatValue.Animated }.keys
        assertEquals(
            setOf(DriveStat.Distance, DriveStat.MaxSpeed, DriveStat.AvgSpeed, DriveStat.ElevGain, DriveStat.ElevLoss),
            animated,
        )
        val distance = byStat.getValue(DriveStat.Distance).value as DriveStatValue.Animated
        assertEquals(12.0, distance.value, 0.0)
        assertEquals(1, distance.decimals)
        assertEquals(" km", distance.suffix)
        assertTrue(byStat.getValue(DriveStat.Duration).value is DriveStatValue.Static)
    }

    // ── Duration helper (web `formatDuration`) ───────────────────────────────────

    @Test
    fun formatDurationSplitsHoursAndMinutesLikeTheWeb() {
        assertEquals("30m", DriveStatCardsProjection.formatDriveDuration(30.0))
        assertEquals("1h 1m", DriveStatCardsProjection.formatDriveDuration(61.0))
        assertEquals("2h 0m", DriveStatCardsProjection.formatDriveDuration(120.0))
        assertEquals("0m", DriveStatCardsProjection.formatDriveDuration(0.0))
    }

    // ── i18n / a11y label keys (web `t('driveDetail.*')`) ────────────────────────

    @Test
    fun tileLabelsComeFromTheSuppliedI18nStrings() {
        val byStat = tiles(drive, metric).associateBy { it.stat }
        assertEquals("Distance", byStat.getValue(DriveStat.Distance).label)
        assertEquals("Max Speed", byStat.getValue(DriveStat.MaxSpeed).label)
        assertEquals("Trip Cost", byStat.getValue(DriveStat.TripCost).label)
    }

    @Test
    fun costPerUnitLabelSubstitutesTheDistanceUnit() {
        assertEquals("Cost / km", tiles(drive, metric).first { it.stat == DriveStat.CostPerUnit }.label)
        assertEquals("Cost / mi", tiles(drive, imperial).first { it.stat == DriveStat.CostPerUnit }.label)
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────

    @Test
    fun projectUiStateCoversLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, DriveStatCardsProjection.projectUiState(drive, isLoading = true).phase)
        assertEquals(UiPhase.Empty, DriveStatCardsProjection.projectUiState(null, isLoading = false).phase)
        val content = DriveStatCardsProjection.projectUiState(drive, isLoading = false)
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
        // Cached data still renders the full tile grid while stale.
        assertEquals(10, tiles(offline.data!!, metric).size)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        DriveStatCardsDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "DriveStatCards"), record.fields)
        assertEquals("DriveStatCards", DriveStatCardsDiagnostics.SLUG)
        assertNull(emptyList<DriveStatTile>().firstOrNull())
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
