package io.teslasync.android.featureviews.costsavingspanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the CostSavingsPanel pure projection — the native port of the web component's
 * `({ drive, stats })` render contract
 * (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx): the (snapshot, isLoading) lifecycle
 * adapter, the up-to-five tile list with the exact web render guards (`drive.distanceM > 0`, `savings != null
 * && savings > 0`), the web `useFormatting` cost derivations (the EV energy cost, the meters→miles gasoline
 * bridge with its gallon/litre branch, the per-distance cost), the `fmtNumber` / `formatCurrency` formatting,
 * the composed `at {symbol}{rate}/kWh` / `at {mpg} MPG` / `Cost / {unit}` subtitles + label, the savings
 * percentage, the settings-derived display preferences, and the PII-safe `view.opened` diagnostic. Runs in the
 * :app:testReleaseUnitTest gate; no Compose, no device.
 */
class CostSavingsPanelProjectionTest {
    private val prefs =
        CostSavingsDisplayPrefs(
            currencySymbol = "$",
            precision = 2,
            locale = Locale.US,
            costPerKwh = 0.12,
            gasEfficiencyMpg = 25.0,
            gasPricePerUnit = 4.0,
            gasUnitIsLiter = false,
            distancePref = DistanceUnitPref.MI,
        )

    private val strings =
        CostSavingsStrings(
            title = "Cost & Savings",
            tripCost = "Trip Cost",
            atRateTemplate = "at %1\$s%2\$s/kWh",
            costPerUnitTemplate = "Cost / %1\$s",
            gasCostEquiv = "Gas Cost (equiv)",
            atMpgTemplate = "at %1\$s MPG",
            gasSavings = "vs Gas Savings",
            savingsPct = "Savings %",
        )

    /** 20 miles exactly (20 × 1609.344 m) so the meters→miles bridge yields round figures. */
    private val twentyMilesMeters = 32_186.88

    private fun snapshot(
        distanceM: Double = twentyMilesMeters,
        energyWh: Double = 6_000.0,
    ): CostSavingsSnapshot = CostSavingsSnapshot(DriveCostInputs(distanceM), DriveCostStats(energyWh))

    private fun tiles(
        snapshot: CostSavingsSnapshot = snapshot(),
        prefs: CostSavingsDisplayPrefs = this.prefs,
    ): List<CostSavingsTile> = CostSavingsPanelProjection.tiles(snapshot, prefs, strings)

    // ── (snapshot, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        val state = CostSavingsPanelProjection.projectUiState(snapshot(), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val snapshot = snapshot()
        val state = CostSavingsPanelProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = CostSavingsPanelProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    // ── tiles: order + the web render guards ────────────────────────────────────────────────────────────

    @Test
    fun allFiveTilesInWebSourceOrderWhenSavingsPositive() {
        val labels = tiles().map { it.label }
        assertEquals(
            listOf("Trip Cost", "Cost / mi", "Gas Cost (equiv)", "vs Gas Savings", "Savings %"),
            labels,
        )
    }

    @Test
    fun tripCostTileIsAlwaysPresentEvenWithNoDistanceAndNoGas() {
        // distanceM <= 0 drops the per-distance tile AND the gasoline trio (gasCost is null) — only Trip Cost remains.
        val list = tiles(snapshot(distanceM = 0.0))
        assertEquals(1, list.size)
        assertEquals("Trip Cost", list.single().label)
    }

    @Test
    fun perDistanceTileOmittedWhenDistanceNotPositive() {
        assertTrue(tiles(snapshot(distanceM = 0.0)).none { it.label == "Cost / mi" })
        assertTrue(tiles().any { it.label == "Cost / mi" })
    }

    @Test
    fun gasolineTrioOmittedWhenNoGasPrice() {
        // Web `gas_price_per_unit: 0` default → estimateGasCost returns null → savings null → no gas tiles.
        val list = tiles(prefs = prefs.copy(gasPricePerUnit = 0.0))
        assertEquals(listOf("Trip Cost", "Cost / mi"), list.map { it.label })
    }

