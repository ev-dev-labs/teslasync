package io.teslasync.android.featureviews.chargingsessioncard

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Off-device verification of the ChargingSessionCard's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/charging/components/ChargingSessionCard.tsx and its
 * `chargingAggregation.ts`/`charging-curve/helpers.ts`/`dateFormat.ts`/`numberFormat.ts`/`useFormatting`): the
 * `getChargerCategory` classifier, the `durationMinutes`/`avgPowerW`/`costPerKwh`/`distanceAddedM` helpers, the
 * per-session battery-friendly score, the value formatting, the settings read, the lifecycle projection, and
 * the `view.opened` diagnostic. Because the surface is purely presentational, the projected model is exactly
 * what the thin composable renders, so these assertions double as the per-state "snapshot". Every formatter is
 * pinned to [Locale.US] and [UTC] for determinism.
 */
class ChargingSessionCardProjectionTest {
    private val utc = ZoneId.of("UTC")

    private val strings =
        ChargingSessionCardStrings(
            chargerSupercharger = "Supercharger",
            chargerDcFast = "DC Fast",
            chargerHomeAc = "Home / AC",
            chargerUnknown = "Charger",
            free = "Free",
            peakPower = "Peak Power",
            avgPower = "Avg Power",
        )

    private val usdKm = ChargingSessionCardFormat("$", 2, DistanceUnitPref.KM)

