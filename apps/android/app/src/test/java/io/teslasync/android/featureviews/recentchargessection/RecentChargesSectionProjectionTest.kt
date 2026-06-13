package io.teslasync.android.featureviews.recentchargessection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the RecentChargesSection's pure logic — the native analogue of the web
 * component's `useChargeColumns` derivations
 * (web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx): the per-row projection (the
 * localized date via the render seam, the SI-Wh → kWh energy label, the "Xh Ym" duration label, the
 * currency-formatted cost with its em-dash fallback, and the "start% → end%" battery label), the empty guard,
 * the settings `currency_symbol` / `decimal_precision` reads, the localized date formatter, and the PII-safe
 * `view.opened` diagnostic. The `formatTimestamp` seam is a deterministic stub so the assertions are exactly
 * what the thin composable renders. Runs in the :android:testReleaseUnitTest gate.
 */
class RecentChargesSectionProjectionTest {
    private val stampFormat: (String?) -> String = { raw -> "fmt:$raw" }
    private val us = Locale.US

    private val firstSession =
        ChargeSession(
            id = 1L,
            startTs = "2026-04-04T18:30:00Z",
            energyAddedWh = 42_300.0,
            durationMinutes = 95.0,
            cost = 8.45,
            startSocPct = 23.0,
            endSocPct = 82.0,
        )

    private val secondSession =
        ChargeSession(
            id = 2L,
            startTs = "2026-04-01T08:00:00Z",
            energyAddedWh = 11_900.0,
            durationMinutes = 42.0,
            cost = null,
            startSocPct = 64.0,
            endSocPct = 88.0,
        )

    private fun project(data: RecentChargesData?) =
        RecentChargesProjection.project(
            data = data,
            currencySymbol = "$",
            decimals = 2,
            locale = us,
            formatTimestamp = stampFormat,
        )

    // ── Row projection (cached → projection) ────────────────────────────────────────────────────────

    @Test
    fun projectMapsEveryCellLabelInOrder() {
        val result = project(RecentChargesData(listOf(firstSession, secondSession)))

        assertFalse(result.isEmpty)
        assertEquals(listOf(1L, 2L), result.rows.map { it.id })
        assertEquals(
            listOf("fmt:2026-04-04T18:30:00Z", "fmt:2026-04-01T08:00:00Z"),
            result.rows.map { it.dateLabel },
        )
        assertEquals(listOf("42.30 kWh", "11.90 kWh"), result.rows.map { it.energyLabel })
        assertEquals(listOf("1h 35m", "42m"), result.rows.map { it.durationLabel })
        assertEquals(listOf("$8.45", EM_DASH), result.rows.map { it.costLabel })
        assertEquals(listOf("23% \u2192 82%", "64% \u2192 88%"), result.rows.map { it.batteryLabel })
    }

    @Test
    fun projectNullDataIsEmpty() {
        val result = project(null)

        assertTrue(result.isEmpty)
        assertTrue(result.rows.isEmpty())
    }

    @Test
    fun projectEmptyListIsEmpty() {
        val result = project(RecentChargesData(emptyList()))

        assertTrue(result.isEmpty)
        assertTrue(result.rows.isEmpty())
    }

    // ── Energy (web `fmtNumber(convertEnergyFromSI(wh, 'kWh'))` + ` kWh`) ────────────────────────────

    @Test
    fun formatEnergyConvertsWhToKwhWithUserPrecision() {
        assertEquals("42.30 kWh", RecentChargesProjection.formatEnergy(42_300.0, 2, us))
        assertEquals("11.9 kWh", RecentChargesProjection.formatEnergy(11_900.0, 1, us))
        assertEquals("0.00 kWh", RecentChargesProjection.formatEnergy(0.0, 2, us))
        assertEquals("1,000.00 kWh", RecentChargesProjection.formatEnergy(1_000_000.0, 2, us))
    }

    // ── Duration (web `durationStr`) ────────────────────────────────────────────────────────────────

    @Test
    fun formatDurationMatchesWebDurationStr() {
        assertEquals("1h 35m", RecentChargesProjection.formatDuration(95.0, us))
        assertEquals("42m", RecentChargesProjection.formatDuration(42.0, us))
        assertEquals("0m", RecentChargesProjection.formatDuration(0.0, us))
        assertEquals("10h 0m", RecentChargesProjection.formatDuration(600.0, us))
        assertEquals("0m", RecentChargesProjection.formatDuration(Double.NaN, us))
    }

    // ── Cost (web `cost != null ? formatCurrency(cost) : '—'`) ───────────────────────────────────────

    @Test
    fun formatCurrencyAppliesSymbolAndPrecision() {
        assertEquals("$8.45", RecentChargesProjection.formatCurrency(8.45, "$", 2, us))
        assertEquals("\u20AC8.40", RecentChargesProjection.formatCurrency(8.4, "\u20AC", 2, us))
        assertEquals("$0.00", RecentChargesProjection.formatCurrency(Double.NaN, "$", 2, us))
    }

    @Test
    fun formatCurrencyBlankSymbolFallsBackToDollar() {
        assertEquals("${DEFAULT_CURRENCY}5.00", RecentChargesProjection.formatCurrency(5.0, "   ", 2, us))
    }

