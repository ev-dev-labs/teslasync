package io.teslasync.android.featureviews.drivingtips

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [DrivingTipsContent] across every branch the web
 * component renders (the three power-band tip pairs, the optional thermal tip, and the absent-motorStats
 * friendly tip), plus the `throttleStyle` glyph selection. Asserts the rendered title and each tip's readable
 * text are exposed to TalkBack (the tip text is the accessible label), and that a tip from a different branch
 * never leaks. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection.
 */
class DrivingTipsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DrivingTipsStrings(
            title = "Driving Style Recommendations",
            tips =
                mapOf(
                    DrivingTip.NoData to "Drive your vehicle to start collecting dynamics data.",
                    DrivingTip.EaseAccel to "Ease into the accelerator to save energy.",
                    DrivingTip.BrakeEarly to "Brake earlier and lighter to improve regen capture.",
                    DrivingTip.SmoothThrottle to "Smooth throttle transitions improve efficiency.",
                    DrivingTip.Coast to "Lift off the pedal earlier to let regen do the work.",
                    DrivingTip.Great to "Excellent driving style that maximizes range.",
                    DrivingTip.Keep to "Keep monitoring your scores; consistency is key.",
                    DrivingTip.Thermal to "Motor temps are running high; ease off sustained power.",
                ),
        )

    private fun setContent(
        motorStats: MotorStats?,
        throttleStyle: ThrottleStyle?,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DrivingTipsContent(motorStats = motorStats, throttleStyle = throttleStyle, strings = strings)
                }
            }
        }
    }

    @Test
    fun efficientConservativeShowsTitleAndGreatKeepTips() {
        setContent(MotorStats(avgPower = 10.0, maxMotorTemp = 60.0), ThrottleStyle.Conservative)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.Great)).assertIsDisplayed()
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.Keep)).assertIsDisplayed()
        // A tip from a different power band never leaks.
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.EaseAccel)).assertDoesNotExist()
    }

    @Test
    fun aggressiveShowsHighPowerPairPlusThermalTip() {
        setContent(MotorStats(avgPower = 150.0, maxMotorTemp = 130.0), ThrottleStyle.Aggressive)
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.EaseAccel)).assertIsDisplayed()
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.BrakeEarly)).assertIsDisplayed()
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.Thermal)).assertIsDisplayed()
    }

    @Test
    fun absentMotorStatsShowsTheFriendlyNoDataTip() {
        setContent(motorStats = null, throttleStyle = null)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.NoData)).assertIsDisplayed()
        // The data-present coaching tips never render in the empty branch.
        compose.onNodeWithText(strings.tips.getValue(DrivingTip.Great)).assertDoesNotExist()
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