    private val fullSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.parse("2026-04-04T09:30:00Z"),
            vehicleId = 7L,
            chargerType = "Supercharger V3",
            endedAt = Instant.parse("2026-04-04T10:15:00Z"),
            totalEnergyAddedWh = 42_350.0,
            peakPowerW = 121_000.0,
            avgPowerW = 56_500.0,
            startSocPct = 18.0,
            endSocPct = 82.0,
            costDecimal = 12.4,
            startPlace = "Supercharger — Fremont",
            startOdometerM = 1_000_000.0,
            endOdometerM = 1_200_000.0,
        )

    // ── projectUiState(): the three lifecycle phases ─────────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = ChargingSessionCardProjection.projectUiState(fullSession, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun projectUiStatePresentSessionIsContent() {
        val state = ChargingSessionCardProjection.projectUiState(fullSession, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(fullSession, state.data)
    }

    @Test
    fun projectUiStateAbsentSessionIsEmpty() {
        val state = ChargingSessionCardProjection.projectUiState(null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── chargerCategory(): verbatim getChargerCategory precedence ────────────────

    @Test
    fun chargerCategoryNullOrEmptyIsHome() {
        assertEquals(ChargerCategory.Home, ChargingSessionCardProjection.chargerCategory(fullSession.copy(chargerType = null)))
        assertEquals(ChargerCategory.Home, ChargingSessionCardProjection.chargerCategory(fullSession.copy(chargerType = "")))
    }

    @Test
    fun chargerCategorySuperOrTpcIsSupercharger() {
        val supercharger = fullSession.copy(chargerType = "Supercharger V3")
        val tpc = fullSession.copy(chargerType = "TPC adapter")
        assertEquals(ChargerCategory.Supercharger, ChargingSessionCardProjection.chargerCategory(supercharger))
        assertEquals(ChargerCategory.Supercharger, ChargingSessionCardProjection.chargerCategory(tpc))
    }

    @Test
    fun chargerCategoryDcFamilyIsDc() {
        listOf("CCS", "CHAdeMO", "DC Fast", "fast charger").forEach { type ->
            val category = ChargingSessionCardProjection.chargerCategory(fullSession.copy(chargerType = type))
            assertEquals("$type should classify as DC", ChargerCategory.Dc, category)
        }
    }

    @Test
    fun chargerCategoryHomeFamilyIsHome() {
        listOf("Home Wall Connector", "AC", "Wall box").forEach { type ->
            val category = ChargingSessionCardProjection.chargerCategory(fullSession.copy(chargerType = type))
            assertEquals("$type should classify as Home", ChargerCategory.Home, category)
        }
    }

    @Test
    fun chargerCategoryUnrecognizedIsUnknown() {
        assertEquals(ChargerCategory.Unknown, ChargingSessionCardProjection.chargerCategory(fullSession.copy(chargerType = "Mystery plug")))
    }

    @Test
    fun chargerLabelAndToneResolveEachBucket() {
        assertEquals("Supercharger", ChargingSessionCardProjection.chargerLabel(ChargerCategory.Supercharger, strings))
        assertEquals("DC Fast", ChargingSessionCardProjection.chargerLabel(ChargerCategory.Dc, strings))
        assertEquals("Home / AC", ChargingSessionCardProjection.chargerLabel(ChargerCategory.Home, strings))
        assertEquals("Charger", ChargingSessionCardProjection.chargerLabel(ChargerCategory.Unknown, strings))
        assertEquals(ChargerBadgeTone.Danger, ChargingSessionCardProjection.chargerTone(ChargerCategory.Supercharger))
        assertEquals(ChargerBadgeTone.Warning, ChargingSessionCardProjection.chargerTone(ChargerCategory.Dc))
        assertEquals(ChargerBadgeTone.Success, ChargingSessionCardProjection.chargerTone(ChargerCategory.Home))
        assertEquals(ChargerBadgeTone.Success, ChargingSessionCardProjection.chargerTone(ChargerCategory.Unknown))
    }

    // ── durationMinutes(): web chargingAggregation parity (unrounded) ────────────

    @Test
    fun durationMinutesIsTheRawFractionalSpan() {
        assertEquals(45.0, ChargingSessionCardProjection.durationMinutes(fullSession), 1e-9)
        val half = fullSession.copy(endedAt = Instant.parse("2026-04-04T10:15:30Z"))
        assertEquals(45.5, ChargingSessionCardProjection.durationMinutes(half), 1e-9)
    }

    @Test
    fun durationMinutesIsZeroWithoutAnEndOrWhenBackwards() {
        assertEquals(0.0, ChargingSessionCardProjection.durationMinutes(fullSession.copy(endedAt = null)), 1e-9)
        val backwards = fullSession.copy(startedAt = Instant.parse("2026-04-04T10:00:00Z"), endedAt = Instant.parse("2026-04-04T09:00:00Z"))
        assertEquals(0.0, ChargingSessionCardProjection.durationMinutes(backwards), 1e-9)
    }

    // ── avgPowerW(): energy/duration with the field fallback ─────────────────────

    @Test
    fun avgPowerWComputesFromEnergyAndDuration() {
        // 42350 Wh over 0.75 h = 56466.67 W (the web energy/elapsed path), not the raw avg_power_w field.
        assertEquals(56_466.67, ChargingSessionCardProjection.avgPowerW(fullSession), 0.01)
    }

    @Test
    fun avgPowerWFallsBackToFieldThenZero() {
        val inProgress = fullSession.copy(endedAt = null, avgPowerW = 7_000.0)
        assertEquals(7_000.0, ChargingSessionCardProjection.avgPowerW(inProgress), 1e-9)
        val nothing = fullSession.copy(endedAt = null, avgPowerW = null, totalEnergyAddedWh = 0.0)
        assertEquals(0.0, ChargingSessionCardProjection.avgPowerW(nothing), 1e-9)
    }

    // ── costPerKwh(): null guards + computed ──────────────────────────────────────

    @Test
    fun costPerKwhComputesWhenEnergyAndCostArePositive() {
        // 12.4 / (42350/1000) = 0.2928 $/kWh.
        assertEquals(0.2928, ChargingSessionCardProjection.costPerKwh(fullSession)!!, 1e-4)
    }

    @Test
    fun costPerKwhIsNullWhenFreeOrNoEnergy() {
        assertNull(ChargingSessionCardProjection.costPerKwh(fullSession.copy(costDecimal = null)))
        assertNull(ChargingSessionCardProjection.costPerKwh(fullSession.copy(costDecimal = 0.0)))
        assertNull(ChargingSessionCardProjection.costPerKwh(fullSession.copy(totalEnergyAddedWh = 0.0)))
    }

    // ── distanceAddedM(): odometer delta ─────────────────────────────────────────

    @Test
    fun distanceAddedMIsThePositiveOdometerDelta() {
        assertEquals(200_000.0, ChargingSessionCardProjection.distanceAddedM(fullSession)!!, 1e-9)
    }

    @Test
    fun distanceAddedMIsNullWhenMissingOrNonPositive() {
        assertNull(ChargingSessionCardProjection.distanceAddedM(fullSession.copy(startOdometerM = null)))
        assertNull(ChargingSessionCardProjection.distanceAddedM(fullSession.copy(endOdometerM = null)))
        assertNull(ChargingSessionCardProjection.distanceAddedM(fullSession.copy(endOdometerM = 1_000_000.0)))
    }

    // ── sessionScore(): the battery-friendly heuristic ───────────────────────────

    @Test
    fun sessionScoreRewardsTheSweetSpot() {
        // start 18 (≤30 → +30), end 82 (≤90 → +0): 50 + 30 + 0 = 80.
        assertEquals(80, ChargingSessionCardProjection.sessionScore(fullSession))
        // start 18 (+30), end 78 (≤80 → +20): 50 + 30 + 20 = 100.
        assertEquals(100, ChargingSessionCardProjection.sessionScore(fullSession.copy(endSocPct = 78.0)))
    }

    @Test
    fun sessionScorePenalizesHighStartAndFullCharge() {
        // start 75 (>70 → −10), end 100 (≥100 → −25): 50 − 10 − 25 = 15.
        assertEquals(15, ChargingSessionCardProjection.sessionScore(fullSession.copy(startSocPct = 75.0, endSocPct = 100.0)))
        // start 60 (≤70 → 0), end 95 (<100 → −10): 50 + 0 − 10 = 40.
        assertEquals(40, ChargingSessionCardProjection.sessionScore(fullSession.copy(startSocPct = 60.0, endSocPct = 95.0)))
    }

    @Test
    fun sessionScoreIsNullWithoutBothBounds() {
        assertNull(ChargingSessionCardProjection.sessionScore(fullSession.copy(startSocPct = null)))
        assertNull(ChargingSessionCardProjection.sessionScore(fullSession.copy(endSocPct = null)))
    }

    // ── Number/duration/currency formatting: web fmtNumber parity ────────────────

    @Test
    fun fmtNumberRoundsHalfAwayFromZero() {
        assertEquals("63", ChargingSessionCardProjection.fmtNumber(62.5, 0, Locale.US))
        assertEquals("1,234.6", ChargingSessionCardProjection.fmtNumber(1234.56, 1, Locale.US))
        assertEquals("0.00", ChargingSessionCardProjection.fmtNumber(Double.NaN, 2, Locale.US))
    }

    @Test
    fun fmtIntAndFmtWithUnitAndCurrency() {
        assertEquals("1,235", ChargingSessionCardProjection.fmtInt(1234.6, Locale.US))
        assertEquals("42.35 kWh", ChargingSessionCardProjection.fmtWithUnit(42.35, "kWh", 2, Locale.US))
        assertEquals("$12.40", ChargingSessionCardProjection.formatCurrency(12.4, "$", 2, Locale.US))
        assertEquals("€12.40", ChargingSessionCardProjection.formatCurrency(12.4, "€", 2, Locale.US))
        assertEquals("$12.40", ChargingSessionCardProjection.formatCurrency(12.4, "", 2, Locale.US))
    }

    @Test
    fun formatDurationMinutesMatchesTheWebHelper() {
        assertEquals("45m", ChargingSessionCardProjection.formatDurationMinutes(45.0, Locale.US))
        assertEquals("46m", ChargingSessionCardProjection.formatDurationMinutes(45.5, Locale.US))
        assertEquals("1h 30m", ChargingSessionCardProjection.formatDurationMinutes(90.0, Locale.US))
        assertEquals("0m", ChargingSessionCardProjection.formatDurationMinutes(0.0, Locale.US))
        assertEquals("\u2014", ChargingSessionCardProjection.formatDurationMinutes(-1.0, Locale.US))
    }

    // ── displayDistance(): SI metres → display unit ──────────────────────────────

    @Test
    fun displayDistanceConvertsByUnit() {
        assertEquals(200.0, ChargingSessionCardProjection.displayDistance(200_000.0, DistanceUnitPref.KM)!!, 1e-9)
        assertEquals(1.0, ChargingSessionCardProjection.displayDistance(1_609.344, DistanceUnitPref.MI)!!, 1e-6)
        assertNull(ChargingSessionCardProjection.displayDistance(null, DistanceUnitPref.KM))
    }

    // ── model(): the full row projection + conditional chips ─────────────────────

    @Test
    fun modelProjectsEveryChipForAFullSession() {
        val m = ChargingSessionCardProjection.model(fullSession, usdKm, Locale.US, utc, strings)
        assertTrue("timestamp should contain the year", m.timestamp.contains("2026"))
        assertEquals("45m", m.durationLabel)
        assertTrue(m.showDuration)
        assertEquals("Supercharger", m.chargerLabel)
        assertEquals(ChargerBadgeTone.Danger, m.chargerTone)
        assertEquals("42.35 kWh", m.energyChip)
        assertFalse(m.showFree)
        assertEquals("121.00 kW Peak Power", m.peakChip)
        assertEquals("~56.47 kW Avg Power", m.avgChip)
        assertEquals("$12.40", m.costChip)
        assertEquals("($0.29/kWh)", m.cpkChip)
        assertEquals("+200 km", m.distanceChip)
        assertEquals(18.0, m.startSocPct!!, 1e-9)
        assertEquals(82.0, m.endSocPct!!, 1e-9)
        assertEquals(80, m.score)
        assertEquals("Supercharger — Fremont", m.routeAddress)
    }

    @Test
    fun modelConvertsRangeAddedToMilesUnderTheImperialPreference() {
        val miles = ChargingSessionCardFormat("$", 2, DistanceUnitPref.MI)
        val m = ChargingSessionCardProjection.model(fullSession, miles, Locale.US, utc, strings)
        // 200 km → 124.27 mi → fmtInt → "124".
        assertEquals("+124 mi", m.distanceChip)
    }

    @Test
    fun modelOmitsTheConditionalChipsForAMinimalFreeSession() {
        val minimal =
            fullSession.copy(
                chargerType = null,
                endedAt = null,
                totalEnergyAddedWh = 6_200.0,
                peakPowerW = null,
                avgPowerW = null,
                startSocPct = null,
                endSocPct = null,
                costDecimal = null,
                startPlace = null,
                startOdometerM = null,
                endOdometerM = null,
            )
        val m = ChargingSessionCardProjection.model(minimal, usdKm, Locale.US, utc, strings)
        assertEquals("Home / AC", m.chargerLabel)
        assertEquals(ChargerBadgeTone.Success, m.chargerTone)
        assertEquals("6.20 kWh", m.energyChip)
        assertTrue("a free session with energy shows the Free badge", m.showFree)
        assertNull(m.peakChip)
        assertNull(m.avgChip)
        assertNull(m.costChip)
        assertNull(m.cpkChip)
        assertNull(m.distanceChip)
        assertNull(m.score)
        assertFalse(m.showDuration)
        assertEquals("0m", m.durationLabel)
        assertNull(m.routeAddress)
    }

    @Test
    fun modelOmitsTheEnergyAndFreeBadgesWhenNoEnergy() {
        val noEnergy = fullSession.copy(totalEnergyAddedWh = 0.0, costDecimal = null)
        val m = ChargingSessionCardProjection.model(noEnergy, usdKm, Locale.US, utc, strings)
        assertNull(m.energyChip)
        assertFalse(m.showFree)
    }

    @Test
    fun modelHonorsTheDecimalPrecisionFromSettings() {
        val zeroPrecision = ChargingSessionCardFormat("$", 0, DistanceUnitPref.KM)
        val m = ChargingSessionCardProjection.model(fullSession, zeroPrecision, Locale.US, utc, strings)
        assertEquals("42 kWh", m.energyChip)
        assertEquals("121 kW Peak Power", m.peakChip)
        assertEquals("$12", m.costChip)
    }

    // ── ChargingSessionCardFormat.fromSettings(): useFormatting + useUnits read ───

    @Test
    fun formatFromSettingsResolvesSymbolPrecisionAndUnit() {
        val doc =
            buildJsonObject {
                put("currency_symbol", "€")
                put("decimal_precision", 3.0)
                put("unit_of_length", "mi")
            }
        val format = ChargingSessionCardFormat.fromSettings(doc)
        assertEquals("€", format.currencySymbol)
        assertEquals(3, format.decimalPrecision)
        assertEquals(DistanceUnitPref.MI, format.distanceUnit)
    }

    @Test
    fun formatFromSettingsFallsBackForMissingOrBlankInput() {
        assertEquals(ChargingSessionCardFormat.DEFAULT, ChargingSessionCardFormat.fromSettings(null))
        val blank =
            ChargingSessionCardFormat.fromSettings(
                buildJsonObject {
                    put("currency_symbol", "  ")
                    put("decimal_precision", -1.0)
                },
            )
        assertEquals(DEFAULT_CURRENCY, blank.currencySymbol)
        assertEquals(DEFAULT_PRECISION, blank.decimalPrecision)
        assertEquals(DistanceUnitPref.KM, blank.distanceUnit)
    }

    @Test
    fun formatFromSettingsFloorsAFractionalPrecisionAndDefaultsMetric() {
        val doc =
            buildJsonObject {
                put("decimal_precision", 2.9)
                put("unit_of_length", "km")
            }
        val format = ChargingSessionCardFormat.fromSettings(doc)
        assertEquals(2, format.decimalPrecision)
        assertEquals(DistanceUnitPref.KM, format.distanceUnit)
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsTheSurfaceSlugOnly() {
        val logger = RecordingLogger()
        ChargingSessionCardDiagnostics.recordViewOpened(logger)
        assertEquals("view.opened", logger.lastEvent)
        assertEquals(mapOf("surface" to "ChargingSessionCard"), logger.lastFields)
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
