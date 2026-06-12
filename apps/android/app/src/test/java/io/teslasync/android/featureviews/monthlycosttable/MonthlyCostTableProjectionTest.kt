package io.teslasync.android.featureviews.monthlycosttable

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MonthlyCostTable pure projection — the native port of the web component's
 * `sorted` memo and its seven per-cell `render` callbacks
 * (web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx): the per-column sort comparator
 * (month lexicographic, every other column numeric) with the asc/desc flip and stable ties, the
 * `<Currency>` formatting (symbol + grouped number, non-finite → em dash, blank symbol → "$"), the
 * `fmtInt` session count, the `fmtWithUnit(_, 'kWh', 1)` energy column, and the
 * `{savings >= 0 ? '+' : ''}` savings sign. Runs in the :app:testReleaseUnitTest gate; no Compose, no
 * device. Locale is pinned to US for deterministic grouping / separators.
 */
class MonthlyCostTableProjectionTest {
    private val locale = Locale.US

    private val formatters =
        MonthlyCostFormatters(
            currency = { value, precision -> MonthlyCostTableProjection.formatCurrency(value, "$", precision, locale) },
            integer = { value -> MonthlyCostTableProjection.formatInteger(value, locale) },
            energy = { value -> MonthlyCostTableProjection.formatEnergy(value, locale) },
        )

    // A test-only fixture builder; the wide parameter list is intentional (one per MonthlyBucket field).
    @Suppress("LongParameterList")
    private fun bucket(
        month: String,
        cost: Double = 0.0,
        energy: Double = 0.0,
        sessions: Long = 0,
        avgCostPerKwh: Double = 0.0,
        gasEquiv: Double = 0.0,
        savings: Double = 0.0,
    ): MonthlyBucket = MonthlyBucket(month, cost, energy, sessions, avgCostPerKwh, gasEquiv, savings)

    private val sample =
        listOf(
            bucket("2026-04", cost = 84.20, energy = 612.5, sessions = 11, avgCostPerKwh = 0.137, gasEquiv = 132.40, savings = 48.20),
            bucket("2026-03", cost = 96.75, energy = 705.0, sessions = 14, avgCostPerKwh = 0.137, gasEquiv = 151.10, savings = 54.35),
            bucket("2026-02", cost = 71.40, energy = 498.2, sessions = 9, avgCostPerKwh = 0.143, gasEquiv = 64.90, savings = -6.50),
        )

    // ── sortRows: month (web `String(aVal).localeCompare`) ────────────────────────────────────────────────

    @Test
    fun sortByMonthAscendingAndDescending() {
        val asc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.MONTH, descending = false)
        assertEquals(listOf("2026-02", "2026-03", "2026-04"), asc.map { it.month })

