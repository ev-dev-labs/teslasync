package io.teslasync.android.featureviews.detailcards

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the DetailCards pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drivetrain-health/DetailCards.tsx and its
 * `helpers.ts`): the `displayTemp` null/format helper, the `peakPower > 0` / `avgPowerMax > 0` /
 * `minRegenPower < 0` power guards, the `stats ? … : '—'` regen/CO2 guards, the SI -> display conversion
 * through the golden-pinned shared formatters, the `fmtNumber` locale formatting, and the lifecycle
 * projection. Because the surface is presentational, each projected row is exactly what the thin composable
 * renders, so these assertions double as the per-state adapter "snapshot". Every formatter is pinned to
 * [Locale.US] for determinism.
 */
class DetailCardsProjectionTest {
    private val celsius = unitPref(TemperatureUnitPref.CELSIUS)
    private val fahrenheit = unitPref(TemperatureUnitPref.FAHRENHEIT)

    private val strings =
        DetailCardsStrings(
            temperatureTitle = "Temperature Details",
            powerTitle = "Power Summary",
            frontMotorTemp = "Front Motor Temp",
            rearMotorTemp = "Rear Motor Temp",
            inverterTemp = "Inverter Temp",
            batteryTemp = "Battery Temp",
            peakPower = "Peak Power",
            avgPeakPower = "Avg Peak Power",
            maxRegen = "Max Regen",
            totalRegen = "Total Regen",
            co2Saved = "CO\u2082 Saved",
            noData = "No data available",
            loadingLabel = "Loading",
        )

    private val fullData =
        DetailCardsData(
            health =
                DrivetrainHealthInput(
                    frontMotorTempC = 48.0,
                    rearMotorTempC = 52.5,
                    inverterTempC = 41.0,
                    batteryTempC = 27.5,
                ),
            peakPowerKw = 212.0,
            avgPowerMaxKw = 94.6,
            minRegenPowerKw = -63.4,
            stats = DrivingStatsInput(regenEnergyWh = 18_400.0, co2SavedKg = 132.7),
        )

    // ── projectUiState(): loading -> content -> empty precedence ─────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = DetailCardsProjection.projectUiState(fullData, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun projectUiStatePresentDataIsContent() {
        val state = DetailCardsProjection.projectUiState(fullData, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(fullData, state.data)
    }

