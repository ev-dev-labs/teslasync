package io.teslasync.android.featureviews.summarystatsgrid

import io.teslasync.android.data.ErrorKind
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
 * Off-device verification of the SummaryStatsGrid pure projection — the native port of the web component's
 * `({ stats })` render contract (web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx):
 * the `(stats, isLoading)` lifecycle adapter, the ordered six-tile list with the web `fmtInt` / `fmtNumber` /
 * `formatCurrency` formatting, the hard-coded kWh / kW / min unit suffixes kept in their own slot (the web
 * unit `<span>`), the settings-derived display preferences (currency symbol + precision + locale), the
 * non-finite → 0 `safeNumber` guard, the accessible non-blank tile content, and the PII-safe `view.opened`
 * diagnostic. Runs in the :app:testReleaseUnitTest gate; no Compose, no device.
 *
 * Together these cases cover the surface's adapter (every [UiPhase] the host can thread), each rendered state
 * (loading / content / empty / offline projection), the per-state tile values, and the accessibility label
 * contract the merged-semantics tiles expose to TalkBack.
 */
class SummaryStatsGridProjectionTest {
    private val prefs =
        SummaryStatsGridDisplayPrefs(currencySymbol = "$", precision = 2, locale = Locale.US)

    private val strings =
        SummaryStatsGridStrings(
            totalSessions = "Total Sessions",
            totalEnergy = "Total Energy",
            avgChargeRate = "Avg Charge Rate",
            peakRate = "Peak Rate",
            avgDuration = "Avg Duration",
            totalCost = "Total Cost",
        )

    private val stats =
        ChargingSummaryStats(
            totalSessions = 128,
            totalEnergy = 3421.5,
            avgRate = 48.2,
            peakRate = 122.6,
            avgDuration = 42.0,
            totalCost = 412.37,
        )

    private fun tiles(
        s: ChargingSummaryStats = stats,
        p: SummaryStatsGridDisplayPrefs = prefs,
    ): List<SummaryStatTile> = SummaryStatsGridProjection.tiles(s, p, strings)

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

