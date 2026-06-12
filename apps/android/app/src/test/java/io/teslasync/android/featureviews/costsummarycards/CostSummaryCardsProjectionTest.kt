package io.teslasync.android.featureviews.costsummarycards

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the CostSummaryCards pure projection — the native port of the web component's
 * `({ coreStats, gasPrice, distanceUnit, isMiles })` render contract
 * (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx): the `(snapshot, isLoading)`
 * lifecycle adapter, the ordered six-tile list with the web `formatCurrency` / `fmtWithUnit` / `fmtNumber` /
 * `fmtInt` formatting and the hard-coded kWh / gal-equiv unit suffixes and per / vs connectors, the per-tile
 * glow + icon accent, the Cost-Per distance-word substitution, the settings-derived display preferences
 * (currency, precision, locale, gas-unit label), and the PII-safe `view.opened` diagnostic. Runs in the
 * :app:testReleaseUnitTest gate; no Compose, no device.
 */
class CostSummaryCardsProjectionTest {
    private val prefs =
        CostSummaryDisplayPrefs(currencySymbol = "$", precision = 2, locale = Locale.US, gasUnitLabel = "gal")

    // The web `costAnalysis.stats.costPerDist` resource is the positional template "Cost Per %1$s".
    private val strings =
        CostSummaryStrings(
            totalCost = "Total Cost",
            sessions = "sessions",
            avgPerKwh = "Avg \$/kWh",
            blendedRate = "blended rate",
            costPerDistTemplate = "Cost Per %1\$s",
            totalEnergy = "Total Energy",
            gasSavings = "Gas Savings $",
            savingsPercent = "Savings %",
            vsGasoline = "vs gasoline",
        )

    private val stats =
        CostSummaryStats(
            totalCost = 248.37,
            count = 42,
            avgCostPerKwh = 0.142,
            costPerDist = 0.061,
            totalEnergy = 1748.6,
            gallonsEquiv = 52.4,
            savings = 186.12,
            savingsPercent = 42.8,
        )

    private val snapshot = CostSummarySnapshot(stats = stats, gasPrice = 3.59, distanceUnit = "mi", isMiles = true)

    private fun cards(
        snap: CostSummarySnapshot = snapshot,
        prefs: CostSummaryDisplayPrefs = this.prefs,
    ): List<CostSummaryCard> = CostSummaryCardsProjection.cards(snap, prefs, strings)

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