    @Test
    fun gasolineTrioOmittedWhenSavingsNonPositive() {
        // A huge trip energy makes the EV cost exceed the gasoline cost → savings <= 0 → no gas tiles.
        val list = tiles(snapshot(energyWh = 5_000_000.0))
        assertEquals(listOf("Trip Cost", "Cost / mi"), list.map { it.label })
    }

    // ── tiles: formatted values, subtitles, and semantic tones (web cells) ──────────────────────────────

    @Test
    fun tileValuesSubtitlesAndTonesMatchWeb() {
        val byLabel = tiles().associateBy { it.label }

        val trip = byLabel.getValue("Trip Cost")
        assertEquals("$0.72", trip.value)
        assertEquals("at $0.12/kWh", trip.sub)
        assertEquals(CostTileTone.Success, trip.tone)

        val perDist = byLabel.getValue("Cost / mi")
        assertEquals("$0.036", perDist.value)
        assertNull(perDist.sub)
        assertEquals(CostTileTone.Info, perDist.tone)

        val gas = byLabel.getValue("Gas Cost (equiv)")
        assertEquals("$3.20", gas.value)
        assertEquals("at 25 MPG", gas.sub)
        assertEquals(CostTileTone.Danger, gas.tone)

        val savings = byLabel.getValue("vs Gas Savings")
        assertEquals("$2.48", savings.value)
        assertNull(savings.sub)
        assertEquals(CostTileTone.Success, savings.tone)

        val pct = byLabel.getValue("Savings %")
        assertEquals("78%", pct.value)
        assertEquals(CostTileTone.Success, pct.tone)
    }

    @Test
    fun perDistanceLabelUsesKmWordWhenMetric() {
        val metric = tiles(prefs = prefs.copy(distancePref = DistanceUnitPref.KM))
        assertTrue(metric.any { it.label == "Cost / km" })
    }

    @Test
    fun currencySymbolAndPrecisionFlowIntoEveryValue() {
        val euro = prefs.copy(currencySymbol = "€", precision = 2, gasPricePerUnit = 4.0)
        val byLabel = tiles(prefs = euro).associateBy { it.label }
        assertEquals("€0.72", byLabel.getValue("Trip Cost").value)
        assertEquals("€0.036", byLabel.getValue("Cost / mi").value)
        assertEquals("€3.20", byLabel.getValue("Gas Cost (equiv)").value)
    }

    // ── cost derivations (web useFormatting) ────────────────────────────────────────────────────────────

    @Test
    fun evCostIsEnergyKwhTimesRate() {
        assertEquals(0.72, CostSavingsPanelProjection.evCost(6_000.0, prefs), 1e-9)
    }

    @Test
    fun gasCostUsesMetersToMilesBridge() {
        // 20 mi / 25 mpg = 0.8 gal × $4.00 = $3.20.
        assertEquals(3.2, CostSavingsPanelProjection.gasCost(twentyMilesMeters, prefs)!!, 1e-9)
    }

    @Test
    fun gasCostScalesByLitresWhenGasUnitIsLitres() {
        // 0.8 gal × 3.78541 L/gal × $1.00 = $3.028328.
        val litre = prefs.copy(gasUnitIsLiter = true, gasPricePerUnit = 1.0)
        assertEquals(0.8 * 3.78541, CostSavingsPanelProjection.gasCost(twentyMilesMeters, litre)!!, 1e-9)
    }

    @Test
    fun gasCostNullWhenEconomyPriceOrDistanceNonPositive() {
        assertNull(CostSavingsPanelProjection.gasCost(twentyMilesMeters, prefs.copy(gasEfficiencyMpg = 0.0)))
        assertNull(CostSavingsPanelProjection.gasCost(twentyMilesMeters, prefs.copy(gasPricePerUnit = 0.0)))
        assertNull(CostSavingsPanelProjection.gasCost(0.0, prefs))
    }

