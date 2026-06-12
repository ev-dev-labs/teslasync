package io.teslasync.android.featureviews.summaryherocards

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SummaryHeroCards pure projection — the native port of the web component's
 * `({ metrics, funFact })` render contract
 * (web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx): the (snapshot, isLoading)
 * lifecycle adapter, the ordered five-or-six card list with the web `fmtNumber` / `fmtInt` formatting and the
 * hard-coded km / kWh / kg unit suffixes, the `formatCurrency` cost, the `trendFor` badges (including the
 * `invertPositive` energy/cost inversion and the flat "0%" cutoff), the symbol-only Fun Fact subtitle, the
 * settings-derived display preferences, and the PII-safe `view.opened` diagnostic. Runs in the
 * :app:testReleaseUnitTest gate; no Compose, no device.
 */
class SummaryHeroCardsProjectionTest {
    private val prefs = SummaryHeroDisplayPrefs(currencySymbol = "$", precision = 2, locale = Locale.US)

    private val strings =
        SummaryHeroStrings(
            totalDistance = "Total Distance",
            totalDrives = "Total Drives",
            energyUsed = "Energy Used",
            chargingCost = "Charging Cost",
            co2Saved = "CO\u2082 Saved",
            funFact = "Fun Fact",
        )

    private val metrics =
        WeekSummaryMetrics(
            totalDistance = 312.6,
            prevDistance = 280.0,
            totalDrives = 14.0,
            prevDriveCount = 11.0,
            energyUsed = 78.4,
            prevEnergy = 70.0,
            chargingCost = 24.18,
            prevChargingCost = 30.0,
            co2Saved = 41.2,
            prevCo2 = 38.0,
        )

    private val funFact = FunFactSummary(from = "San Francisco", to = "Los Angeles", times = "0.8")

