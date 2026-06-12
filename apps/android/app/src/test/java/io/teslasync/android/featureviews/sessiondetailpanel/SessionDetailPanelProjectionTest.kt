package io.teslasync.android.featureviews.sessiondetailpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Off-device verification of the SessionDetailPanel's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx and its
 * `helpers.ts`/`dateFormat.ts`/`numberFormat.ts`/`useFormatting`): the `getChargerLabel` classifier, the
 * `durationMinutes` derivation, the SOC-range string, the `fmtWithUnit`/`formatCurrency`/`formatDateTime`
 * value formatting, the ordered row projection with its three conditional rows, the settings read, the
 * lifecycle projection, and the `view.opened` diagnostic. Because the surface is purely presentational, each
 * projected row is exactly what the thin composable renders, so these assertions double as the per-state
 * "snapshot". Each variant is a `.copy()` of [fullSession]; every formatter is pinned to [Locale.US] and
 * [UTC] for determinism.
 */
class SessionDetailPanelProjectionTest {
    private val utc = ZoneId.of("UTC")

    private val strings =
        SessionDetailPanelStrings(
            title = "Session Details",
            date = "Date",
            chargerType = "Charger Type",
            socRange = "SOC Range",
            energyAdded = "Energy Added",
            peakPower = "Peak Power",
            avgPower = "Avg Power",
            duration = "Duration",
            cost = "Cost",
            location = "Location",
            noData = "No data available",
            chargerHomeAc = "AC / Home",
            chargerSupercharger = "Supercharger",
            chargerDcFast = "DC Fast",
        )

