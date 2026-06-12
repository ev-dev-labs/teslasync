package io.teslasync.android.featureviews.livemotorstatus.drivingdynamics

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
 * Instrumented Compose UI + accessibility verification of [DrivingDynamicsLiveMotorStatusContent] across every
 * branch the web component renders (resolved four-cell grid / loading skeleton / empty), plus the
 * absent-temperature contract (the Motor gauge shows the "Awaiting data" caption, never a blank cell). Asserts
 * the rendered title, that each gauge exposes its label to TalkBack (the shared RadialGauge merges its
 * "label: value" into one content description), the value captions, the shift badge + caption, that the
 * loading chrome carries an accessible "Loading" announcement, and that no gauge content leaks while loading
 * or empty. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection.
 */
class DrivingDynamicsLiveMotorStatusUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DrivingDynamicsLiveMotorStatusStrings(
            title = "Live Motor Status",
            torque = "Torque",
            rpmFront = "Front RPM",
            motorTemp = "Motor",
            shiftState = "Shift State",
            awaiting = "Awaiting data",
            unknown = "Unknown",
            noData = "Awaiting live motor data",
            loadingLabel = "Loading",
        )

    private fun resolved(tempCaption: String = "48.0\u00B0C"): DrivingDynamicsLiveMotorStatusDisplay =
        DrivingDynamicsLiveMotorStatusDisplay(
            loading = false,
            hasData = true,
            gauges =
                listOf(
                    MotorGauge(strings.torque, 355.0, 1000.0, "Nm", 0, "355.00 Nm", MotorGaugeAccent.Torque),
                    MotorGauge(strings.rpmFront, 1240.0, 18000.0, "RPM", 0, "1,240 RPM", MotorGaugeAccent.Rpm),
                    MotorGauge(strings.motorTemp, 48.0, 200.0, "\u00B0C", 0, tempCaption, MotorGaugeAccent.Temp),
                ),
            shift = MotorShiftTile(strings.shiftState, "D", isDrive = true),
        )

    private fun empty(): DrivingDynamicsLiveMotorStatusDisplay =
        DrivingDynamicsLiveMotorStatusDisplay(loading = false, hasData = false, gauges = emptyList(), shift = null)

    private fun setContent(display: DrivingDynamicsLiveMotorStatusDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DrivingDynamicsLiveMotorStatusContent(display = display, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleEveryGaugeLabelCaptionsAndTheShiftTile() {
        setContent(resolved())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Each gauge merges its label into one "label: value" content description (RadialGauge accessibility).
        compose.onNodeWithContentDescription(strings.torque, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.rpmFront, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.motorTemp, substring = true).assertIsDisplayed()
        // The value caption below each gauge.
        compose.onNodeWithText("355.00 Nm").assertIsDisplayed()
        compose.onNodeWithText("1,240 RPM").assertIsDisplayed()
        compose.onNodeWithText("48.0\u00B0C").assertIsDisplayed()
        // The shift-state badge value + its caption.
        compose.onNodeWithText("D").assertIsDisplayed()
        compose.onNodeWithText(strings.shiftState).assertIsDisplayed()
    }

    @Test
    fun absentTemperatureRendersTheAwaitingCaptionNeverBlank() {
        setContent(resolved(tempCaption = strings.awaiting))
        // The Motor gauge stays present (its label is still exposed) and shows the "Awaiting data" caption.
        compose.onNodeWithContentDescription(strings.motorTemp, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.awaiting).assertIsDisplayed()
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesGaugeContent() {
        setContent(resolved().copy(loading = true))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton chrome is announced as a single "Loading" region, not a stack of empty boxes.
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
        // No gauge label or caption leaks while loading.
        compose.onNodeWithContentDescription(strings.torque, substring = true).assertDoesNotExist()
        compose.onNodeWithText("355.00 Nm").assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(empty())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.torque, substring = true).assertDoesNotExist()
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
