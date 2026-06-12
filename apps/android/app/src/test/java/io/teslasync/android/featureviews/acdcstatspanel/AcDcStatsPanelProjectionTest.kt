package io.teslasync.android.featureviews.acdcstatspanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the AcDcStatsPanel's pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx): the `count > 0`
 * row filter with its preserved AC→DC order, the energy-split proportions + per-segment percentages, the
 * `value >= 1000 → MWh` energy formatter, the `$/kWh` / avg-energy / avg-time / free cell derivations, the
 * `<Currency>` symbol + em-dash fallback, the `formatDuration` minutes formatter, the free-footer visibility,
 * the empty guard, and the PII-safe `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 * Locale.US fixes the decimal grouping/separator so the formatted-string assertions are deterministic.
 */
class AcDcStatsPanelProjectionTest {
    private val us = Locale.US

    private val mixed =
        AcDcBreakdownData(
            ac = AcDcBucket(energy = 420.5, cost = 52.3, count = 18, totalDuration = 540.0, freeCount = 2, freeEnergy = 30.0),
            dc = AcDcBucket(energy = 1250.0, cost = 210.75, count = 9, totalDuration = 180.0, freeCount = 0, freeEnergy = 0.0),
            total = AcDcTotals(energy = 1670.5, cost = 263.05, freeEnergy = 30.0, freeCount = 2),
        )

    // ── Projection: row filter + order ──────────────────────────────────────────────

    @Test
    fun projectKeepsEveryPositiveCountRowInAcThenDcOrder() {
        val display = AcDcStatsProjection.project(mixed)

        assertFalse(display.isEmpty)
        assertEquals(listOf(AcDcSource.Ac, AcDcSource.Dc), display.rows.map { it.source })
        assertEquals(listOf(18, 9), display.rows.map { it.count })
    }

    @Test
    fun projectDropsZeroCountRowsPreservingRemainingOrder() {
        val acOnly =
            mixed.copy(
                dc = AcDcBucket(energy = 999.0, cost = 10.0, count = 0, totalDuration = 0.0),
            )

        val display = AcDcStatsProjection.project(acOnly)

        // Only AC survives the `count > 0` filter; it stays the first row.
        assertEquals(listOf(AcDcSource.Ac), display.rows.map { it.source })
    }

    @Test
    fun isEmptyOnlyWhenNeitherAcNorDcHasASession() {
        assertTrue(AcDcStatsProjection.project(AcDcBreakdownData()).isEmpty)

        val dcOnly =
            AcDcBreakdownData(
                dc = AcDcBucket(energy = 50.0, cost = 8.0, count = 1, totalDuration = 30.0),
                total = AcDcTotals(energy = 50.0, cost = 8.0),
            )
        assertFalse(AcDcStatsProjection.project(dcOnly).isEmpty)
    }

    // ── Projection: free footer visibility ──────────────────────────────────────────

    @Test
    fun freeTotalIsPresentOnlyWhenTotalFreeCountIsPositive() {
        val withFree = AcDcStatsProjection.project(mixed).freeTotal
        assertEquals(2, withFree?.freeCount)
        assertEquals(30.0, withFree?.freeEnergy)

        val noFree = mixed.copy(total = mixed.total.copy(freeCount = 0, freeEnergy = 0.0))
        assertNull(AcDcStatsProjection.project(noFree).freeTotal)
    }

    // ── Energy split (web gridTemplateColumns proportions) ──────────────────────────

    @Test
    fun energySplitFractionsAreProportionalToTotalEnergy() {
        val split = AcDcStatsProjection.project(mixed).split

        assertEquals(420.5 / 1670.5, split.acFraction, FRACTION_DELTA)
        assertEquals(1250.0 / 1670.5, split.dcFraction, FRACTION_DELTA)
        assertEquals((420.5 / 1670.5) * 100.0, split.acPercent, FRACTION_DELTA)
        assertTrue(split.showAc)
        assertTrue(split.showDc)
    }

    @Test
    fun energySplitGuardsAgainstAZeroTotalAndHidesZeroSegments() {
        val split = EnergySplit(acEnergy = 0.0, dcEnergy = 0.0, totalEnergy = 0.0)
        assertEquals(0.0, split.acFraction, FRACTION_DELTA)
        assertEquals(0.0, split.dcFraction, FRACTION_DELTA)
        assertFalse(split.showAc)
        assertFalse(split.showDc)
    }

    // ── Derived row cells ────────────────────────────────────────────────────────────

    @Test
    fun rowDerivedCellsMatchWebFormulas() {
        val ac = AcDcStatsProjection.project(mixed).rows.first { it.source == AcDcSource.Ac }

        assertEquals(52.3 / 420.5, ac.costPerEnergy!!, FRACTION_DELTA) // web cost / energy
        assertEquals(420.5 / 18.0, ac.avgEnergy, FRACTION_DELTA) // web energy / count
        assertEquals(540.0 / 18.0, ac.avgDurationMinutes, FRACTION_DELTA) // web totalDuration / count
    }

    @Test
    fun costPerEnergyIsNullWhenEnergyIsNonPositive() {
        val zeroEnergyRow =
            AcDcStatsRow(AcDcSource.Ac, energy = 0.0, cost = 5.0, count = 1, totalDuration = 10.0, freeCount = 0, freeEnergy = 0.0)
        assertNull(zeroEnergyRow.costPerEnergy)
    }

    // ── Energy formatter (web `value >= 1000 ? /1000 MWh : kWh`) ─────────────────────

    @Test
    fun formatEnergyAutoUsesKwhBelowThousandAndMwhAtOrAbove() {
        assertEquals("420.50 kWh", AcDcStatsProjection.formatEnergyAuto(420.5, decimals = 2, locale = us))
        assertEquals("999.00 kWh", AcDcStatsProjection.formatEnergyAuto(999.0, decimals = 2, locale = us))
        assertEquals("1.00 MWh", AcDcStatsProjection.formatEnergyAuto(1000.0, decimals = 2, locale = us))
        assertEquals("1.25 MWh", AcDcStatsProjection.formatEnergyAuto(1250.0, decimals = 2, locale = us))
    }

    @Test
    fun formatKwhAlwaysUsesKwh() {
        assertEquals("23.36 kWh", AcDcStatsProjection.formatKwh(420.5 / 18.0, decimals = 2, locale = us))
        assertEquals("30.00 kWh", AcDcStatsProjection.formatKwh(30.0, decimals = 2, locale = us))
    }

    @Test
    fun formatPercentAppendsPercentSign() {
        assertEquals("25.17%", AcDcStatsProjection.formatPercent((420.5 / 1670.5) * 100.0, decimals = 2, locale = us))
    }

    // ── Currency (web `<Currency>` symbol + em-dash fallback) ────────────────────────

    @Test
    fun formatCurrencyPrefixesSymbolAtTwoDecimals() {
        assertEquals("$52.30", AcDcStatsProjection.formatCurrency(52.3, symbol = "$", locale = us))
        assertEquals("\u20AC1,234.56", AcDcStatsProjection.formatCurrency(1234.56, symbol = "\u20AC", locale = us))
    }

    @Test
    fun formatCurrencyFallsBackToEmDashForNullOrNonFinite() {
        assertEquals(EM_DASH, AcDcStatsProjection.formatCurrency(null, symbol = "$", locale = us))
        assertEquals(EM_DASH, AcDcStatsProjection.formatCurrency(Double.NaN, symbol = "$", locale = us))
        assertEquals(EM_DASH, AcDcStatsProjection.formatCurrency(Double.POSITIVE_INFINITY, symbol = "$", locale = us))
    }

    // ── Free cell (web `{freeCount} ({freeEnergy} kWh)` else `—`) ────────────────────

    @Test
    fun formatFreeCellShowsCountAndEnergyOnlyWhenFree() {
        val freeRow = AcDcStatsProjection.project(mixed).rows.first { it.source == AcDcSource.Ac }
        assertEquals("2 (30.00 kWh)", AcDcStatsProjection.formatFreeCell(freeRow, decimals = 2, locale = us))

        val paidRow = AcDcStatsProjection.project(mixed).rows.first { it.source == AcDcSource.Dc }
        assertEquals(EM_DASH, AcDcStatsProjection.formatFreeCell(paidRow, decimals = 2, locale = us))
    }

    // ── Duration (web formatDurationMinutes parity, incl. the no-carry quirk) ─────────

    @Test
    fun formatDurationMinutesMatchesWebHourMinuteShape() {
        assertEquals("30m", AcDcStatsProjection.formatDurationMinutes(30.0))
        assertEquals("20m", AcDcStatsProjection.formatDurationMinutes(20.0))
        assertEquals("1h 30m", AcDcStatsProjection.formatDurationMinutes(90.0))
        assertEquals("2h 0m", AcDcStatsProjection.formatDurationMinutes(120.0))
    }

    @Test
    fun formatDurationMinutesRoundsMinutesAndPreservesTheNoCarryQuirk() {
        assertEquals("46m", AcDcStatsProjection.formatDurationMinutes(45.6))
        // web `formatRoundedInt(minutes % 60)` does not carry 60 → "60m", reproduced verbatim.
        assertEquals("60m", AcDcStatsProjection.formatDurationMinutes(59.7))
    }

    @Test
    fun formatDurationMinutesFallsBackToEmDashForNegativeOrNonFinite() {
        assertEquals(EM_DASH, AcDcStatsProjection.formatDurationMinutes(-1.0))
        assertEquals(EM_DASH, AcDcStatsProjection.formatDurationMinutes(Double.NaN))
    }

    // ── Format preferences (web useFormatting defaults) ──────────────────────────────

    @Test
    fun formatDefaultsMatchWebAndResolveBlankSymbolToCurrencyDefault() {
        assertEquals("$", AcDcStatsFormat.DEFAULT.resolvedSymbol)
        assertEquals(2, AcDcStatsFormat.DEFAULT.resolvedDecimals)
        assertEquals("$", AcDcStatsFormat(currencySymbol = "   ").resolvedSymbol)
        assertEquals(0, AcDcStatsFormat(numberDecimals = -3).resolvedDecimals)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        AcDcStatsPanelDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AcDcStatsPanel"), fields)
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

    private companion object {
        const val FRACTION_DELTA: Double = 1e-9
    }
}
