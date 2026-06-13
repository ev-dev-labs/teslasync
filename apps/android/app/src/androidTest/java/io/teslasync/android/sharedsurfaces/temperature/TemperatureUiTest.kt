package io.teslasync.android.sharedsurfaces.temperature

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [TemperatureContent] view — the parity port of the web `Temperature`
 * (web/src/components/data-display/format/Temperature.tsx). Covers every web render branch: a °C source in
 * the °C preference, a °C source converted into the °F preference, a °F source converted into the °C
 * preference, and the em-dash branch when no finite input is supplied. Also asserts the accessibility label:
 * the read-out's formatted text is what a screen reader announces (the web `<span>` text content). The
 * offline `:android:testReleaseUnitTest` gate covers the pure projection + the diagnostics emitter.
 */
class TemperatureUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: a °C source renders in the °C preference ───────────────────────────────────────────────────

    @Test
    fun aCelsiusSourceRendersInTheCelsiusPreference() {
        mount { TemperatureContent(prefs = celsiusPrefs(), c = CELSIUS_SOURCE) }

        compose.onNodeWithText(CELSIUS_IN_CELSIUS).assertIsDisplayed()
    }

    // ── State: a °C source is converted into the °F preference ────────────────────────────────────────────

    @Test
    fun aCelsiusSourceIsConvertedIntoTheFahrenheitPreference() {
        mount { TemperatureContent(prefs = fahrenheitPrefs(), c = CELSIUS_SOURCE) }

        compose.onNodeWithText(CELSIUS_IN_FAHRENHEIT).assertIsDisplayed()
    }

    // ── State: a °F source is converted into the °C preference ────────────────────────────────────────────

    @Test
    fun aFahrenheitSourceIsConvertedIntoTheCelsiusPreference() {
        mount { TemperatureContent(prefs = celsiusPrefs(), f = FAHRENHEIT_SOURCE) }

        compose.onNodeWithText(FAHRENHEIT_IN_CELSIUS).assertIsDisplayed()
    }

    // ── State: no finite input renders the em-dash and never a numeric read-out ───────────────────────────

    @Test
    fun noFiniteInputRendersTheEmDash() {
        mount { TemperatureContent(prefs = celsiusPrefs()) }

        compose.onNodeWithText(EM_DASH).assertIsDisplayed()
        compose.onAllNodesWithText(CELSIUS_IN_CELSIUS).assertCountEquals(0)
    }

    // ── Accessibility: the formatted read-out text is the screen-reader label ─────────────────────────────

    @Test
    fun theReadoutExposesItsFormattedTextAsTheAccessibilityLabel() {
        mount { TemperatureContent(prefs = celsiusPrefs(), c = CELSIUS_SOURCE) }

        // The visible Text is the merged-tree node a screen reader announces.
        compose.onNodeWithText(CELSIUS_IN_CELSIUS).assertExists()
    }

    private fun mount(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
        compose.waitForIdle()
    }

    private companion object {
        const val CELSIUS_SOURCE: Double = 23.456
        const val FAHRENHEIT_SOURCE: Double = 212.0

        // The en/default-locale read-outs the surface formats (precision defaults to 2; no space before °).
        const val CELSIUS_IN_CELSIUS = "23.46\u00B0C"
        const val CELSIUS_IN_FAHRENHEIT = "74.22\u00B0F"
        const val FAHRENHEIT_IN_CELSIUS = "100.00\u00B0C"
        const val EM_DASH = "\u2014"

        fun celsiusPrefs(): UnitPref = UnitFormatter.default().prefs

        fun fahrenheitPrefs(): UnitPref = UnitFormatter.default().prefs.copy(temperature = TemperatureUnitPref.FAHRENHEIT)
    }
}