    private fun cards(
        snapshot: WeekSummarySnapshot,
        prefs: SummaryHeroDisplayPrefs = this.prefs,
    ): Map<SummaryHeroIcon, SummaryHeroCard> = SummaryHeroCardsProjection.cards(snapshot, prefs, strings).associateBy { it.icon }

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
        val state = SummaryHeroCardsProjection.projectUiState(WeekSummarySnapshot(metrics, funFact), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val snapshot = WeekSummarySnapshot(metrics, funFact)
        val state = SummaryHeroCardsProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = SummaryHeroCardsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    // ── cards: order + presence of the optional Fun Fact card (web `funFact && …`) ──────────────────────

    @Test
    fun cardsAreInWebSourceOrderWithFunFact() {
        val order = SummaryHeroCardsProjection.cards(WeekSummarySnapshot(metrics, funFact), prefs, strings).map { it.icon }
        assertEquals(
            listOf(
                SummaryHeroIcon.Distance,
                SummaryHeroIcon.Drives,
                SummaryHeroIcon.Energy,
                SummaryHeroIcon.Cost,
                SummaryHeroIcon.Co2,
                SummaryHeroIcon.FunFact,
            ),
            order,
        )
    }

    @Test
    fun funFactCardIsOmittedWhenAbsent() {
        val list = SummaryHeroCardsProjection.cards(WeekSummarySnapshot(metrics, funFact = null), prefs, strings)
        assertEquals(5, list.size)
        assertEquals(SummaryHeroIcon.Co2, list.last().icon)
        assertTrue(list.none { it.icon == SummaryHeroIcon.FunFact })
    }

    // ── cards: labels, formatted values, hard-coded units, colors (web HighlightCard props) ─────────────

    @Test
    fun metricCardsCarryLabelsValuesAndColors() {
        val byIcon = cards(WeekSummarySnapshot(metrics, funFact))

        val distance = byIcon.getValue(SummaryHeroIcon.Distance)
        assertEquals("Total Distance", distance.label)
        assertEquals("312.6 km", distance.value)
        assertEquals(SummaryHeroColor.Cyan, distance.color)

        val drives = byIcon.getValue(SummaryHeroIcon.Drives)
        assertEquals("14", drives.value)
        assertEquals(SummaryHeroColor.Green, drives.color)

        val energy = byIcon.getValue(SummaryHeroIcon.Energy)
        assertEquals("78.4 kWh", energy.value)
        assertEquals(SummaryHeroColor.Purple, energy.color)

        val cost = byIcon.getValue(SummaryHeroIcon.Cost)
        assertEquals("$24.18", cost.value)
        assertEquals(SummaryHeroColor.Amber, cost.color)

        val co2 = byIcon.getValue(SummaryHeroIcon.Co2)
        assertEquals("41.2 kg", co2.value)
        assertEquals(SummaryHeroColor.Green, co2.color)
    }

    @Test
    fun metricCardsHaveNoSubtitleAndCarryTrend() {
        val byIcon = cards(WeekSummarySnapshot(metrics, funFact))
        // The five metric cards carry a trend badge and no subtitle (web HighlightCard `change`, no `subtitle`).
        listOf(
            SummaryHeroIcon.Distance,
            SummaryHeroIcon.Drives,
            SummaryHeroIcon.Energy,
            SummaryHeroIcon.Cost,
            SummaryHeroIcon.Co2,
        ).forEach { icon ->
            assertNull(byIcon.getValue(icon).subtitle)
            assertNotNull(byIcon.getValue(icon).trend)
        }
    }

    @Test
    fun funFactCardHasSubtitleNoTrendAndTimesValue() {
        val card = cards(WeekSummarySnapshot(metrics, funFact)).getValue(SummaryHeroIcon.FunFact)
        assertNull(card.trend)
        assertEquals("Fun Fact", card.label)
        assertEquals(SummaryHeroColor.Cyan, card.color)
        // Web `value={`${funFact.times}×`}`.
        assertEquals("0.8\u00D7", card.value)
        // Web `t('…funFactDesc', '≈ {{times}}× {{from}} → {{to}}', …)` rendered output.
        assertEquals("\u2248 0.8\u00D7 San Francisco \u2192 Los Angeles", card.subtitle)
    }

    // ── cards: trendFor badges (direction, value, positive) including the invertPositive quirk ──────────

    @Test
    fun risingNonInvertedMetricIsPositiveUp() {
        val distance = cards(WeekSummarySnapshot(metrics, funFact)).getValue(SummaryHeroIcon.Distance).trend!!
        assertEquals(TrendDirection.Up, distance.direction)
        assertEquals("+11.6%", distance.value)
        assertTrue(distance.positive)
    }

    @Test
    fun risingInvertedEnergyIsNegativeButStillUp() {
        // Web `trendFor(energyUsed, prevEnergy, true)`: energy rose, so the value carries a '+' and an up
        // direction, but `positive` is inverted to false (a rising energy bill reads as a bad change).
        val energy = cards(WeekSummarySnapshot(metrics, funFact)).getValue(SummaryHeroIcon.Energy).trend!!
        assertEquals(TrendDirection.Up, energy.direction)
        assertEquals("+12.0%", energy.value)
        assertFalse(energy.positive)
    }

    @Test
    fun fallingInvertedCostIsPositiveButStillDown() {
        // Web `trendFor(chargingCost, prevChargingCost, true)`: cost fell, so the value is negative and the
        // direction is down, but `positive` is inverted to true (a falling bill reads as a good change).
        val cost = cards(WeekSummarySnapshot(metrics, funFact)).getValue(SummaryHeroIcon.Cost).trend!!
        assertEquals(TrendDirection.Down, cost.direction)
        assertEquals("-19.4%", cost.value)
        assertTrue(cost.positive)
    }

    @Test
    fun flatChangeRendersZeroPercentPositive() {
        val badge = SummaryHeroCardsProjection.trendFor(100.0, 100.0, invertPositive = false, locale = Locale.US)
        assertEquals(TrendDirection.Flat, badge.direction)
        assertEquals("0%", badge.value)
        assertTrue(badge.positive)
    }

    @Test
    fun pctChangeHandlesZeroBaseline() {
        assertEquals(100.0, SummaryHeroCardsProjection.pctChange(5.0, 0.0), 0.0)
        assertEquals(0.0, SummaryHeroCardsProjection.pctChange(0.0, 0.0), 0.0)
        assertEquals(0.0, SummaryHeroCardsProjection.pctChange(-3.0, 0.0), 0.0)
    }

    // ── values: locale grouping + hard-coded (unconverted) units ────────────────────────────────────────

    @Test
    fun valuesUseLocaleGroupingAndKeepMetricUnits() {
        val large = metrics.copy(totalDistance = 1234.5, energyUsed = 2048.0, co2Saved = 1000.0)
        val us = cards(WeekSummarySnapshot(large, funFact = null))
        assertEquals("1,234.5 km", us.getValue(SummaryHeroIcon.Distance).value)
        assertEquals("2,048.0 kWh", us.getValue(SummaryHeroIcon.Energy).value)
        assertEquals("1,000.0 kg", us.getValue(SummaryHeroIcon.Co2).value)

        // The web hard-codes km/kWh/kg regardless of unit preference; the surface carries no distance unit, so
        // a German locale only changes the grouping/decimal separators — never the unit suffix.
        val german = cards(WeekSummarySnapshot(large, funFact = null), prefs.copy(locale = Locale.GERMANY))
        assertEquals("1.234,5 km", german.getValue(SummaryHeroIcon.Distance).value)
    }

    @Test
    fun formatCurrencyUsesResolvedSymbolAndPrecision() {
        val euro = SummaryHeroDisplayPrefs(currencySymbol = "\u20AC", precision = 0, locale = Locale.US)
        // The cost card always passes 2 decimals (web `formatCurrency(metrics.chargingCost, 2)`).
        assertEquals("\u20AC24.18", cards(WeekSummarySnapshot(metrics, funFact = null), euro).getValue(SummaryHeroIcon.Cost).value)
        // The bare helper defaults to the user's precision when a call omits its own.
        assertEquals("\u20AC1,000", SummaryHeroCardsProjection.formatCurrency(1000.0, euro))
    }

    // ── SummaryHeroDisplayPrefs.from (web useFormatting/useUnits settings derivation) ────────────────────

    @Test
    fun displayPrefsDefaultToDollarTwoDpEnUs() {
        val defaults = SummaryHeroDisplayPrefs.from(null)
        assertEquals("$", defaults.currencySymbol)
        assertEquals(2, defaults.precision)
        assertEquals(Locale.forLanguageTag("en-US"), defaults.locale)
        assertEquals(defaults, SummaryHeroDisplayPrefs.DEFAULT)
    }

    @Test
    fun displayPrefsResolveFromSettingsDocument() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "\u20AC")
                put("decimal_precision", 1)
                put("locale", "de-DE")
            }
        val resolved = SummaryHeroDisplayPrefs.from(settings)
        assertEquals("\u20AC", resolved.currencySymbol)
        assertEquals(1, resolved.precision)
        assertEquals(Locale.forLanguageTag("de-DE"), resolved.locale)
    }

    @Test
    fun blankCurrencySymbolFallsBackToDollar() {
        val settings = buildJsonObject { put("currency_symbol", "   ") }
        assertEquals("$", SummaryHeroDisplayPrefs.from(settings).currencySymbol)
    }

    @Test
    fun nonObjectSettingsFallBackToDefaults() {
        // A JSON primitive (not the expected object) resolves to the cold-start defaults rather than throwing.
        val resolved = SummaryHeroDisplayPrefs.from(JsonPrimitive("not-an-object"))
        assertEquals("$", resolved.currencySymbol)
        assertEquals(2, resolved.precision)
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        SummaryHeroCardsDiagnostics.recordViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SummaryHeroCards"), opened.single().second)
        assertEquals("SummaryHeroCards", SummaryHeroCardsDiagnostics.SLUG)
    }
}
