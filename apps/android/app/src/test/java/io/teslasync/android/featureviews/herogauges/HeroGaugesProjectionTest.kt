package io.teslasync.android.featureviews.herogauges

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonNull
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
 * Off-device verification of the HeroGauges' pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/analytics/HeroGauges.tsx): the SI-floored distance
 * conversion, the km-tied gas-savings (clamped at zero) and CO2 heuristics, the Wh/mi-vs-Wh/km efficiency
 * branch, the raw kWh energy / `fmtInt` drive count, and the `useFormatting` currency formatting. Because the
 * surface is purely presentational, each [HeroGaugesDisplay] is exactly what the thin composable renders, so
 * these assertions double as the per-state "snapshot"; the non-blank label/value checks additionally verify
 * every card stays accessible (TalkBack-readable) in every state.
 */
class HeroGaugesProjectionTest {
    private val strings =
        HeroGaugesStrings(
            distance = "Distance",
            drives = "Drives",
            energy = "Energy",
            efficiency = "Efficiency",
            gasSavings = "Gas Savings",
            co2Saved = "CO\u2082 Saved",
        )

    private val metricPrefs = HeroGaugesDisplayPrefs(DistanceUnitPref.KM, "$", 2, Locale.US)
    private val imperialPrefs = HeroGaugesDisplayPrefs(DistanceUnitPref.MI, "$", 2, Locale.US)

    private val sample =
        FleetAnalyticsSummary(
            totalDistanceKm = 1000.0,
            totalCost = 50.0,
            avgEfficiencyWhKm = 150.0,
            totalDrives = 42.0,
            totalEnergyKwh = 200.0,
        )

    // ── project(): per-state ──────────────────────────────────────────────────────

    @Test
    fun nullDataProjectsTheLoadingBranchWithNoCards() {
        val display = HeroGaugesProjection.project(data = null, prefs = metricPrefs, strings = strings)

        assertTrue(display.loading)
        assertTrue(display.cards.isEmpty())
    }

    @Test
    fun resolvedMetricPayloadProjectsEveryCard() {
        val cards = HeroGaugesProjection.project(sample, metricPrefs, strings).cards

        assertEquals(HeroGaugesProjection.CARD_COUNT, cards.size)

        assertEquals(
            HeroGaugeCard("Distance", "1,000.0", "km", HeroGaugeIcon.Distance, HeroGaugeAccent.Info),
            cards[0],
        )
        assertEquals(
            HeroGaugeCard("Drives", "42", null, HeroGaugeIcon.Drives, HeroGaugeAccent.Power),
            cards[1],
        )
        assertEquals(
            HeroGaugeCard("Energy", "200.0", "kWh", HeroGaugeIcon.Energy, HeroGaugeAccent.Success),
            cards[2],
        )
        assertEquals(
            HeroGaugeCard("Efficiency", "150.0", "Wh/km", HeroGaugeIcon.Efficiency, HeroGaugeAccent.Warning),
            cards[3],
        )
        // 1000 * 0.085 * 1.5 - 50 = 77.5, clamped >= 0, 0 dp, "$" prefix (77.5 rounds half-up to 78).
        assertEquals(
            HeroGaugeCard("Gas Savings", "$78", null, HeroGaugeIcon.GasSavings, HeroGaugeAccent.Success),
            cards[4],
        )
        // 1000 * 0.12 = 120 kg.
        assertEquals(
            HeroGaugeCard("CO\u2082 Saved", "120", "kg", HeroGaugeIcon.Co2, HeroGaugeAccent.Success),
            cards[5],
        )
    }

    @Test
    fun resolvedImperialPayloadConvertsDistanceAndEfficiency() {
        val cards = HeroGaugesProjection.project(sample, imperialPrefs, strings).cards

        // 1000 km -> 1,000,000 m / 1609.344 = 621.371... -> "621.4 mi".
        assertEquals("621.4", cards[0].value)
        assertEquals("mi", cards[0].subtitle)
        // Wh/km -> Wh/mi: 150 * 1.609344 = 241.4016 -> "241.4 Wh/mi".
        assertEquals("241.4", cards[3].value)
        assertEquals("Wh/mi", cards[3].subtitle)
    }

    @Test
    fun resolvedEmptyPayloadRendersFormattedZerosNeverBlank() {
        // Web: a present-but-empty payload renders the cards with `?? 0` zeros — never a hidden/blank tile.
        val zeros = FleetAnalyticsSummary(0.0, 0.0, 0.0, 0.0, 0.0)

        val cards = HeroGaugesProjection.project(zeros, metricPrefs, strings).cards

        assertEquals(HeroGaugesProjection.CARD_COUNT, cards.size)
        assertEquals("0.0", cards[0].value)
        assertEquals("0", cards[1].value)
        assertEquals("0.0", cards[2].value)
        assertEquals("0.0", cards[3].value)
        assertEquals("$0", cards[4].value)
        assertEquals("0", cards[5].value)
    }

    @Test
    fun gasSavingsClampsNegativeToZero() {
        // Web `Math.max(gasSavings, 0)`: when recorded cost exceeds the gas estimate, the card shows "$0".
        val costly = sample.copy(totalDistanceKm = 10.0, totalCost = 1000.0)

        val cards = HeroGaugesProjection.project(costly, metricPrefs, strings).cards

        assertEquals("$0", cards[4].value)
    }

