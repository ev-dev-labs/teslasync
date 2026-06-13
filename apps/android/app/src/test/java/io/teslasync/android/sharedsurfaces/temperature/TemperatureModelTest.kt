package io.teslasync.android.sharedsurfaces.temperature

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Temperature's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/data-display/format/Temperature.tsx): the `c` → `f` → null source
 * resolution, the °F→°C conversion, the raw-value hover title with its SOURCE unit, the `fmtNumber` digit
 * resolution (prop → settings → 2), the SI→preference display formatting, and the em-dash branch. Because
 * the composable is a thin render layer over [projectTemperature], the per-branch assertions here double as
 * the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class TemperatureModelTest {
    // ── source resolution (web `sourceC`: finite c wins, else convert finite f, else null) ────────────────

    @Test
    fun sourceCelsiusPrefersAFiniteCelsiusInput() {
        assertEquals(23.456, temperatureSourceCelsius(23.456, null)!!, EPSILON)
        // c wins even when f is also present (web checks c first).
        assertEquals(23.0, temperatureSourceCelsius(23.0, 99.0)!!, EPSILON)
    }

    @Test
    fun sourceCelsiusConvertsFahrenheitWhenCelsiusIsAbsent() {
        assertEquals(100.0, temperatureSourceCelsius(null, 212.0)!!, EPSILON)
        assertEquals(0.0, temperatureSourceCelsius(null, 32.0)!!, EPSILON)
        assertEquals(-40.0, temperatureSourceCelsius(null, -40.0)!!, EPSILON)
    }

    @Test
    fun sourceCelsiusTreatsMissingAndNonFiniteAsUnknown() {
        assertNull(temperatureSourceCelsius(null, null))
        assertNull(temperatureSourceCelsius(Double.NaN, null))
        assertNull(temperatureSourceCelsius(Double.POSITIVE_INFINITY, null))
        // A non-finite c falls through to a finite f (web isFinite guard on each branch).
        assertEquals(100.0, temperatureSourceCelsius(Double.NaN, 212.0)!!, EPSILON)
    }

    // ── hover title (web `${c.toFixed(1)} °C` / `${f.toFixed(1)} °F`; SOURCE unit, not the preference) ────

    @Test
    fun titleRendersTheRawValueToOneDecimalWithItsSourceUnit() {
        assertEquals("23.5 °C", temperatureTitle(23.456, null))
        assertEquals("212.0 °F", temperatureTitle(null, 212.0))
        // c wins, so the title is its °C source even when f is also supplied.
        assertEquals("10.0 °C", temperatureTitle(10.0, 50.0))
        assertEquals("-5.0 °C", temperatureTitle(-5.0, null))
    }

    @Test
    fun titleIsNullWhenNeitherInputIsFinite() {
        assertNull(temperatureTitle(null, null))
        assertNull(temperatureTitle(Double.NaN, null))
    }

    // ── display precision (web `fmtNumber(value, precision)`: prop → settings → global default 2) ─────────

    @Test
    fun displayPrecisionPrefersThePropThenSettingsThenTheDefaultOfTwo() {
        assertEquals(3, temperatureDisplayPrecision(3, celsiusPrefs(precision = 1)))
        assertEquals(1, temperatureDisplayPrecision(null, celsiusPrefs(precision = 1)))
        assertEquals(TEMPERATURE_DEFAULT_PRECISION, temperatureDisplayPrecision(null, celsiusPrefs(precision = null)))
        assertEquals(2, temperatureDisplayPrecision(null, celsiusPrefs(precision = null)))
    }

    // ── full projection: the per-state snapshot ───────────────────────────────────────────────────────────

    @Test
    fun projectionFormatsACelsiusSourceInTheCelsiusPreference() {
        assertEquals(
            TemperatureProjection(hasValue = true, display = "23.46\u00B0C", title = "23.5 \u00B0C"),
            projectTemperature(c = 23.456, f = null, precision = 2, prefs = celsiusPrefs()),
        )
    }

    @Test
    fun projectionConvertsACelsiusSourceIntoTheFahrenheitPreferenceButKeepsTheCelsiusTitle() {
        // Display is the user's °F preference; the title stays the RAW °C source the caller supplied.
        assertEquals(
            TemperatureProjection(hasValue = true, display = "74.22\u00B0F", title = "23.5 \u00B0C"),
            projectTemperature(c = 23.456, f = null, precision = 2, prefs = fahrenheitPrefs()),
        )
    }

    @Test
    fun projectionConvertsAFahrenheitSourceIntoTheCelsiusPreferenceAtTheDefaultPrecision() {
        // precision prop null + settings precision null → the web fmtNumber default of 2 decimals.
        assertEquals(
            TemperatureProjection(hasValue = true, display = "100.00\u00B0C", title = "212.0 \u00B0F"),
            projectTemperature(c = null, f = 212.0, precision = null, prefs = celsiusPrefs()),
        )
    }

    @Test
    fun projectionRoundTripsAFahrenheitSourceBackToFahrenheitForDisplay() {
        assertEquals(
            TemperatureProjection(hasValue = true, display = "212.0\u00B0F", title = "212.0 \u00B0F"),
            projectTemperature(c = null, f = 212.0, precision = 1, prefs = fahrenheitPrefs()),
        )
    }

    @Test
    fun projectionHonorsTheSettingsPrecisionWhenNoPropIsGiven() {
        assertEquals(
            TemperatureProjection(hasValue = true, display = "23.5\u00B0C", title = "23.5 \u00B0C"),
            projectTemperature(c = 23.456, f = null, precision = null, prefs = celsiusPrefs(precision = 1)),
        )
    }

    @Test
    fun projectionFallsBackToTheEmDashWhenNoFiniteInput() {
        val projection = projectTemperature(c = null, f = null, precision = null, prefs = celsiusPrefs())
        assertFalse(projection.hasValue)
        assertEquals(TEMPERATURE_DASH, projection.display)
        assertNull(projection.title)
    }

    @Test
    fun theEmDashIsTheSingleCharacterUnicodeDash() {
        assertEquals("\u2014", TEMPERATURE_DASH)
        assertTrue(TEMPERATURE_DASH.none(Char::isDigit))
    }

    private companion object {
        const val EPSILON: Double = 1e-9

        /** Metric default preference (°C), optionally overriding the settings precision. */
        fun celsiusPrefs(precision: Int? = null): UnitPref = UnitFormatter.default().prefs.copy(precision = precision)

        /** Metric default flipped to the Fahrenheit display preference. */
        fun fahrenheitPrefs(precision: Int? = null): UnitPref =
            UnitFormatter
                .default()
                .prefs
                .copy(temperature = TemperatureUnitPref.FAHRENHEIT, precision = precision)
    }
}