    // ── (stats, isLoading) → lifecycle UiState adapter ──────────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithStats() {
        val state = SummaryStatsGridProjection.projectUiState(stats, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenStatsPresentAndNotLoading() {
        val state = SummaryStatsGridProjection.projectUiState(stats, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(stats, state.data)
    }

    @Test
    fun emptyWhenNoStatsAndNotLoading() {
        val state = SummaryStatsGridProjection.projectUiState(stats = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun staleContentSurfacesAsOfflineLastKnownWithRetry() {
        // The composable keeps the tiles visible and shows a freshness chip when content is stale + errored.
        val state =
            SummaryStatsGridProjection
                .projectUiState(stats, isLoading = false)
                .copy(stale = true, errorKind = ErrorKind.Network)
        assertTrue(state.isOffline)
        assertTrue(state.hasError)
        assertTrue(state.canRetry)
        assertFalse(state.isError)
    }

    // ── tiles: order, count, labels, units (web SummaryCard props) ──────────────────────────────────────

    @Test
    fun sixTilesInWebSourceOrder() {
        assertEquals(
            listOf("Total Sessions", "Total Energy", "Avg Charge Rate", "Peak Rate", "Avg Duration", "Total Cost"),
            tiles().map { it.label },
        )
    }

    @Test
    fun unitsAreSeparateFromValuesAndMatchTheWebSpans() {
        // The web renders each unit in its own small secondary `<span>`, so it must not be baked into the value.
        assertEquals(listOf(null, "kWh", "kW", "kW", "min", null), tiles().map { it.unit })
        tiles().forEachIndexed { index, tile ->
            val unit = tile.unit
            if (unit != null) {
                assertFalse("unit must not be duplicated inside the value of tile $index", tile.value.contains(unit))
            }
        }
    }

    // ── tiles: formatted values ─────────────────────────────────────────────────────────────────────────

    @Test
    fun valuesMatchTheWebFmtIntFmtNumberAndFormatCurrencyOutputs() {
        // Web: fmtInt(128) / fmtNumber(3421.5) kWh / fmtNumber(48.2) kW / fmtNumber(122.6) kW /
        // fmtInt(42) min / formatCurrency(412.37). Default precision 2; fmtInt is zero-decimal; US grouping.
        assertEquals(
            listOf("128", "3,421.50", "48.20", "122.60", "42", "$412.37"),
            tiles().map { it.value },
        )
    }

    @Test
    fun totalSessionsUsesGroupedZeroDecimalIntegerFormatting() {
        // Web `fmtInt(stats.totalSessions)` — fmtNumber(v, 0): grouped, zero fraction digits (NOT a bare count).
        val tile = tiles(stats.copy(totalSessions = 12345))[0]
        assertEquals("Total Sessions", tile.label)
        assertEquals("12,345", tile.value)
        assertNull(tile.unit)
    }

    @Test
    fun avgDurationRoundsAtTheDisplayBoundaryLikeFmtInt() {
        // Web `fmtInt(avgDuration)` rounds the fractional average (42.7 → "43"); the host passes it raw.
        val tile = tiles(stats.copy(avgDuration = 42.7))[4]
        assertEquals("43", tile.value)
        assertEquals("min", tile.unit)
    }

    @Test
    fun totalCostPrependsTheResolvedCurrencySymbol() {
        val euro = prefs.copy(currencySymbol = "€")
        assertEquals("€412.37", tiles(p = euro)[5].value)
    }

    @Test
    fun energyRateAndCostHonorTheSettingsPrecision() {
        // fmtNumber and formatCurrency both use the settings precision (no explicit decimals in the web calls).
        val threeDp = prefs.copy(precision = 3)
        val list = tiles(p = threeDp)
        assertEquals("3,421.500", list[1].value)
        assertEquals("48.200", list[2].value)
        assertEquals("$412.370", list[5].value)
        // …but the fmtInt tiles stay zero-decimal regardless of the settings precision.
        assertEquals("128", list[0].value)
        assertEquals("42", list[4].value)
    }

    @Test
    fun valuesUseLocaleGroupingAndDecimalSeparators() {
        val germany = prefs.copy(locale = Locale.GERMANY)
        val large = stats.copy(totalSessions = 12345, totalEnergy = 12345.5, totalCost = 1234.5)
        val list = tiles(large, germany)
        assertEquals("12.345", list[0].value)
        assertEquals("12.345,50", list[1].value)
        assertEquals("$1.234,50", list[5].value)
    }

    @Test
    fun nonFiniteFiguresRenderAsZeroNotEmDash() {
        // Web `fmtNumber` / `formatCurrency` map NaN/Infinity to 0 via `safeNumber` (never the em-dash).
        val broken =
            stats.copy(
                totalEnergy = Double.NaN,
                avgRate = Double.POSITIVE_INFINITY,
                avgDuration = Double.NaN,
                totalCost = Double.NEGATIVE_INFINITY,
            )
        val list = tiles(broken)
        assertEquals("0.00", list[1].value)
        assertEquals("0.00", list[2].value)
        assertEquals("0", list[4].value)
        assertEquals("$0.00", list[5].value)
    }

    @Test
    fun formatCurrencyMirrorsTheWebSymbolPlusFmtNumber() {
        assertEquals("$1,000.00", SummaryStatsGridProjection.formatCurrency(1000.0, prefs))
        assertEquals("$0.00", SummaryStatsGridProjection.formatCurrency(Double.NaN, prefs))
    }

    // ── SummaryStatsGridDisplayPrefs.from (web useFormatting / useSettings derivation) ──────────────────

    @Test
    fun displayPrefsDefaultToDollarTwoDpEnUs() {
        val defaults = SummaryStatsGridDisplayPrefs.from(null)
        assertEquals("$", defaults.currencySymbol)
        assertEquals(2, defaults.precision)
        assertEquals(Locale.forLanguageTag("en-US"), defaults.locale)
        assertEquals(defaults, SummaryStatsGridDisplayPrefs.DEFAULT)
    }

    @Test
    fun displayPrefsResolveSymbolPrecisionAndLocaleFromSettings() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "€")
                put("decimal_precision", 3)
                put("locale", "de-DE")
            }
        val resolved = SummaryStatsGridDisplayPrefs.from(settings)
        assertEquals("€", resolved.currencySymbol)
        assertEquals(3, resolved.precision)
        assertEquals(Locale.forLanguageTag("de-DE"), resolved.locale)
    }

    @Test
    fun displayPrefsFallBackWhenSettingsFieldsAreBlankOrAbsent() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "   ")
                put("locale", "")
            }
        val resolved = SummaryStatsGridDisplayPrefs.from(settings)
        assertEquals("$", resolved.currencySymbol)
        assertEquals(2, resolved.precision)
        assertEquals(Locale.forLanguageTag("en-US"), resolved.locale)
    }

    @Test
    fun displayPrefsTreatNegativePrecisionAsTheDefault() {
        // Web `useFormatting`: precision is used only when finite & >= 0, else 2.
        val settings = buildJsonObject { put("decimal_precision", -1) }
        assertEquals(2, SummaryStatsGridDisplayPrefs.from(settings).precision)
    }

    @Test
    fun nonObjectSettingsFallBackToDefaults() {
        // A JSON primitive (not the expected object) resolves to the cold-start defaults rather than throwing.
        val resolved = SummaryStatsGridDisplayPrefs.from(JsonPrimitive("not-an-object"))
        assertEquals("$", resolved.currencySymbol)
        assertEquals(2, resolved.precision)
        assertEquals(Locale.forLanguageTag("en-US"), resolved.locale)
    }

    // ── Accessibility: every tile carries non-blank spoken content (the merged semantics node) ──────────

    @Test
    fun everyTileHasNonBlankLabelAndValueForTalkBack() {
        tiles().forEach { tile ->
            assertTrue("label must be non-blank for TalkBack", tile.label.isNotBlank())
            assertTrue("value must be non-blank for TalkBack", tile.value.isNotBlank())
            assertTrue("unit, when present, must be non-blank", tile.unit?.isNotBlank() ?: true)
        }
    }

    // ── Diagnostics (P1/S11): view.opened carries only the surface slug ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        SummaryStatsGridDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        val (event, fields) = logger.events.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SummaryStatsGrid"), fields)
    }

    @Test
    fun diagnosticsSlugIsStableAndCarriesNoNumericPayload() {
        assertEquals("SummaryStatsGrid", SummaryStatsGridDiagnostics.SLUG)
        val logger = RecordingLogger()
        SummaryStatsGridDiagnostics.recordViewOpened(logger)
        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }
}
