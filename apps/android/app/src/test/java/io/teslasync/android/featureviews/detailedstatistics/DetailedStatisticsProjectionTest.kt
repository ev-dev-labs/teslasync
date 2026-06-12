package io.teslasync.android.featureviews.detailedstatistics

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the DetailedStatistics pure projection — the native port of the web component's
 * render contract (web/src/features/charging/components/charging-list/DetailedStatistics.tsx): the
 * `isLoading ? skeletons : stats ? cards : empty` lifecycle adapter, the six formatted cell values
 * reproducing the web `formatDurationMinutes` / `fmtWithUnit(.., 'kW')` / `Currency` helpers (incl. the
 * `useFormatting` currency symbol and `precision` of 2 / 3), and the PII-safe `view.opened` diagnostic. Runs
 * in the :app:testReleaseUnitTest gate; no Compose, no device.
 */
class DetailedStatisticsProjectionTest {
    private val stats =
        DetailedChargingStats(
            count = 1234,
            avgPower = 48.5,
            totalCost = 312.4,
            avgCostPerKwh = 0.182,
        )

    private val enhanced =
        DetailedEnhancedStats(
            avgDurationMinutes = 125.0,
            topChargerName = "Supercharger",
            topChargerCount = 87,
        )

    private fun snapshot(): DetailedStatisticsSnapshot = DetailedStatisticsSnapshot(stats, enhanced)

    private val usd = DetailedStatisticsCurrencyPrefs("$")

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

