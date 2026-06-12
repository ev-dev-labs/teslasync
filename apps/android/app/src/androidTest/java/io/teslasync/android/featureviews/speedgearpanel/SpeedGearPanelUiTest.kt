package io.teslasync.android.featureviews.speedgearpanel

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SpeedGearPanelContent] across every state the surface
 * renders: the first-load skeleton (its "Loading" a11y label, with no cell label leaking), the hard-error
 * retry surface (title + working retry), the friendly empty state (the catalog "no data" message, never a
 * blank box), and the populated four-cell content (the title, the shift letter + every cell label, and the
 * single-conversion mph values). Also asserts a value cell whose figure is absent renders the em-dash rather
 * than collapsing. Strings are resolved from the catalog via the host activity so the assertions can never
 * drift from the i18n wording, and the panel is hosted under reduced motion so the FadeIn entrance collapses
 * to its final state and every label is present immediately. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure projection. Mirrors the web spec
 * (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx).
 */
class SpeedGearPanelUiTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val dash = "\u2014"

    private fun str(id: Int): String = compose.activity.getString(id)

    private fun mphPrefs(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.MI,
            speed = SpeedUnitPref.MPH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.PSI,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = 2,
        )

    private fun setContent(
        state: UiState<SpeedGearSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        SpeedGearPanelContent(state = state, onRetry = onRetry, prefs = mphPrefs())
                    }
                }
            }
        }
    }

    /** Scrolls the panel so [text] is in view, then asserts it is displayed. */
    private fun assertShown(text: String) {
        compose.onNodeWithText(text).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersSkeletonWithTheLoadingA11yLabelAndNoCellLabels() {
        setContent(UiState(UiPhase.Loading))
        // The title chrome is always present; the skeleton is announced as a single "Loading" region.
        assertShown(str(R.string.translation_dynamics_speedGear))
        compose.onNodeWithContentDescription(str(R.string.translation_a11y_loading)).assertIsDisplayed()
        // No cell label leaks while loading.
        compose.onNodeWithText(str(R.string.translation_dynamics_shiftState)).assertDoesNotExist()
        compose.onNodeWithText(str(R.string.translation_dynamics_power)).assertDoesNotExist()
    }

    @Test
    fun errorStateRendersTitleAndAWorkingRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        assertShown(str(R.string.translation_dynamics_speedGear))
        assertShown(str(R.string.translation_error_serverError_title))
        compose.onNodeWithText(str(R.string.translation_common_retry)).performScrollTo().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyStateRendersTheNoDataMessageNeverABlankBox() {
        setContent(SpeedGearPanelProjection.projectUiState(snapshot = null, isLoading = false))

        assertShown(str(R.string.translation_dynamics_speedGear))
        assertShown(str(R.string.translation_common_noData))
        // No cell label leaks in the empty state.
        compose.onNodeWithText(str(R.string.translation_dynamics_avgDriveSpeed)).assertDoesNotExist()
    }

    @Test
    fun populatedContentRendersTitleShiftEveryLabelAndSingleConvertedValues() {
        setContent(
            SpeedGearPanelProjection.projectUiState(
                SpeedGearSnapshot(
                    motor = MotorShift(shiftState = "D", powerKw = 42.5),
                    drives = listOf(DriveSpeedSample(avgSpeedMps = 22.352, maxSpeedMps = 44.704)),
                ),
                isLoading = false,
            ),
        )

        assertShown(str(R.string.translation_dynamics_speedGear))
        // Every cell label is rendered (TalkBack reads each) — accessibility coverage.
        assertShown(str(R.string.translation_dynamics_shiftState))
        assertShown(str(R.string.translation_dynamics_power))
        assertShown(str(R.string.translation_dynamics_avgDriveSpeed))
        assertShown(str(R.string.translation_dynamics_topDriveSpeed))
        // The shift letter + the single-conversion values (44.704 m/s = 100 mph, 22.352 m/s = 50 mph), not the
        // pre-fix double-converted "224" / "112".
        assertShown("D")
        assertShown("42.50")
        assertShown("50")
        assertShown("100")
    }

    @Test
    fun absentValueRendersDashNeverBlankCell() {
        setContent(
            SpeedGearPanelProjection.projectUiState(
                // Parked, no power reading, no drives in range → power + both speeds render the em-dash.
                SpeedGearSnapshot(motor = MotorShift(shiftState = "P", powerKw = null), drives = emptyList()),
                isLoading = false,
            ),
        )

        assertShown(str(R.string.translation_dynamics_avgDriveSpeed))
        assertShown("P")
        // The absent figures show the em-dash and stay present, so no cell collapses to a blank box.
        assertTrue(compose.onAllNodesWithText(dash).fetchSemanticsNodes().isNotEmpty())
    }
}
