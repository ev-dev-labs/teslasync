package io.teslasync.android.dashboard.widgets.safetyfeatures

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SafetyFeaturesWidgetContent] across every state the
 * web component renders (loading skeleton, empty "No safety data", hard error + retry, the full ADAS status
 * grid, the compact active-count hero, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the logic, this covers the render.
 */
class SafetyFeaturesWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    // 7 active cells (Ok): fcw, aeb, lda, elda, bsc, slw, cfd; bscw is Inactive.
    private fun safetySnapshot(): JsonElement =
        buildJsonObject {
            put("forward_collision_warning", "ForwardCollisionSensitivityMedium")
            put("automatic_emergency_braking_off", false)
            put("lane_departure_avoidance", "LaneAssistLevelWarning")
            put("emergency_lane_departure_avoidance", true)
            put("automatic_blind_spot_camera", true)
            put("blind_spot_collision_warning", false)
            put("speed_limit_warning", "SpeedAssistLevelChime")
            put("cruise_follow_distance", "FollowDistance3")
        }

    private fun setContent(
        state: UiState<JsonElement>,
        size: SafetyFeaturesSize = SafetyFeaturesRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SafetyFeaturesWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSafetyDataMessage() {
        setContent(UiState(UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("No safety data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun gridShowsTitleCellsAndValues() {
        setContent(UiState(UiPhase.Content, data = safetySnapshot(), fetchedAt = 1L))
        compose.onNodeWithText("Safety Features").assertIsDisplayed()
        // Each cell exposes one folded TalkBack phrase: "{label}, {value}".
        compose.onNodeWithContentDescription("Forward Collision Warning, Medium").assertIsDisplayed()
        compose.onNodeWithContentDescription("Auto Emergency Braking, Enabled").assertIsDisplayed()
        compose.onNodeWithContentDescription("Blind Spot Collision Warning, Disabled").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesActiveCountAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = safetySnapshot(), fetchedAt = 1L),
            size = SafetyFeaturesSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("7 Active Features").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = safetySnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached safety cells stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Forward Collision Warning, Medium").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = safetySnapshot(), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