    @Test
    fun projectNullCostFallsBackToEmDash() {
        val result = project(RecentChargesData(listOf(secondSession)))

        assertEquals(EM_DASH, result.rows.single().costLabel)
    }

    // ── Battery (web `end != null ? '{start}% → {end}%' : '{start}%'`) ───────────────────────────────

    @Test
    fun formatBatteryShowsRangeWhenEndPresentElseStartOnly() {
        assertEquals("23% \u2192 82%", RecentChargesProjection.formatBattery(23.0, 82.0))
        assertEquals("64%", RecentChargesProjection.formatBattery(64.0, null))
    }

    @Test
    fun formatBatteryRendersFractionalSocLikeRawInterpolation() {
        assertEquals("23.5% \u2192 80%", RecentChargesProjection.formatBattery(23.5, 80.0))
    }

    // ── fmtNumber (web `Intl.NumberFormat`, half away from zero, grouped) ────────────────────────────

    @Test
    fun fmtNumberRoundsHalfAwayFromZeroAndGroups() {
        assertEquals("1,234.57", RecentChargesProjection.fmtNumber(1234.567, 2, us))
        assertEquals("1", RecentChargesProjection.fmtNumber(0.5, 0, us))
        assertEquals("3", RecentChargesProjection.fmtNumber(2.5, 0, us))
        assertEquals("0", RecentChargesProjection.fmtNumber(Double.POSITIVE_INFINITY, 0, us))
    }

    // ── Settings readers (web `useFormatting`) ───────────────────────────────────────────────────────

    @Test
    fun currencySymbolReadsSettingsAndDefaultsToDollar() {
        assertEquals("\u20AC", RecentChargesProjection.currencySymbol(buildJsonObject { put("currency_symbol", "\u20AC") }))
        assertEquals(DEFAULT_CURRENCY, RecentChargesProjection.currencySymbol(buildJsonObject { put("currency_symbol", "  ") }))
        assertEquals(DEFAULT_CURRENCY, RecentChargesProjection.currencySymbol(buildJsonObject { put("other", "x") }))
        assertEquals(DEFAULT_CURRENCY, RecentChargesProjection.currencySymbol(null))
        assertEquals(DEFAULT_CURRENCY, RecentChargesProjection.currencySymbol(JsonNull))
    }

    @Test
    fun decimalPrecisionReadsSettingsFloorsAndDefaultsToTwo() {
        assertEquals(3, RecentChargesProjection.decimalPrecision(buildJsonObject { put("decimal_precision", 3) }))
        assertEquals(1, RecentChargesProjection.decimalPrecision(buildJsonObject { put("decimal_precision", 1.9) }))
        assertEquals(DEFAULT_DECIMALS, RecentChargesProjection.decimalPrecision(buildJsonObject { put("decimal_precision", -1) }))
        assertEquals(DEFAULT_DECIMALS, RecentChargesProjection.decimalPrecision(buildJsonObject { put("other", 5) }))
        assertEquals(DEFAULT_DECIMALS, RecentChargesProjection.decimalPrecision(null))
    }

    @Test
    fun projectUsesSettingsBackedDecimalsForEnergyAndCost() {
        val result =
            RecentChargesProjection.project(
                data = RecentChargesData(listOf(firstSession)),
                currencySymbol = "\u00A3",
                decimals = 0,
                locale = us,
                formatTimestamp = stampFormat,
            )
        val row = result.rows.single()
        assertEquals("42 kWh", row.energyLabel)
        assertEquals("\u00A38", row.costLabel)
    }

    // ── Localized date formatting (web `formatDateTime`) ─────────────────────────────────────────────

    @Test
    fun timeFormattingFormatsIsoInstantAndEmDashesAbsentValues() {
        val formatted = RecentChargesTimeFormatting.format("2026-04-04T18:30:00Z", ZoneOffset.UTC, us)
        assertTrue("expected a non-blank localized stamp, was '$formatted'", formatted.isNotBlank())
        assertFalse(formatted == EM_DASH)
        assertTrue("expected the year in '$formatted'", formatted.contains("2026"))

        assertEquals(EM_DASH, RecentChargesTimeFormatting.format(null, ZoneId.systemDefault(), us))
        assertEquals(EM_DASH, RecentChargesTimeFormatting.format("   ", ZoneId.systemDefault(), us))
        assertEquals(EM_DASH, RecentChargesTimeFormatting.format("not-a-date", ZoneId.systemDefault(), us))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ────────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        RecentChargesSectionDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "RecentChargesSection"), record.fields)
    }

    @Test
    fun diagnosticCarriesNoNumericOrIdentifyingPayload() {
        val logger = RecordingLogger()

        RecentChargesSectionDiagnostics.recordViewOpened(logger)

        val fields = logger.records.single().fields
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("recent-charges-section", RecentChargesSectionRegistration.ID)
        assertEquals("RecentChargesSection", RecentChargesSectionRegistration.SLUG)
    }

    private fun buildSettings(currency: String) = buildJsonObject { put("currency_symbol", currency) }

    @Test
    fun currencySymbolReadsBlankAndPopulatedSettings() {
        assertEquals("kr", RecentChargesProjection.currencySymbol(buildSettings("kr")))
        assertEquals(DEFAULT_CURRENCY, RecentChargesProjection.currencySymbol(buildSettings(" ")))
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