        val desc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.MONTH, descending = true)
        assertEquals(listOf("2026-04", "2026-03", "2026-02"), desc.map { it.month })
    }

    // ── sortRows: numeric columns (web `aVal - bVal`) ─────────────────────────────────────────────────────

    @Test
    fun sortByCostNumericNotLexicographic() {
        val asc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.COST, descending = false)
        assertEquals(listOf("2026-02", "2026-04", "2026-03"), asc.map { it.month })
    }

    @Test
    fun sortBySessionsAscending() {
        val asc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.SESSIONS, descending = false)
        assertEquals(listOf("2026-02", "2026-04", "2026-03"), asc.map { it.month })
    }

    @Test
    fun sortByEnergyDescending() {
        val desc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.ENERGY, descending = true)
        assertEquals(listOf("2026-03", "2026-04", "2026-02"), desc.map { it.month })
    }

    @Test
    fun sortBySavingsHandlesNegativeNumerically() {
        val desc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.SAVINGS, descending = true)
        assertEquals(listOf("2026-03", "2026-04", "2026-02"), desc.map { it.month })

        val asc = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.SAVINGS, descending = false)
        assertEquals(listOf("2026-02", "2026-04", "2026-03"), asc.map { it.month })
    }

    @Test
    fun sortByGasEquivAndRate() {
        val gas = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.GAS_EQUIV, descending = false)
        assertEquals(listOf("2026-02", "2026-04", "2026-03"), gas.map { it.month })

        val rate = MonthlyCostTableProjection.sortRows(sample, MonthlyCostColumnKey.AVG_RATE, descending = true)
        // 0.143 (Feb) is the highest rate; the two 0.137 rows keep their original order (stable).
        assertEquals(listOf("2026-02", "2026-04", "2026-03"), rate.map { it.month })
    }

    @Test
    fun sortIsStableForTies() {
        val tied =
            listOf(
                bucket("2026-05", cost = 10.0),
                bucket("2026-06", cost = 10.0),
                bucket("2026-07", cost = 10.0),
            )
        // All costs equal → original order preserved in both directions (stable sort, web `Array.sort`).
        assertEquals(
            listOf("2026-05", "2026-06", "2026-07"),
            MonthlyCostTableProjection.sortRows(tied, MonthlyCostColumnKey.COST, descending = false).map { it.month },
        )
        assertEquals(
            listOf("2026-05", "2026-06", "2026-07"),
            MonthlyCostTableProjection.sortRows(tied, MonthlyCostColumnKey.COST, descending = true).map { it.month },
        )
    }

    @Test
    fun sortByUnknownKeyKeepsOrder() {
        val out = MonthlyCostTableProjection.sortRows(sample, "not-a-column", descending = true)
        assertEquals(sample.map { it.month }, out.map { it.month })
    }

    @Test
    fun sortByNullKeyKeepsOrder() {
        val out = MonthlyCostTableProjection.sortRows(sample, null, descending = false)
        assertEquals(sample.map { it.month }, out.map { it.month })
    }

    @Test
    fun sortOfEmptyListIsEmpty() {
        assertTrue(MonthlyCostTableProjection.sortRows(emptyList(), MonthlyCostColumnKey.MONTH, descending = true).isEmpty())
    }

    // ── project / rowOf: per-cell formatting (web `render` callbacks) ─────────────────────────────────────

    @Test
    fun rowOfFormatsEveryCellLikeTheWebRenderCallbacks() {
        val row = MonthlyCostTableProjection.rowOf(sample[0], formatters)
        assertEquals("2026-04", row.monthText)
        assertEquals("11", row.sessionsText)
        assertEquals("612.5 kWh", row.energyText)
        assertEquals("$84.20", row.costText)
        assertEquals("$0.137", row.avgRateText)
        assertEquals("$132.40", row.gasEquivText)
        assertEquals("+$48.20", row.savingsText)
        assertTrue(row.savingsNonNegative)
    }

    @Test
    fun projectPreservesOrderAndProjectsEachRow() {
        val rows = MonthlyCostTableProjection.project(sample, formatters)
        assertEquals(sample.map { it.month }, rows.map { it.monthText })
        assertEquals(3, rows.size)
    }

    @Test
    fun negativeSavingsRowKeepsMinusSignAndDangerBranch() {
        val row = MonthlyCostTableProjection.rowOf(sample[2], formatters)
        assertEquals("$-6.50", row.savingsText)
        assertFalse(row.savingsNonNegative)
    }

    // ── savingsText (web `{savings >= 0 ? '+' : ''}<Currency />`) ──────────────────────────────────────────

    @Test
    fun savingsTextPrefixesPlusForNonNegativeIncludingZero() {
        assertEquals("+$48.20", MonthlyCostTableProjection.savingsText(48.20, formatters))
        assertEquals("+$0.00", MonthlyCostTableProjection.savingsText(0.0, formatters))
    }

    @Test
    fun savingsTextNoPrefixForNegativeOrNonFinite() {
        assertEquals("$-6.50", MonthlyCostTableProjection.savingsText(-6.50, formatters))
        // NaN is not >= 0 → no '+' prefix, and the currency formatter yields the em dash.
        assertEquals(EM_DASH, MonthlyCostTableProjection.savingsText(Double.NaN, formatters))
    }

    // ── formatCurrency (web `<Currency>`) ─────────────────────────────────────────────────────────────────

    @Test
    fun formatCurrencyPrefixesSymbolAndGroups() {
        assertEquals("$84.20", MonthlyCostTableProjection.formatCurrency(84.20, "$", COST_DECIMALS, locale))
        assertEquals("$1,234.50", MonthlyCostTableProjection.formatCurrency(1234.5, "$", COST_DECIMALS, locale))
        assertEquals("$0.137", MonthlyCostTableProjection.formatCurrency(0.137, "$", RATE_DECIMALS, locale))
    }

    @Test
    fun formatCurrencyHonorsCustomSymbolAndBlankFallback() {
        assertEquals("\u20AC5.00", MonthlyCostTableProjection.formatCurrency(5.0, "\u20AC", COST_DECIMALS, locale))
        // Blank symbol falls back to "$" (web `useFormatting` default).
        assertEquals("$5.00", MonthlyCostTableProjection.formatCurrency(5.0, "", COST_DECIMALS, locale))
    }

    @Test
    fun formatCurrencyReturnsEmDashForNonFinite() {
        assertEquals(EM_DASH, MonthlyCostTableProjection.formatCurrency(Double.NaN, "$", COST_DECIMALS, locale))
        assertEquals(EM_DASH, MonthlyCostTableProjection.formatCurrency(Double.POSITIVE_INFINITY, "$", COST_DECIMALS, locale))
        assertEquals(EM_DASH, MonthlyCostTableProjection.formatCurrency(Double.NEGATIVE_INFINITY, "$", COST_DECIMALS, locale))
    }

    @Test
    fun formatCurrencyKeepsNegativeSign() {
        assertEquals("$-6.50", MonthlyCostTableProjection.formatCurrency(-6.50, "$", COST_DECIMALS, locale))
    }

    // ── formatInteger (web `fmtInt`) + formatEnergy (web `fmtWithUnit`) ───────────────────────────────────

    @Test
    fun formatIntegerGroupsWithoutFractionDigits() {
        assertEquals("11", MonthlyCostTableProjection.formatInteger(11, locale))
        assertEquals("1,234", MonthlyCostTableProjection.formatInteger(1234, locale))
    }

    @Test
    fun formatEnergyAppendsKwhAtOneDecimal() {
        assertEquals("612.5 kWh", MonthlyCostTableProjection.formatEnergy(612.5, locale))
        assertEquals("705.0 kWh", MonthlyCostTableProjection.formatEnergy(705.0, locale))
    }

    @Test
    fun formatEnergyNormalizesNonFiniteToZero() {
        assertEquals("0.0 kWh", MonthlyCostTableProjection.formatEnergy(Double.NaN, locale))
    }

    // ── currency prefs (web `useFormatting` settings read) ────────────────────────────────────────────────

    @Test
    fun currencyPrefsDefaultsWhenSettingsAbsent() {
        assertEquals("$", MonthlyCostCurrencyPrefs.fromSettings(null).currencySymbol)
    }

    @Test
    fun currencyPrefsReadsSymbolFromSettingsDocument() {
        val settings = buildJsonObject { put("currency_symbol", "\u00A3") }
        assertEquals("\u00A3", MonthlyCostCurrencyPrefs.fromSettings(settings).currencySymbol)
    }

    @Test
    fun currencyPrefsFallsBackWhenSymbolBlank() {
        val settings = buildJsonObject { put("currency_symbol", "   ") }
        assertEquals("$", MonthlyCostCurrencyPrefs.fromSettings(settings).currencySymbol)
    }
}
