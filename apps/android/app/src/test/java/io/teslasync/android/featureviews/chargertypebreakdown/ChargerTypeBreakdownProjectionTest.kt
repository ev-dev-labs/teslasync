package io.teslasync.android.featureviews.chargertypebreakdown

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChargerTypeBreakdown's pure logic — the native analogue of the web
 * component's derivations (web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx): the
 * `CHARGER_COLORS[name] ?? CHART_COLORS[4]` color resolution, the share `(cost / totalCost) * 100`, the
 * proportional `<Pie dataKey="cost">` sweep, the per-row cost·sessions / energy / cost-per-kWh / percent
 * strings (with the `entry.energy > 0 ? … : '—'` guard), the `data.length === 0` empty branch, the currency
 * derivation from `/settings` (web `useFormatting`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ChargerTypeBreakdownProjectionTest {
    private val formatters =
        ChargerTypeBreakdownFormatters(
            currency = { amount, decimals -> "C($amount|$decimals)" },
            count = { "N($it)" },
            energy = { "E($it)" },
            percent = { "P($it)" },
        )

    private val data =
        listOf(
            ChargerTypeDatum(name = "Supercharger", cost = 50.0, energyKwh = 200.0, sessions = 10),
            ChargerTypeDatum(name = "Home", cost = 25.0, energyKwh = 250.0, sessions = 20),
            ChargerTypeDatum(name = "Public DC", cost = 0.0, energyKwh = 0.0, sessions = 2),
        )

    // ── Color resolution (web CHARGER_COLORS[name] ?? CHART_COLORS[4]) ─────────────

    @Test
    fun colorRoleMapsEachCostAnalysisCategoryToItsHue() {
        assertEquals(ChargerColorRole.Supercharger, ChargerTypeBreakdownProjection.colorRole("Supercharger"))
        assertEquals(ChargerColorRole.PublicDc, ChargerTypeBreakdownProjection.colorRole("Public DC"))
        assertEquals(ChargerColorRole.WorkL2, ChargerTypeBreakdownProjection.colorRole("Work / L2"))
        assertEquals(ChargerColorRole.Home, ChargerTypeBreakdownProjection.colorRole("Home"))
    }

    @Test
    fun colorRoleFoldsUnknownNamesToTheFallback() {
        assertEquals(ChargerColorRole.Fallback, ChargerTypeBreakdownProjection.colorRole("EVgo"))
        assertEquals(ChargerColorRole.Fallback, ChargerTypeBreakdownProjection.colorRole("Other"))
        assertEquals(ChargerColorRole.Fallback, ChargerTypeBreakdownProjection.colorRole(""))
    }

    @Test
    fun colorRoleTrimsBeforeMatching() {
        assertEquals(ChargerColorRole.Home, ChargerTypeBreakdownProjection.colorRole("  Home  "))
    }

    // ── Projection (web per-entry derivations) ─────────────────────────────────────

    @Test
    fun projectBuildsRowsInOrderWithSharesSweepsAndStrings() {
        val result = ChargerTypeBreakdownProjection.project(data, totalCost = 100.0, formatters = formatters, sessionsLabel = "sessions")

        assertFalse(result.isEmpty)
        assertEquals(listOf("Supercharger", "Home", "Public DC"), result.rows.map { it.name })
        assertEquals(
            listOf(ChargerColorRole.Supercharger, ChargerColorRole.Home, ChargerColorRole.PublicDc),
            result.rows.map { it.colorRole },
        )

        val supercharger = result.rows[0]
        // Share uses totalCost (web `(cost / totalCost) * 100`): 50 / 100 * 100 = 50.
        assertEquals(50.0, supercharger.pct, 0.0)
        // Pie sweep uses the charted-cost sum (web `<Pie dataKey="cost">`): 50 / 75.
        assertEquals(50.0 / 75.0, supercharger.pieFraction, 1e-9)
        assertEquals("C(50.0|2) $MIDDOT N(10) sessions", supercharger.costSessionsText)
        assertEquals("E(200.0)", supercharger.energyText)
        assertEquals("C(0.25|3)$PER_KWH_SUFFIX", supercharger.rateText)
        assertEquals("P(50.0)$PERCENT_SUFFIX", supercharger.percentText)
        assertEquals(
            "Supercharger, C(50.0|2) $MIDDOT N(10) sessions, E(200.0), C(0.25|3)/kWh, P(50.0)%",
            supercharger.accessibilityText,
        )

        val home = result.rows[1]
        assertEquals(25.0, home.pct, 0.0)
        assertEquals(25.0 / 75.0, home.pieFraction, 1e-9)
        assertEquals("C(0.1|3)$PER_KWH_SUFFIX", home.rateText)
    }

    @Test
    fun projectShowsEmDashRateWhenEnergyIsNonPositive() {
        val result = ChargerTypeBreakdownProjection.project(data, totalCost = 100.0, formatters = formatters, sessionsLabel = "sessions")

        val publicDc = result.rows[2]
        assertEquals(EM_DASH, publicDc.rateText)
        assertEquals(0.0, publicDc.pct, 0.0)
        assertEquals(0.0, publicDc.pieFraction, 0.0)
        assertEquals("C(0.0|2) $MIDDOT N(2) sessions", publicDc.costSessionsText)
    }

    @Test
    fun projectClampsShareToZeroWhenTotalCostIsNonPositive() {
        val result =
            ChargerTypeBreakdownProjection.project(
                listOf(ChargerTypeDatum(name = "Home", cost = 50.0, energyKwh = 100.0, sessions = 3)),
                totalCost = 0.0,
                formatters = formatters,
                sessionsLabel = "sessions",
            )

        assertEquals(0.0, result.rows.single().pct, 0.0)
        // The pie still fills (sweep uses the charted-cost sum, not totalCost): single slice → fraction 1.
        assertEquals(1.0, result.rows.single().pieFraction, 0.0)
    }

    @Test
    fun projectReturnsEmptyResultForNoData() {
        val result =
            ChargerTypeBreakdownProjection.project(
                emptyList(),
                totalCost = 0.0,
                formatters = formatters,
                sessionsLabel = "sessions",
            )

        assertTrue(result.isEmpty)
        assertTrue(result.rows.isEmpty())
    }

    // ── Currency settings (web useFormatting currency derivation) ──────────────────

    @Test
    fun currencyFromDefaultsWhenAbsentOrBlank() {
        assertEquals("$", ChargerCurrencySettings.from(null).resolvedSymbol)
        assertEquals("$", ChargerCurrencySettings.from(JsonPrimitive("not-an-object")).resolvedSymbol)
        assertEquals("$", ChargerCurrencySettings.from(JsonObject(emptyMap())).resolvedSymbol)
        assertEquals(
            "$",
            ChargerCurrencySettings.from(JsonObject(mapOf("currency_symbol" to JsonPrimitive("  ")))).resolvedSymbol,
        )
    }

    @Test
    fun currencyFromReadsTheConfiguredSymbol() {
        assertEquals(
            "\u20AC",
            ChargerCurrencySettings.from(JsonObject(mapOf("currency_symbol" to JsonPrimitive("\u20AC")))).resolvedSymbol,
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        ChargerTypeBreakdownDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChargerTypeBreakdown"), fields)
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
}
