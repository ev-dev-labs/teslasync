package io.teslasync.android.featureviews.thermalloadpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [ThermalLoadPanelContent] across every branch the web
 * component renders (resolved bars + metrics / loading skeleton / empty), plus the "absent reading" contract (a
 * sensor with no value renders the em-dash readout and its bar stays present, never collapsing to a blank box).
 * Asserts the rendered title, sensor labels, metric labels, formatted values, and temperature readouts are
 * exposed to TalkBack, that the loading chrome carries an accessible "Loading" announcement, and that no content
 * leaks while loading or empty. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure projection.
 */
class ThermalLoadPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ThermalLoadPanelStrings(
            title = "Thermal Load Indicators",
            peakPower = "Peak Power",
            avgPower = "Avg Power",
            drives = "Drives",
            regenRatio = "Regen Ratio",
            noData = "No data available",
            loadingLabel = "Loading",
        )

    private val resolved =
        ThermalLoadDisplay(
            loading = false,
            bars =
                listOf(
                    ThermalBar("frontMotor", "Front Motor", 78.0, 150.0, ThermalSeverity.Good, "78.0\u00B0C"),
                    ThermalBar("battery", "Battery", 0.0, 60.0, ThermalSeverity.Unknown, EM_DASH),
                ),
            metrics =
                listOf(
                    ThermalInlineMetric(ThermalMetricKind.PeakPower, "247 kW"),
                    ThermalInlineMetric(ThermalMetricKind.AvgPower, "118.5 kW"),
                    ThermalInlineMetric(ThermalMetricKind.Drives, "1,284"),
                    ThermalInlineMetric(ThermalMetricKind.RegenRatio, "18.7%"),
                ),
            hasContent = true,
        )

    private fun setContent(display: ThermalLoadDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ThermalLoadPanelContent(display = display, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleLabelsValuesAndReadouts() {
        setContent(resolved)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every metric label is rendered (TalkBack reads each tile's label) — accessibility coverage.
        listOf(strings.peakPower, strings.avgPower, strings.drives, strings.regenRatio).forEach {
            compose.onNodeWithText(it).assertIsDisplayed()
        }
        // The sensor bar labels and a sample of the formatted values / temperature readouts.
        compose.onNodeWithText("Front Motor").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("247 kW").assertIsDisplayed()
        compose.onNodeWithText("1,284").assertIsDisplayed()
        compose.onNodeWithText("78.0\u00B0C").assertIsDisplayed()
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesContent() {
        setContent(resolved.copy(loading = true))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton chrome is announced as a single "Loading" region, not a stack of empty boxes.
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
        // No metric label or sensor label leaks while loading.
        compose.onNodeWithText(strings.peakPower).assertDoesNotExist()
        compose.onNodeWithText("Front Motor").assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(resolved.copy(bars = emptyList(), hasContent = false))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
        compose.onNodeWithText(strings.peakPower).assertDoesNotExist()
    }

    @Test
    fun absentSensorReadingRendersDashNeverBlankBar() {
        setContent(resolved)
        // The battery bar has no reading: its label stays present and its readout is the em-dash (one match,
        // since every metric in the resolved fixture carries a real value).
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onAllNodesWithText(EM_DASH).assertCountEquals(1)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
