package io.teslasync.android.featureviews.autopilotsection

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AutopilotSectionContent] across every state the web
 * component renders (loading skeletons, the three-card grid, empty → no-data message, hard error with retry,
 * stale/offline cached). Asserts the rendered i18n strings + converted values are present, the loading
 * skeleton exposes its "Loading" content description for TalkBack, and the error-retry control fires. Runs
 * under `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the
 * projection/state logic; this covers the render + a11y.
 */
class AutopilotSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val units: UnitPref = UnitPreferences.fromSettings(null)

    @Composable
    private fun strings(): AutopilotSectionStrings =
        AutopilotSectionStrings(
            title = stringResource(R.string.translation_dynamics_autopilot),
            currentSpeed = stringResource(R.string.translation_dynamics_currentSpeed),
            cruiseSetSpeed = stringResource(R.string.translation_dynamics_cruiseSetSpeed),
            followDistance = stringResource(R.string.translation_dynamics_followDistance),
            noData = AutopilotSectionDefaults.NO_DATA,
        )

    private fun snapshot(): AutopilotSnapshot =
        AutopilotSnapshot(speedMps = 10.0, cruiseSetMps = 27.5, followDistanceRaw = "FollowDistance7")

    private fun setContent(
        state: UiState<AutopilotSnapshot>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AutopilotSectionContent(state = state, units = units, strings = strings(), onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<AutopilotSnapshot> = UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCards() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Current Speed").assertDoesNotExist()
    }

    @Test
    fun contentShowsTitleLabelsAndConvertedValues() {
        setContent(contentState())
        compose.onNodeWithText("Autopilot & Cruise").assertIsDisplayed()
        compose.onNodeWithText("Current Speed").assertIsDisplayed()
        compose.onNodeWithText("Cruise Set Speed").assertIsDisplayed()
        compose.onNodeWithText("Follow Distance").assertIsDisplayed()
        // 10 m/s → 36 km/h, 27.5 m/s → 99 km/h, follow "FollowDistance7" → "7".
        compose.onNodeWithText("36").assertIsDisplayed()
        compose.onNodeWithText("99").assertIsDisplayed()
        compose.onNodeWithText("7").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataMessageNotCards() {
        setContent(UiState(phase = UiPhase.Empty, data = AutopilotSnapshot(), fetchedAt = 1L))
        compose.onNodeWithText(AutopilotSectionDefaults.NO_DATA).assertIsDisplayed()
        compose.onNodeWithText("Current Speed").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithRetryAndKeepsTitle() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Autopilot & Cruise").assertIsDisplayed()
        compose.onNodeWithText("Current Speed").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCardsVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("36").assertIsDisplayed()
        compose.onNodeWithText("7").assertIsDisplayed()
    }
}