    @Test
    fun projectUiStateNullDataIsEmpty() {
        val state = DetailCardsProjection.projectUiState(data = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertNull(state.data)
    }

    // ── temperatureRows(): web `displayTemp(health.*, formatTemperature)` ────────

    @Test
    fun temperatureRowsFormatsEverySensorInCelsius() {
        val rows = DetailCardsProjection.temperatureRows(fullData, celsius, strings)
        assertEquals(4, rows.size)
        assertEquals(DetailCardRow("Front Motor Temp", "48.0\u00B0C"), rows[0])
        assertEquals(DetailCardRow("Rear Motor Temp", "52.5\u00B0C"), rows[1])
        assertEquals(DetailCardRow("Inverter Temp", "41.0\u00B0C"), rows[2])
        assertEquals(DetailCardRow("Battery Temp", "27.5\u00B0C"), rows[3])
    }

    @Test
    fun temperatureRowsConvertFromSiToFahrenheit() {
        val rows = DetailCardsProjection.temperatureRows(fullData, fahrenheit, strings)
        // 48°C -> 118.4°F, 52.5°C -> 126.5°F, 41°C -> 105.8°F, 27.5°C -> 81.5°F.
        assertEquals("118.4\u00B0F", rows[0].value)
        assertEquals("126.5\u00B0F", rows[1].value)
        assertEquals("105.8\u00B0F", rows[2].value)
        assertEquals("81.5\u00B0F", rows[3].value)
    }

    @Test
    fun temperatureRowsRenderDashForAbsentSensorOnly() {
        val data =
            fullData.copy(
                health =
                    DrivetrainHealthInput(
                        frontMotorTempC = 48.0,
                        rearMotorTempC = null,
                        inverterTempC = null,
                        batteryTempC = 27.5,
                    ),
            )
        val rows = DetailCardsProjection.temperatureRows(data, celsius, strings)
        assertEquals("48.0\u00B0C", rows[0].value)
        assertEquals(EM_DASH, rows[1].value)
        assertEquals(EM_DASH, rows[2].value)
        assertEquals("27.5\u00B0C", rows[3].value)
    }

    // ── powerRows(): web per-row guards + formatting ─────────────────────────────

    @Test
    fun powerRowsFormatsEveryRowWhenDataPresent() {
        val rows = DetailCardsProjection.powerRows(fullData, celsius, Locale.US, strings)
        assertEquals(5, rows.size)
        assertEquals(DetailCardRow("Peak Power", "212 kW"), rows[0])
        assertEquals(DetailCardRow("Avg Peak Power", "94.6 kW"), rows[1])
        assertEquals(DetailCardRow("Max Regen", "63.4 kW"), rows[2])
        assertEquals(DetailCardRow("Total Regen", "18.4 kWh"), rows[3])
        assertEquals(DetailCardRow("CO\u2082 Saved", "132.7 kg"), rows[4])
    }

    @Test
    fun peakPowerRendersIntegerKwAndRoundsHalfUp() {
        val rows = DetailCardsProjection.powerRows(fullData.copy(peakPowerKw = 212.7), celsius, Locale.US, strings)
        // Web `fmtInt(peakPower)` — zero fraction digits, rounded half away from zero.
        assertEquals("213 kW", rows[0].value)
    }

    @Test
    fun nonPositivePowerFiguresRenderDash() {
        val data = fullData.copy(peakPowerKw = 0.0, avgPowerMaxKw = 0.0, minRegenPowerKw = 0.0)
        val rows = DetailCardsProjection.powerRows(data, celsius, Locale.US, strings)
        assertEquals(EM_DASH, rows[0].value)
        assertEquals(EM_DASH, rows[1].value)
        // Web `minRegenPower < 0` — a zero (no regen recorded) renders the dash, not "0.0 kW".
        assertEquals(EM_DASH, rows[2].value)
    }

    @Test
    fun maxRegenUsesAbsoluteValueOfNegativeFloor() {
        val rows = DetailCardsProjection.powerRows(fullData.copy(minRegenPowerKw = -88.25), celsius, Locale.US, strings)
        // Web `fmtNumber(Math.abs(minRegenPower), 1)` — magnitude, one fraction digit, halfExpand (.25 -> .3).
        assertEquals("88.3 kW", rows[2].value)
    }

    @Test
    fun absentStatsRendersDashForRegenAndCo2() {
        val rows = DetailCardsProjection.powerRows(fullData.copy(stats = null), celsius, Locale.US, strings)
        // The power figures still render; only the two stats-derived rows fall back to the dash.
        assertEquals("212 kW", rows[0].value)
        assertEquals(EM_DASH, rows[3].value)
        assertEquals(EM_DASH, rows[4].value)
    }

    @Test
    fun totalRegenConvertsSiWattHoursToKwh() {
        val rows = DetailCardsProjection.powerRows(fullData.copy(stats = DrivingStatsInput(5_000.0, 0.0)), celsius, Locale.US, strings)
        // 5,000 Wh -> 5.0 kWh at the energy precision override of 1.
        assertEquals("5.0 kWh", rows[3].value)
        assertEquals("0.0 kg", rows[4].value)
    }

    // ── displayTemp(): web `displayTemp(c, formatTemperature)` ───────────────────

    @Test
    fun displayTempReturnsDashForNull() {
        assertEquals(EM_DASH, DetailCardsProjection.displayTemp(null, celsius))
    }

    @Test
    fun displayTempReturnsDashForNonFinite() {
        assertEquals(EM_DASH, DetailCardsProjection.displayTemp(Double.NaN, celsius))
        assertEquals(EM_DASH, DetailCardsProjection.displayTemp(Double.POSITIVE_INFINITY, celsius))
    }

    @Test
    fun displayTempFormatsZeroAsAValueNotDash() {
        // 0°C is a real reading, not an absence — only `null` renders the dash (web `c === null`).
        assertEquals("0.0\u00B0C", DetailCardsProjection.displayTemp(0.0, celsius))
    }

    // ── fmtNumber(): web `fmtNumber(value, decimals)` / `fmtInt(value)` ──────────

    @Test
    fun fmtNumberUsesExactFractionDigits() {
        assertEquals("212", DetailCardsProjection.fmtNumber(212.0, 0, Locale.US))
        assertEquals("94.6", DetailCardsProjection.fmtNumber(94.6, 1, Locale.US))
    }

    @Test
    fun fmtNumberRoundsHalfAwayFromZero() {
        assertEquals("213", DetailCardsProjection.fmtNumber(212.5, 0, Locale.US))
        assertEquals("94.3", DetailCardsProjection.fmtNumber(94.25, 1, Locale.US))
    }

    @Test
    fun fmtNumberGroupsThousands() {
        assertEquals("1,234.5", DetailCardsProjection.fmtNumber(1234.5, 1, Locale.US))
        assertEquals("1,234,567", DetailCardsProjection.fmtNumber(1_234_567.0, 0, Locale.US))
    }

    @Test
    fun fmtNumberNormalizesNegativeZero() {
        assertEquals("0.0", DetailCardsProjection.fmtNumber(-0.0, 1, Locale.US))
    }

    @Test
    fun fmtNumberRoundsOnShortestDecimalLikeIntl() {
        // ECMAScript Intl rounds the value's shortest decimal form, so 1.005 -> "1.01" (not "1.00" as a
        // naive round of the binary double 1.00499999… would give); 2.675 -> "2.68" likewise.
        assertEquals("1.01", DetailCardsProjection.fmtNumber(1.005, 2, Locale.US))
        assertEquals("2.68", DetailCardsProjection.fmtNumber(2.675, 2, Locale.US))
    }

    @Test
    fun fmtNumberCoercesNonFiniteToZero() {
        // Web `safeNumber(v)` — a NaN/Infinity never reaches `toLocaleString`, so it renders as 0.
        assertEquals("0", DetailCardsProjection.fmtNumber(Double.NaN, 0, Locale.US))
        assertEquals("0.0", DetailCardsProjection.fmtNumber(Double.POSITIVE_INFINITY, 1, Locale.US))
    }

    // ── resolveDisplayLocale(): web `fmtNumber` locale default ───────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }

    // ── the sparse end-to-end snapshot (the all-dashes content state) ────────────

    @Test
    fun sparseInputProducesAllDashPowerRowsAndPartialTemperatures() {
        val sparse =
            DetailCardsData(
                health = DrivetrainHealthInput(frontMotorTempC = 31.0, rearMotorTempC = null, inverterTempC = null, batteryTempC = 22.0),
                peakPowerKw = 0.0,
                avgPowerMaxKw = 0.0,
                minRegenPowerKw = 0.0,
                stats = null,
            )
        val temps = DetailCardsProjection.temperatureRows(sparse, celsius, strings)
        val powers = DetailCardsProjection.powerRows(sparse, celsius, Locale.US, strings)
        assertEquals(listOf("31.0\u00B0C", EM_DASH, EM_DASH, "22.0\u00B0C"), temps.map { it.value })
        assertTrue(powers.all { it.value == EM_DASH })
    }

    private fun unitPref(temperature: TemperatureUnitPref): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )
}
