package io.teslasync.android.featureviews.gforcepanel

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [GForcePanelContent] across every state the web
 * component renders (loading skeletons, the three-tile grid, empty → friendly message, hard error with retry,
 * stale/offline cached). Asserts the rendered i18n strings + the per-tile merged TalkBack content descriptions
 * are present, and that the error-retry control fires. Runs under `connectedAndroidTest` (a device/emulator) —
 * the offline gate's `testReleaseUnitTest` covers the projection/state logic; this covers the render + a11y.
 */
class GForcePanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun gForceSnapshot(): JsonElement =
        buildJsonObject {
            put("lateral_acceleration", 0.30)
            put("longitudinal_acceleration", 0.40)
        }

    @Composable
    private fun panelStrings(): GForcePanelStrings =
        GForcePanelStrings(
            title = stringResource(R.string.translation_dynamics_gForce),
            lateral = stringResource(R.string.translation_dynamics_lateral),
            longitudinal = stringResource(R.string.translation_dynamics_longitudinal),
            combined = stringResource(R.string.translation_dynamics_combined),
            noData = stringResource(R.string.translation_dynamics_gForceNoData),
        )

    private fun setPanel(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GForcePanelContent(state = state, strings = panelStrings(), locale = Locale.US, onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = gForceSnapshot(), fetchedAt = 1L)

    @Test
    fun loadingShowsTitleAndSkeletonNotValues() {
        setPanel(UiState.loading())
        compose.onNodeWithText("Acceleration G-Force").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("0.30").assertDoesNotExist()
    }

    @Test
    fun contentShowsTitleLabelsAndValues() {
        setPanel(contentState())
        compose.onNodeWithText("Acceleration G-Force").assertIsDisplayed()
        compose.onNodeWithText("Lateral").assertIsDisplayed()
        compose.onNodeWithText("Longitudinal").assertIsDisplayed()
        compose.onNodeWithText("Combined").assertIsDisplayed()
        compose.onNodeWithText("0.30").assertIsDisplayed()
        compose.onNodeWithText("0.40").assertIsDisplayed()
        compose.onNodeWithText("0.50").assertIsDisplayed()
    }

    @Test
    fun tilesExposeMergedTalkBackLabels() {
        setPanel(contentState())
        compose.onNodeWithContentDescription("Lateral, 0.30 g").assertIsDisplayed()
        compose.onNodeWithContentDescription("Longitudinal, 0.40 g").assertIsDisplayed()
        compose.onNodeWithContentDescription("Combined, 0.50 g").assertIsDisplayed()
    }

    @Test
    fun emptyRendersFriendlyMessageNotTiles() {
        setPanel(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("Acceleration G-Force").assertIsDisplayed()
        compose.onNodeWithText("No G-force telemetry received yet").assertIsDisplayed()
        compose.onNodeWithText("Lateral").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithRetry() {
        var refreshed = false
        setPanel(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Lateral").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedTilesVisible() {
        setPanel(
            UiState(
                phase = UiPhase.Content,
                data = gForceSnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("0.30").assertIsDisplayed()
        compose.onNodeWithText("0.50").assertIsDisplayed()
    }
}
