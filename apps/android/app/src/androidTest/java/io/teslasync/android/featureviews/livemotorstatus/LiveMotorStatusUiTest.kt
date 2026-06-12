package io.teslasync.android.featureviews.livemotorstatus

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [LiveMotorStatusContent] across every branch the
 * web component renders (resolved two-grid layout / loading skeleton / empty), plus the "present-but-empty"
 * contract (a metric whose reading is absent shows the em-dash, never a blank cell). Asserts the rendered
 * title, the four summary labels, the nine metric labels, sample values, and unit suffixes are exposed to
 * TalkBack, that the loading chrome carries an accessible "Loading" announcement, and that no label leaks
 * while loading or empty. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure projection.
 */
class LiveMotorStatusUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        LiveMotorStatusStrings(
            title = "Live Motor Status",
            shiftState = "Shift State",
            power = "Power",
            regen = "Regen",
            source = "Source",
            rpmFront = "Front Motor RPM",
            rpmRear = "Rear Motor RPM",
            torqueFront = "Front Torque",
            torqueRear = "Rear Torque",
            motorTempFront = "Front Motor Temp",
            motorTempRear = "Rear Motor Temp",
            inverterTemp = "Inverter Temp",
            batteryTemp = "Battery Temp",
            isolationResistance = "HV Isolation",
            noData = "No live motor telemetry yet",
            loadingLabel = "Loading",
        )

    private val summaryLabels =
        listOf(strings.shiftState, strings.power, strings.regen, strings.source)

    private val metricLabels =
        listOf(
            strings.rpmFront,
            strings.rpmRear,
            strings.torqueFront,
            strings.torqueRear,
            strings.motorTempFront,
            strings.motorTempRear,
            strings.inverterTemp,
            strings.batteryTemp,
            strings.isolationResistance,
        )

    private val resolved =
        LiveMotorStatusDisplay(
            loading = false,
            hasData = true,
            summary =
                listOf(
                    MotorSummaryTile(MotorSummaryKey.ShiftState, "D", MotorAccent.Cyan),
                    MotorSummaryTile(MotorSummaryKey.Power, "42.50 kW", MotorAccent.Purple),
                    MotorSummaryTile(MotorSummaryKey.Regen, "0.00 kW", MotorAccent.Green),
                    MotorSummaryTile(MotorSummaryKey.Source, "telemetry", MotorAccent.Primary),
                ),
            metrics =
                listOf(
                    MotorMetric(MotorMetricKey.RpmFront, "1,240 RPM", MotorAccent.Cyan),
                    MotorMetric(MotorMetricKey.RpmRear, "1,238 RPM", MotorAccent.Purple),
                    MotorMetric(MotorMetricKey.TorqueFront, "180.00 Nm", MotorAccent.Cyan),
                    MotorMetric(MotorMetricKey.TorqueRear, "175.00 Nm", MotorAccent.Purple),
                    MotorMetric(MotorMetricKey.MotorTempFront, "48.00 \u00B0C", MotorAccent.Red),
                    MotorMetric(MotorMetricKey.MotorTempRear, "47.00 \u00B0C", MotorAccent.Red),
                    MotorMetric(MotorMetricKey.InverterTemp, "52.00 \u00B0C", MotorAccent.Amber),
                    MotorMetric(MotorMetricKey.BatteryTemp, "31.00 \u00B0C", MotorAccent.Green),
                    MotorMetric(MotorMetricKey.HvIsolation, "\u2014", MotorAccent.Muted),
                ),
        )

    private fun setContent(display: LiveMotorStatusDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LiveMotorStatusContent(display = display, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleEveryLabelAndSampleValues() {
        setContent(resolved)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every summary + metric label is rendered (TalkBack reads each cell's label) — accessibility coverage.
        (summaryLabels + metricLabels).forEach { compose.onNodeWithText(it).assertIsDisplayed() }
        // A sample of the formatted values across each metric family.
        compose.onNodeWithText("42.50 kW").assertIsDisplayed()
        compose.onNodeWithText("1,240 RPM").assertIsDisplayed()
        compose.onNodeWithText("180.00 Nm").assertIsDisplayed()
        compose.onNodeWithText("48.00 \u00B0C").assertIsDisplayed()
    }

    @Test
    fun absentReadingRendersDashNeverBlankCell() {
        setContent(resolved)
        // The HV-isolation metric's value is absent; its cell shows the em-dash and stays present (its label
        // is still rendered), so the cell never collapses to a blank box.
        compose.onNodeWithText(strings.isolationResistance).assertIsDisplayed()
        compose.onNodeWithText("\u2014").assertIsDisplayed()
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesLabels() {
        setContent(resolved.copy(loading = true))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton chrome is announced as a single "Loading" region, not a stack of empty boxes.
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
        // No metric label leaks while loading.
        compose.onNodeWithText(strings.rpmFront).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(
            LiveMotorStatusDisplay(loading = false, hasData = false, summary = emptyList(), metrics = emptyList()),
        )
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
        compose.onNodeWithText(strings.shiftState).assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