    @Test
    fun everyCardCarriesANonBlankLabelAndValue() {
        // Accessibility: each MetricCard exposes a label + value to TalkBack; none may be blank in any state.
        listOf(
            HeroGaugesProjection.project(sample, metricPrefs, strings),
            HeroGaugesProjection.project(sample, imperialPrefs, strings),
            HeroGaugesProjection.project(FleetAnalyticsSummary(0.0, 0.0, 0.0, 0.0, 0.0), metricPrefs, strings),
        ).forEach { display ->
            assertEquals(HeroGaugesProjection.CARD_COUNT, display.cards.size)
            display.cards.forEach { card ->
                assertTrue("label must not be blank", card.label.isNotBlank())
                assertTrue("value must not be blank", card.value.isNotBlank())
            }
        }
    }

    // ── formatCurrency(): web `useFormatting().formatCurrency` ────────────────────

    @Test
    fun formatCurrencyDefaultsToUserPrecisionAndHonorsAnOverride() {
        // Default decimals == prefs.precision (web `decimals ?? userPrecision`).
        assertEquals("$12.00", HeroGaugesProjection.formatCurrency(12.0, metricPrefs))
        // Explicit decimals override (the gas-savings card uses 0).
        assertEquals("$12", HeroGaugesProjection.formatCurrency(12.0, metricPrefs, decimals = 0))
        // The resolved currency symbol is honored.
        val euro = HeroGaugesDisplayPrefs(DistanceUnitPref.KM, "\u20AC", 2, Locale.US)
        assertEquals("\u20AC5", HeroGaugesProjection.formatCurrency(5.0, euro, decimals = 0))
    }

    // ── FleetAnalyticsSummary.fromJson(): web `!data` + `?? 0` parity ─────────────

    @Test
    fun fromJsonTreatsNullAndJsonNullAsTheLoadingBranch() {
        assertNull(FleetAnalyticsSummary.fromJson(null))
        assertNull(FleetAnalyticsSummary.fromJson(JsonNull))
    }

    @Test
    fun fromJsonTreatsAnEmptyObjectAsResolvedZeros() {
        // Web `!data` only catches `undefined`; a populated (even empty) object renders the resolved grid.
        val summary = FleetAnalyticsSummary.fromJson(buildJsonObject {})

        assertNotNull(summary)
        assertEquals(0.0, summary!!.totalDistanceKm, 0.0)
        assertEquals(0.0, summary.totalCost, 0.0)
        assertEquals(0.0, summary.avgEfficiencyWhKm, 0.0)
        assertEquals(0.0, summary.totalDrives, 0.0)
        assertEquals(0.0, summary.totalEnergyKwh, 0.0)
    }

    @Test
    fun fromJsonParsesEveryField() {
        val summary =
            FleetAnalyticsSummary.fromJson(
                buildJsonObject {
                    put("total_distance_km", 1234.5)
                    put("total_cost", 67.0)
                    put("avg_efficiency_wh_km", 158.0)
                    put("total_drives", 99.0)
                    put("total_energy_kwh", 321.0)
                },
            )

        assertNotNull(summary)
        assertEquals(1234.5, summary!!.totalDistanceKm, 0.0)
        assertEquals(67.0, summary.totalCost, 0.0)
        assertEquals(158.0, summary.avgEfficiencyWhKm, 0.0)
        assertEquals(99.0, summary.totalDrives, 0.0)
        assertEquals(321.0, summary.totalEnergyKwh, 0.0)
    }

    // ── HeroGaugesDisplayPrefs.from(): web useUnits + useFormatting parity ────────

    @Test
    fun prefsDefaultIsMetricDollarTwoDpEnUs() {
        val prefs = HeroGaugesDisplayPrefs.DEFAULT

        assertEquals(DistanceUnitPref.KM, prefs.distanceUnit)
        assertEquals("$", prefs.currencySymbol)
        assertEquals(2, prefs.precision)
        assertEquals("en-US", prefs.locale.toLanguageTag())
    }

    @Test
    fun prefsFromSettingsDerivesUnitCurrencyPrecisionAndLocale() {
        val prefs =
            HeroGaugesDisplayPrefs.from(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3.0)
                    put("locale", "de-DE")
                },
            )

        assertEquals(DistanceUnitPref.MI, prefs.distanceUnit)
        assertEquals("\u20AC", prefs.currencySymbol)
        assertEquals(3, prefs.precision)
        assertEquals("de-DE", prefs.locale.toLanguageTag())
    }

    @Test
    fun prefsFromBlankCurrencyAndNegativePrecisionFallBackToWebDefaults() {
        val prefs =
            HeroGaugesDisplayPrefs.from(
                buildJsonObject {
                    put("currency_symbol", "   ")
                    put("decimal_precision", -1.0)
                },
            )

        assertEquals("$", prefs.currencySymbol)
        assertEquals(2, prefs.precision)
        assertFalse(prefs.distanceUnit == DistanceUnitPref.MI)
    }
}