    @Test
    fun costPerDistanceUnitIsCostOverConvertedDistance() {
        // $0.72 / 20 mi = $0.036 per mile.
        assertEquals(0.036, CostSavingsPanelProjection.costPerDistanceUnit(6_000.0, twentyMilesMeters, prefs)!!, 1e-9)
    }

    @Test
    fun costPerDistanceUnitNullWhenDistanceNotPositive() {
        assertNull(CostSavingsPanelProjection.costPerDistanceUnit(6_000.0, 0.0, prefs))
    }

    // ── subtitle / label templates + currency formatting ────────────────────────────────────────────────

    @Test
    fun atRateEchoesSymbolAndRawRate() {
        assertEquals("at $0.12/kWh", CostSavingsPanelProjection.atRate(strings.atRateTemplate, prefs))
    }

    @Test
    fun atMpgEchoesRawEconomyWithoutTrailingZeros() {
        assertEquals("at 25 MPG", CostSavingsPanelProjection.atMpg(strings.atMpgTemplate, prefs))
        assertEquals("at 32.5 MPG", CostSavingsPanelProjection.atMpg(strings.atMpgTemplate, prefs.copy(gasEfficiencyMpg = 32.5)))
    }

    @Test
    fun formatCurrencyAppliesSymbolGroupingAndSafeNumberGuard() {
        assertEquals("$1,234.50", CostSavingsPanelProjection.formatCurrency(1_234.5, prefs))
        // Web `safeNumber` coerces a non-finite cost to 0 rather than rendering "NaN".
        assertEquals("$0.00", CostSavingsPanelProjection.formatCurrency(Double.NaN, prefs))
    }

    @Test
    fun accessibilityLabelJoinsLabelValueAndOptionalDetail() {
        assertEquals("Trip Cost: $0.72", CostSavingsPanelProjection.accessibilityLabel("Trip Cost", "$0.72", null))
        assertEquals(
            "Trip Cost: $0.72, at $0.12/kWh",
            CostSavingsPanelProjection.accessibilityLabel("Trip Cost", "$0.72", "at $0.12/kWh"),
        )
    }

    // ── CostSavingsDisplayPrefs.from(/settings) ─────────────────────────────────────────────────────────

    @Test
    fun displayPrefsDefaultsMatchWebColdStart() {
        val d = CostSavingsDisplayPrefs.DEFAULT
        assertEquals("$", d.currencySymbol)
        assertEquals(2, d.precision)
        assertEquals(0.12, d.costPerKwh, 1e-9)
        assertEquals(25.0, d.gasEfficiencyMpg, 1e-9)
        assertEquals(0.0, d.gasPricePerUnit, 1e-9)
        assertFalse(d.gasUnitIsLiter)
        assertEquals(DistanceUnitPref.KM, d.distancePref)
    }

    @Test
    fun displayPrefsReadEverySettingsField() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "€")
                put("decimal_precision", 3)
                put("base_cost_per_kwh", 0.2)
                put("gas_efficiency_mpg", 30.0)
                put("gas_price_per_unit", 4.5)
                put("gas_unit", "liter")
                put("unit_of_length", "mi")
                put("locale", "de-DE")
            }
        val p = CostSavingsDisplayPrefs.from(settings)
        assertEquals("€", p.currencySymbol)
        assertEquals(3, p.precision)
        assertEquals(0.2, p.costPerKwh, 1e-9)
        assertEquals(30.0, p.gasEfficiencyMpg, 1e-9)
        assertEquals(4.5, p.gasPricePerUnit, 1e-9)
        assertTrue(p.gasUnitIsLiter)
        assertEquals(DistanceUnitPref.MI, p.distancePref)
        assertEquals("mi", p.distanceLabel)
        assertEquals(Locale.forLanguageTag("de-DE"), p.locale)
    }

    @Test
    fun displayPrefsBlankCurrencyFallsBackToDollar() {
        val p = CostSavingsDisplayPrefs.from(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", p.currencySymbol)
    }
}