    // ── (snapshot, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        val state = CostSummaryCardsProjection.projectUiState(snapshot, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val state = CostSummaryCardsProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = CostSummaryCardsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun staleContentSurfacesAsOfflineLastKnownWithRetry() {
        // The composable keeps the cards visible and shows a freshness chip when content is stale + errored.
        val state =
            CostSummaryCardsProjection
                .projectUiState(snapshot, isLoading = false)
                .copy(stale = true, errorKind = io.teslasync.android.data.ErrorKind.Network)
        assertTrue(state.isOffline)
        assertTrue(state.hasError)
        assertTrue(state.canRetry)
        assertFalse(state.isError)
    }

    // ── cards: order, count, glow, icon tone, icon glyph (web StatBox props) ────────────────────────────

    @Test
    fun sixCardsInWebSourceOrder() {
        val icons = cards().map { it.icon }
        assertEquals(
            listOf(
                CostStatIcon.Dollar,
                CostStatIcon.Zap,
                CostStatIcon.Car,
                CostStatIcon.Zap,
                CostStatIcon.Fuel,
                CostStatIcon.TrendingDown,
            ),
            icons,
        )
    }

    @Test
    fun glowAndIconTonesMatchWebSource() {
        val list = cards()
        assertEquals(
            listOf(
                CostStatGlow.Cyan,
                CostStatGlow.None,
                CostStatGlow.None,
                CostStatGlow.Green,
                CostStatGlow.Green,
                CostStatGlow.Green,
            ),
            list.map { it.glow },
        )
        assertEquals(
            listOf(
                CostStatIconTone.Cyan,
                CostStatIconTone.Yellow,
                CostStatIconTone.Blue,
                CostStatIconTone.Green,
                CostStatIconTone.Red,
                CostStatIconTone.Emerald,
            ),
            list.map { it.iconTone },
        )
    }

    // ── cards: labels, formatted values, composed subtitles ─────────────────────────────────────────────

    @Test
    fun totalCostCardCarriesCurrencyValueAndSessionSubtitle() {
        val card = cards()[0]
        assertEquals("Total Cost", card.label)
        assertEquals("\$248.37", card.value)
        // Web `${fmtInt(count)} ${t('…sessions')}`.
        assertEquals("42 sessions", card.sub)
    }

    @Test
    fun avgPerKwhCardUsesThreeDecimalsAndBlendedRateSubtitle() {
        val card = cards()[1]
        assertEquals("Avg \$/kWh", card.label)
        // Web `formatCurrency(avgCostPerKwh, 3)`.
        assertEquals("\$0.142", card.value)
        assertEquals("blended rate", card.sub)
    }

    @Test
    fun costPerDistanceCardSubstitutesMileWordAndPerUnitSubtitle() {
        val card = cards()[2]
        // Web `t('…costPerDist', { unit: isMiles ? 'Mile' : 'km' })` → "Cost Per Mile".
        assertEquals("Cost Per Mile", card.label)
        assertEquals("\$0.061", card.value)
        // Web `per ${distanceUnit}` with the abbreviated unit.
        assertEquals("per mi", card.sub)
    }

    @Test
    fun costPerDistanceCardUsesKmWhenMetric() {
        val metric = snapshot.copy(distanceUnit = "km", isMiles = false)
        val card = cards(metric)[2]
        assertEquals("Cost Per km", card.label)
        assertEquals("per km", card.sub)
    }

    @Test
    fun totalEnergyCardCarriesKwhValueAndGalEquivSubtitle() {
        val card = cards()[3]
        assertEquals("Total Energy", card.label)
        // Web `fmtWithUnit(totalEnergy, 'kWh', 1)` with locale grouping.
        assertEquals("1,748.6 kWh", card.value)
        // Web `fmtWithUnit(gallonsEquiv, 'gal equiv', 1)`.
        assertEquals("52.4 gal equiv", card.sub)
    }

    @Test
    fun gasSavingsCardCarriesCurrencyValueAndVsPriceSubtitle() {
        val card = cards()[4]
        assertEquals("Gas Savings $", card.label)
        assertEquals("\$186.12", card.value)
        // Web `vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`.
        assertEquals("vs \$3.59/gal", card.sub)
    }

    @Test
    fun savingsPercentCardCarriesPercentValueAndVsGasolineSubtitle() {
        val card = cards()[5]
        assertEquals("Savings %", card.label)
        // Web `${fmtNumber(savingsPercent, 1)}%`.
        assertEquals("42.8%", card.value)
        assertEquals("vs gasoline", card.sub)
    }

    // ── values: locale grouping + safeNumber (non-finite → 0) guard ─────────────────────────────────────

    @Test
    fun valuesUseLocaleGroupingAndCurrencySymbol() {
        val euro = prefs.copy(currencySymbol = "\u20AC", locale = Locale.GERMANY)
        val large = stats.copy(totalCost = 12345.6, totalEnergy = 2048.0)
        val list = cards(snapshot.copy(stats = large), euro)
        // German grouping/decimal separators; the currency symbol is the resolved one.
        assertEquals("\u20AC12.345,60", list[0].value)
        assertEquals("2.048,0 kWh", list[3].value)
    }

    @Test
    fun nonFiniteFiguresRenderAsZeroNotEmDash() {
        // Web `safeNumber` maps NaN/Infinity to 0 before formatting (never the ChartFormat em-dash).
        val broken = stats.copy(totalCost = Double.NaN, savingsPercent = Double.POSITIVE_INFINITY)
        val list = cards(snapshot.copy(stats = broken))
        assertEquals("\$0.00", list[0].value)
        assertEquals("0.0%", list[5].value)
    }

    // ── helpers: costPerDistanceLabel / gasSavingsSub / formatCurrency ──────────────────────────────────

    @Test
    fun costPerDistanceLabelSubstitutesPositionalUnitWord() {
        assertEquals("Cost Per Mile", CostSummaryCardsProjection.costPerDistanceLabel("Cost Per %1\$s", isMiles = true, Locale.US))
        assertEquals("Cost Per km", CostSummaryCardsProjection.costPerDistanceLabel("Cost Per %1\$s", isMiles = false, Locale.US))
    }

    @Test
    fun gasSavingsSubHonorsLitreGasUnitLabel() {
        val litre = prefs.copy(gasUnitLabel = "L")
        assertEquals("vs \$3.59/L", CostSummaryCardsProjection.gasSavingsSub(3.59, litre))
    }

    @Test
    fun formatCurrencyDefaultsToUserPrecisionAndResolvedSymbol() {
        val euro = CostSummaryDisplayPrefs(currencySymbol = "\u20AC", precision = 0, locale = Locale.US, gasUnitLabel = "gal")
        // The bare helper defaults to the user's precision when a call omits its own.
        assertEquals("\u20AC1,000", CostSummaryCardsProjection.formatCurrency(1000.0, euro))
        // An explicit decimals argument overrides it (the per-tile web calls pass 2 / 3).
        assertEquals("\u20AC1,000.000", CostSummaryCardsProjection.formatCurrency(1000.0, euro, decimals = 3))
    }

    // ── CostSummaryDisplayPrefs.from (web useFormatting/useSettings derivation) ─────────────────────────

    @Test
    fun displayPrefsDefaultToDollarTwoDpEnUsGallon() {
        val defaults = CostSummaryDisplayPrefs.from(null)
        assertEquals("$", defaults.currencySymbol)
        assertEquals(2, defaults.precision)
        assertEquals(Locale.forLanguageTag("en-US"), defaults.locale)
        assertEquals("gal", defaults.gasUnitLabel)
        assertEquals(defaults, CostSummaryDisplayPrefs.DEFAULT)
    }

    @Test
    fun displayPrefsResolveFromSettingsDocument() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "\u20AC")
                put("decimal_precision", 1)
                put("locale", "de-DE")
                put("gas_unit", "liter")
            }
        val resolved = CostSummaryDisplayPrefs.from(settings)
        assertEquals("\u20AC", resolved.currencySymbol)
        assertEquals(1, resolved.precision)
        assertEquals(Locale.forLanguageTag("de-DE"), resolved.locale)
        assertEquals("L", resolved.gasUnitLabel)
    }

    @Test
    fun gasUnitLabelDefaultsToGallonForNonLitreSettings() {
        val gallon = buildJsonObject { put("gas_unit", "gallon") }
        assertEquals("gal", CostSummaryDisplayPrefs.from(gallon).gasUnitLabel)
    }

    @Test
    fun blankCurrencySymbolFallsBackToDollar() {
        val settings = buildJsonObject { put("currency_symbol", "   ") }
        assertEquals("$", CostSummaryDisplayPrefs.from(settings).currencySymbol)
    }

    @Test
    fun nonObjectSettingsFallBackToDefaults() {
        // A JSON primitive (not the expected object) resolves to the cold-start defaults rather than throwing.
        val resolved = CostSummaryDisplayPrefs.from(JsonPrimitive("not-an-object"))
        assertEquals("$", resolved.currencySymbol)
        assertEquals(2, resolved.precision)
        assertEquals("gal", resolved.gasUnitLabel)
    }

    // ── Accessibility: every tile carries non-blank spoken content (the merged semantics node) ──────────

    @Test
    fun everyCardHasNonBlankLabelAndValueForTalkBack() {
        cards().forEach { card ->
            assertTrue("label must be non-blank for TalkBack", card.label.isNotBlank())
            assertTrue("value must be non-blank for TalkBack", card.value.isNotBlank())
        }
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        CostSummaryCardsDiagnostics.recordViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        // Only the surface slug — never a cost/energy/savings figure — so a diagnostics line leaks nothing.
        assertEquals(mapOf("surface" to "CostSummaryCards"), opened.single().second)
        assertEquals("CostSummaryCards", CostSummaryCardsDiagnostics.SLUG)
    }

    @Test
    fun diagnosticsCarryNoNumericPayload() {
        val logger = RecordingLogger()
        CostSummaryCardsDiagnostics.recordViewOpened(logger)
        val fields = logger.events.single().second
        assertNull(fields["totalCost"])
        assertNull(fields["savings"])
        assertFalse(fields.values.any { it.any(Char::isDigit) })
    }
}
