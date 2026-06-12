package io.teslasync.android.featureviews.pedalusage

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [PedalUsageContent] across every branch the web
 * component renders (the three-up gauge row / loading skeleton / empty), plus the per-cell nuances: the
 * brake-status Badge flips with the brake state, and an absent gauge reading shows the em-dash unit rather
 * than a blank cell. Asserts the rendered title, the three captions, the Badge text, and each gauge's
 * accessible value description are exposed to TalkBack, that the loading chrome carries an accessible
 * "Loading" announcement, and that no content leaks while loading or empty. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class PedalUsageUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        PedalUsageStrings(
            title = "Pedal Usage",
            throttle = "Throttle",
            throttlePosition = "Throttle Position",
            brake = "Brake",
            brakePedalPosition = "Brake Pedal Position",
            brakeActive = "Brake Active",
            brakeInactive = "Brake Inactive",
            brakePedal = "Brake Pedal Status",
            noData = "No pedal telemetry received yet",
            loadingLabel = "Loading",
        )

    private val resolved =
        PedalUsageProjection.project(
            DriveDynamicsLive(pedalPosition = 42.0, brakePedalPosition = 0.0, brakePedalActive = false),
            loading = false,
            precision = DEFAULT_DECIMAL_PRECISION,
        )

    private fun setContent(
        display: PedalUsageDisplay,
        hostWidth: Dp = NARROW_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host(width = hostWidth) {
                    PedalUsageContent(display = display, strings = strings)
                }
            }
        }
    }

    @Test
    fun dataStateShowsTitleCaptionsBadgeAndGauges() {
        setContent(resolved)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every caption is rendered (TalkBack reads each cell) — accessibility coverage.
        compose.onNodeWithText(strings.throttlePosition).assertIsDisplayed()
        compose.onNodeWithText(strings.brakePedalPosition).assertIsDisplayed()
        compose.onNodeWithText(strings.brakePedal).assertIsDisplayed()
        // Brake state is inactive for this snapshot → the success Badge copy.
        compose.onNodeWithText(strings.brakeInactive).assertIsDisplayed()
        // Each gauge exposes a single "<label>: <value>" description (substring keeps it locale-robust).
        compose.onNodeWithContentDescription(strings.throttle, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.brake, substring = true).assertIsDisplayed()
    }

    @Test
    fun brakeActiveFlipsTheBadge() {
        setContent(
            PedalUsageProjection.project(
                DriveDynamicsLive(pedalPosition = 0.0, brakePedalPosition = 80.0, brakePedalActive = true),
                loading = false,
                precision = DEFAULT_DECIMAL_PRECISION,
            ),
        )
        compose.onNodeWithText(strings.brakeActive).assertIsDisplayed()
        compose.onNodeWithText(strings.brakeInactive).assertDoesNotExist()
    }

    @Test
    fun absentReadingRendersDashUnitNeverBlankCell() {
        // Throttle present, brake absent: `hasAny` is still true, so the grid renders and the brake gauge
        // shows the em-dash unit ("Brake: 0 —") rather than collapsing to a blank cell.
        setContent(
            PedalUsageProjection.project(
                DriveDynamicsLive(pedalPosition = 42.0, brakePedalPosition = null, brakePedalActive = null),
                loading = false,
                precision = DEFAULT_DECIMAL_PRECISION,
            ),
        )
        compose.onNodeWithContentDescription(strings.throttle, substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(DASH, substring = true).assertIsDisplayed()
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesContent() {
        setContent(resolved.copy(loading = true))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton chrome is announced as a single "Loading" region, not a stack of empty boxes.
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
        // No caption leaks while loading.
        compose.onNodeWithText(strings.throttlePosition).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(PedalUsageProjection.project(null, loading = false, precision = DEFAULT_DECIMAL_PRECISION))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
        compose.onNodeWithText(strings.throttlePosition).assertDoesNotExist()
    }

    @Test
    fun wideLayoutShowsAllThreeCells() {
        setContent(resolved, hostWidth = WIDE_WIDTH)
        compose.onNodeWithText(strings.throttlePosition).assertIsDisplayed()
        compose.onNodeWithText(strings.brakePedalPosition).assertIsDisplayed()
        compose.onNodeWithText(strings.brakePedal).assertIsDisplayed()
        compose.onNodeWithText(strings.brakeInactive).assertIsDisplayed()
    }

    @Composable
    private fun Host(
        width: Dp,
        content: @Composable () -> Unit,
    ) {
        Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val NARROW_WIDTH = 420.dp
        val WIDE_WIDTH = 760.dp
        val HOST_HEIGHT = 1200.dp
    }
}