    private val fullSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.parse("2026-04-04T09:30:00Z"),
            vehicleId = 7L,
            chargerType = "Tesla",
            endedAt = Instant.parse("2026-04-04T10:15:00Z"),
            totalEnergyAddedWh = 42_350.0,
            peakPowerW = 121_000.0,
            avgPowerW = 56_500.0,
            startSocPct = 18.0,
            endSocPct = 82.0,
            costDecimal = 12.4,
            startPlace = "Supercharger — Fremont",
        )

    private val usd = SessionDetailFormat("$", 2)

    // ── projectUiState(): the three lifecycle phases ─────────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = SessionDetailPanelProjection.projectUiState(fullSession, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun projectUiStatePresentSessionIsContent() {
        val state = SessionDetailPanelProjection.projectUiState(fullSession, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(fullSession, state.data)
    }

    @Test
    fun projectUiStateAbsentSessionIsEmpty() {
        val state = SessionDetailPanelProjection.projectUiState(null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── classifyCharger(): verbatim getChargerLabel precedence ───────────────────

    @Test
    fun classifyChargerTeslaTypeIsSupercharger() {
        assertEquals(ChargerLabelKind.Supercharger, SessionDetailPanelProjection.classifyCharger(fullSession))
    }

    @Test
    fun classifyChargerTeslaSubstringIsSupercharger() {
        // Any `tesla`-containing type (case-insensitive) is a Supercharger (web `.toLowerCase().includes('tesla')`).
        val sample = fullSession.copy(chargerType = "Tesla Urban Supercharger")
        assertEquals(ChargerLabelKind.Supercharger, SessionDetailPanelProjection.classifyCharger(sample))
    }

    @Test
    fun classifyChargerOtherNonEmptyTypeIsDcFast() {
        // A non-empty type without `tesla` is DC fast — including the literal "Supercharger" (no `tesla` substring).
        assertEquals(ChargerLabelKind.DcFast, SessionDetailPanelProjection.classifyCharger(fullSession.copy(chargerType = "CCS")))
        assertEquals(
            ChargerLabelKind.DcFast,
            SessionDetailPanelProjection.classifyCharger(fullSession.copy(chargerType = "Supercharger")),
        )
    }

    @Test
    fun classifyChargerUntypedHighPeakIsDcFast() {
        val highPeak = fullSession.copy(chargerType = null, peakPowerW = 50_000.0)
        assertEquals(ChargerLabelKind.DcFast, SessionDetailPanelProjection.classifyCharger(highPeak))
    }

    @Test
    fun classifyChargerUntypedLowOrEmptyIsHomeAc() {
        assertEquals(
            ChargerLabelKind.HomeAc,
            SessionDetailPanelProjection.classifyCharger(fullSession.copy(chargerType = null, peakPowerW = 5_000.0)),
        )
        assertEquals(
            ChargerLabelKind.HomeAc,
            SessionDetailPanelProjection.classifyCharger(fullSession.copy(chargerType = "", peakPowerW = null)),
        )
    }

    @Test
    fun chargerLabelResolvesEachBucketThroughStrings() {
        assertEquals("AC / Home", SessionDetailPanelProjection.chargerLabel(ChargerLabelKind.HomeAc, strings))
        assertEquals("Supercharger", SessionDetailPanelProjection.chargerLabel(ChargerLabelKind.Supercharger, strings))
        assertEquals("DC Fast", SessionDetailPanelProjection.chargerLabel(ChargerLabelKind.DcFast, strings))
    }

    // ── durationMinutes(): web helper parity ─────────────────────────────────────

    @Test
    fun durationMinutesRoundsTheSpan() {
        assertEquals(45L, SessionDetailPanelProjection.durationMinutes(fullSession))
        // 30s rounds half-away-from-zero to a whole minute, matching JS Math.round.
        val rounded =
            fullSession.copy(
                startedAt = Instant.parse("2026-04-04T09:00:00Z"),
                endedAt = Instant.parse("2026-04-04T09:30:30Z"),
            )
        assertEquals(31L, SessionDetailPanelProjection.durationMinutes(rounded))
    }

    @Test
    fun durationMinutesIsZeroWithoutAnEnd() {
        assertEquals(0L, SessionDetailPanelProjection.durationMinutes(fullSession.copy(endedAt = null)))
    }

    @Test
    fun durationMinutesIsZeroWhenEndNotAfterStart() {
        val backwards =
            fullSession.copy(
                startedAt = Instant.parse("2026-04-04T10:00:00Z"),
                endedAt = Instant.parse("2026-04-04T09:00:00Z"),
            )
        assertEquals(0L, SessionDetailPanelProjection.durationMinutes(backwards))
    }

    // ── socRange()/jsNumber(): the `${start}% → ${end ?? '?'}%` template ─────────

    @Test
    fun socRangeRendersBothBounds() {
        assertEquals("18% \u2192 82%", SessionDetailPanelProjection.socRange(fullSession))
    }

    @Test
    fun socRangeUsesQuestionMarkForAMissingEnd() {
        assertEquals("18% \u2192 ?%", SessionDetailPanelProjection.socRange(fullSession.copy(endSocPct = null)))
    }

    @Test
    fun socRangeKeepsFractionalBoundsRaw() {
        // Web interpolates the raw number — a whole value drops `.0`, a fractional value keeps its decimals.
        val sample = fullSession.copy(startSocPct = 42.5, endSocPct = 80.0)
        assertEquals("42.5% \u2192 80%", SessionDetailPanelProjection.socRange(sample))
    }

    @Test
    fun jsNumberMatchesJavaScriptStringification() {
        assertEquals("80", SessionDetailPanelProjection.jsNumber(80.0))
        assertEquals("42.5", SessionDetailPanelProjection.jsNumber(42.5))
        assertEquals(UNKNOWN, SessionDetailPanelProjection.jsNumber(Double.NaN))
    }

    // ── formatDateTime(): localized medium-date short-time ───────────────────────

    @Test
    fun formatDateTimeRendersALocalizedAbsoluteString() {
        val epoch = Instant.parse("2026-04-04T09:30:00Z").toEpochMilliseconds()
        val text = SessionDetailPanelProjection.formatDateTime(epoch, utc, Locale.US)
        assertTrue("expected the year in <$text>", text.contains("2026"))
        assertTrue("expected the short month in <$text>", text.contains("Apr"))
    }

    // ── fmtNumber()/fmtWithUnit()/formatCurrency(): web fmtNumber parity ─────────

    @Test
    fun fmtNumberRoundsHalfAwayFromZeroToMatchIntlNumberFormat() {
        assertEquals("63", SessionDetailPanelProjection.fmtNumber(62.5, 0, Locale.US))
        assertEquals("1,234.6", SessionDetailPanelProjection.fmtNumber(1234.56, 1, Locale.US))
        assertEquals("-12.3", SessionDetailPanelProjection.fmtNumber(-12.34, 1, Locale.US))
    }

    @Test
    fun fmtNumberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", SessionDetailPanelProjection.fmtNumber(Double.NaN, 2, Locale.US))
        assertEquals("0", SessionDetailPanelProjection.fmtNumber(Double.POSITIVE_INFINITY, 0, Locale.US))
    }

    @Test
    fun fmtNumberAppliesLocaleGrouping() {
        assertEquals("1,234,567.0", SessionDetailPanelProjection.fmtNumber(1_234_567.0, 1, Locale.US))
        assertEquals("1.234,5", SessionDetailPanelProjection.fmtNumber(1234.5, 1, Locale.GERMANY))
    }

    @Test
    fun fmtWithUnitAppendsTheUnit() {
        assertEquals("42.35 kWh", SessionDetailPanelProjection.fmtWithUnit(42.35, "kWh", 2, Locale.US))
    }

    @Test
    fun formatCurrencyPrefixesTheSymbolAndFallsBackToDollar() {
        assertEquals("$12.40", SessionDetailPanelProjection.formatCurrency(12.4, "$", 2, Locale.US))
        assertEquals("€12.40", SessionDetailPanelProjection.formatCurrency(12.4, "€", 2, Locale.US))
        assertEquals("$12.40", SessionDetailPanelProjection.formatCurrency(12.4, "", 2, Locale.US))
    }

    // ── rows(): the full ordered definition list + conditional rows ──────────────

    @Test
    fun rowsRenderEveryRowForAFullSession() {
        val rows = SessionDetailPanelProjection.rows(fullSession, usd, Locale.US, utc, strings)
        assertEquals(9, rows.size)
        assertEquals("Date", rows[0].label)
        assertTrue(rows[0].value.contains("2026"))
        assertEquals(SessionDetailRow("Charger Type", "Supercharger"), rows[1])
        assertEquals(SessionDetailRow("SOC Range", "18% \u2192 82%"), rows[2])
        assertEquals(SessionDetailRow("Energy Added", "42.35 kWh"), rows[3])
        assertEquals(SessionDetailRow("Peak Power", "121.00 kW"), rows[4])
        assertEquals(SessionDetailRow("Avg Power", "56.50 kW"), rows[5])
        assertEquals(SessionDetailRow("Duration", "45.00 min"), rows[6])
        assertEquals(SessionDetailRow("Cost", "$12.40"), rows[7])
        assertEquals(SessionDetailRow("Location", "Supercharger — Fremont"), rows[8])
    }

    @Test
    fun rowsOmitTheThreeOptionalRowsWhenAbsent() {
        val minimal =
            fullSession.copy(
                endedAt = null,
                chargerType = null,
                startSocPct = 64.0,
                endSocPct = null,
                totalEnergyAddedWh = 6_200.0,
                peakPowerW = null,
                avgPowerW = null,
                costDecimal = null,
                startPlace = null,
            )
        val rows = SessionDetailPanelProjection.rows(minimal, usd, Locale.US, utc, strings)
        val labels = rows.map { it.label }
        assertEquals(listOf("Date", "Charger Type", "SOC Range", "Energy Added", "Peak Power", "Duration"), labels)
        assertFalse(labels.contains("Avg Power"))
        assertFalse(labels.contains("Cost"))
        assertFalse(labels.contains("Location"))
        // Untyped + no peak → home/AC; missing end → "?" SOC + 0 duration; missing peak → 0 kW.
        assertEquals(SessionDetailRow("Charger Type", "AC / Home"), rows[1])
        assertEquals(SessionDetailRow("SOC Range", "64% \u2192 ?%"), rows[2])
        assertEquals(SessionDetailRow("Energy Added", "6.20 kWh"), rows[3])
        assertEquals(SessionDetailRow("Peak Power", "0.00 kW"), rows[4])
        assertEquals(SessionDetailRow("Duration", "0.00 min"), rows[5])
    }

    @Test
    fun rowsOmitLocationForABlankPlace() {
        val rows = SessionDetailPanelProjection.rows(fullSession.copy(startPlace = ""), usd, Locale.US, utc, strings)
        assertFalse(rows.map { it.label }.contains("Location"))
    }

    @Test
    fun rowsHonorTheDecimalPrecisionFromSettings() {
        val rows = SessionDetailPanelProjection.rows(fullSession, SessionDetailFormat("$", 0), Locale.US, utc, strings)
        assertEquals(SessionDetailRow("Energy Added", "42 kWh"), rows[3])
        assertEquals(SessionDetailRow("Cost", "$12"), rows[7])
    }

    // ── SessionDetailFormat.fromSettings(): web useFormatting read ───────────────

    @Test
    fun formatFromSettingsResolvesSymbolAndPrecision() {
        val doc =
            buildJsonObject {
                put("currency_symbol", "€")
                put("decimal_precision", 3.0)
            }
        val format = SessionDetailFormat.fromSettings(doc)
        assertEquals("€", format.currencySymbol)
        assertEquals(3, format.decimalPrecision)
    }

    @Test
    fun formatFromSettingsFallsBackForMissingOrBlankInput() {
        assertEquals(SessionDetailFormat.DEFAULT, SessionDetailFormat.fromSettings(null))
        val blank =
            SessionDetailFormat.fromSettings(
                buildJsonObject {
                    put("currency_symbol", "  ")
                    put("decimal_precision", -1.0)
                },
            )
        assertEquals(DEFAULT_CURRENCY, blank.currencySymbol)
        assertEquals(DEFAULT_PRECISION, blank.decimalPrecision)
    }

    @Test
    fun formatFromSettingsFloorsAFractionalPrecision() {
        val doc = buildJsonObject { put("decimal_precision", 2.9) }
        assertEquals(2, SessionDetailFormat.fromSettings(doc).decimalPrecision)
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsTheSurfaceSlugOnly() {
        val logger = RecordingLogger()
        SessionDetailPanelDiagnostics.recordViewOpened(logger)
        assertEquals("view.opened", logger.lastEvent)
        assertEquals(mapOf("surface" to "SessionDetailPanel"), logger.lastFields)
        assertEquals(LogLevel.Info, logger.lastLevel)
    }

    private class RecordingLogger : Logger {
        var lastLevel: LogLevel? = null
        var lastEvent: String? = null
        var lastFields: Map<String, String> = emptyMap()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            lastLevel = level
            lastEvent = event
            lastFields = fields
        }
    }
}