    // ── (snapshot, isLoading) → lifecycle UiState adapter (web's loading/content/empty precedence) ──────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        // Web parity: `isLoading ? skeletons : …` — loading wins even if a snapshot is already cached.
        val state = DetailedStatisticsProjection.projectUiState(snapshot(), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val snap = snapshot()
        val state = DetailedStatisticsProjection.projectUiState(snap, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snap, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = DetailedStatisticsProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun loadingWhenNoSnapshotAndLoading() {
        val state = DetailedStatisticsProjection.projectUiState(snapshot = null, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    // ── project: the cached snapshot → render-ready display adapter (the six web cell values) ────────────

    @Test
    fun projectFormatsEveryCellValue() {
        val display = DetailedStatisticsProjection.project(snapshot(), usd, Locale.US)
        assertEquals(1234, display.count)
        assertEquals("2h 5m", display.avgDuration)
        assertEquals("48.50 kW", display.avgPower)
        assertEquals("Supercharger", display.topChargerName)
        assertEquals(87, display.topChargerCount)
        assertEquals("$312.40", display.totalCost)
        assertEquals("$0.182", display.avgCostPerKwh)
    }

    @Test
    fun projectFallsBackToDashForBlankTopCharger() {
        val snap = snapshot().copy(enhanced = enhanced.copy(topChargerName = "  "))
        val display = DetailedStatisticsProjection.project(snap, usd, Locale.US)
        assertEquals(EM_DASH, display.topChargerName)
    }

    @Test
    fun projectUsesResolvedCurrencySymbol() {
        val display = DetailedStatisticsProjection.project(snapshot(), DetailedStatisticsCurrencyPrefs("€"), Locale.US)
        assertEquals("€312.40", display.totalCost)
        assertEquals("€0.182", display.avgCostPerKwh)
    }

    // ── formatDuration: web `formatDurationMinutes` (no subMinuteLabel) ─────────────────────────────────

    @Test
    fun formatDurationRendersMinutesAndHours() {
        assertEquals("45m", DetailedStatisticsProjection.formatDuration(45.0))
        assertEquals("2h 5m", DetailedStatisticsProjection.formatDuration(125.0))
        assertEquals("1h 0m", DetailedStatisticsProjection.formatDuration(60.0))
        assertEquals("0m", DetailedStatisticsProjection.formatDuration(0.0))
    }

    @Test
    fun formatDurationRoundsRemainderHalfAwayFromZero() {
        // Web `formatRoundedInt` (`en-US` `halfExpand`): 65.6 → "1h 6m"; 65.4 → "1h 5m".
        assertEquals("1h 6m", DetailedStatisticsProjection.formatDuration(65.6))
        assertEquals("1h 5m", DetailedStatisticsProjection.formatDuration(65.4))
    }

    @Test
    fun formatDurationGuardsNonFiniteAndNegative() {
        assertEquals(EM_DASH, DetailedStatisticsProjection.formatDuration(-1.0))
        assertEquals(EM_DASH, DetailedStatisticsProjection.formatDuration(Double.NaN))
        assertEquals(EM_DASH, DetailedStatisticsProjection.formatDuration(Double.POSITIVE_INFINITY))
    }

    // ── formatPower: web `fmtWithUnit(stats.avgPower, 'kW')` ─────────────────────────────────────────────

    @Test
    fun formatPowerAppendsUnitWithTwoDecimals() {
        assertEquals("48.50 kW", DetailedStatisticsProjection.formatPower(48.5, Locale.US))
        assertEquals("0.00 kW", DetailedStatisticsProjection.formatPower(0.0, Locale.US))
    }

    @Test
    fun formatPowerCoercesNonFiniteToZero() {
        // Web `safeNumber` coerces NaN/Infinity to 0 before formatting, so the unit is still shown.
        assertEquals("0.00 kW", DetailedStatisticsProjection.formatPower(Double.NaN, Locale.US))
        assertEquals("0.00 kW", DetailedStatisticsProjection.formatPower(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── formatCurrency: web `Currency` (symbol + fmtNumber, "—" fallback) ───────────────────────────────

    @Test
    fun formatCurrencyPrefixesSymbolAndGroups() {
        assertEquals("$312.40", DetailedStatisticsProjection.formatCurrency(312.4, "$", 2, Locale.US))
        assertEquals("$1,234.50", DetailedStatisticsProjection.formatCurrency(1234.5, "$", 2, Locale.US))
        assertEquals("$0.182", DetailedStatisticsProjection.formatCurrency(0.182, "$", 3, Locale.US))
    }

    @Test
    fun formatCurrencyReturnsDashForNullOrNonFinite() {
        assertEquals(EM_DASH, DetailedStatisticsProjection.formatCurrency(null, "$", 2, Locale.US))
        assertEquals(EM_DASH, DetailedStatisticsProjection.formatCurrency(Double.NaN, "$", 2, Locale.US))
    }

    @Test
    fun formatCurrencyDegradesBlankSymbolToDefault() {
        assertEquals("\$5.00", DetailedStatisticsProjection.formatCurrency(5.0, "", 2, Locale.US))
    }

    // ── DetailedStatisticsCurrencyPrefs.fromSettings (web `useFormatting`) ──────────────────────────────

    @Test
    fun currencyPrefsReadSymbolFromSettings() {
        val settings = JsonObject(mapOf("currency_symbol" to JsonPrimitive("€")))
        assertEquals("€", DetailedStatisticsCurrencyPrefs.fromSettings(settings).currencySymbol)
    }

    @Test
    fun currencyPrefsDefaultWhenMissingNullOrBlank() {
        assertEquals("$", DetailedStatisticsCurrencyPrefs.fromSettings(null).currencySymbol)
        assertEquals("$", DetailedStatisticsCurrencyPrefs.fromSettings(JsonObject(emptyMap())).currencySymbol)
        val blank = JsonObject(mapOf("currency_symbol" to JsonPrimitive("  ")))
        assertEquals("$", DetailedStatisticsCurrencyPrefs.fromSettings(blank).currencySymbol)
        assertEquals("$", DetailedStatisticsCurrencyPrefs.DEFAULT.currencySymbol)
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordDetailedStatisticsOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DetailedStatistics"), opened.single().second)
        assertEquals("DetailedStatistics", DETAILED_STATISTICS_SLUG)
    }
}
