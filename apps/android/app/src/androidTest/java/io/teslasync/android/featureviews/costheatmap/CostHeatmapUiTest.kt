package io.teslasync.android.featureviews.costheatmap

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [CostHeatmapContent] across every state the surface
 * renders (loading skeleton, the cost grid + legend, empty → friendly message, hard error with retry, and
 * stale/offline cached). Asserts the rendered i18n strings, the busy-cell merged TalkBack content
 * description (the native analogue of the web cell `title`), and that the error-retry control fires. Runs
 * under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection/state
 * logic, this covers the render + a11y. Strings + locale are pinned for deterministic assertions.
 */
class CostHeatmapUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        CostHeatmapStrings(
            title = "Charging Cost Heatmap",
            cheap = "Cheap",
            expensive = "Expensive",
            sessionsWord = "sessions",
            perKwhWord = "Per kWh",
            emptyMessage = "No data available",
        )

    private val busyData =
        CostHeatmapData(
            heatmap = listOf(CostHeatmapEntry(day = 1, hour = 2, sessions = 3, avgCostPerKwh = 0.15)),
            peakCostPerKwh = 0.30,
        )

    private fun setContent(
        state: UiState<CostHeatmapData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CostHeatmapContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun contentShowsTitleGridAndLegend() {
        setContent(UiState(phase = UiPhase.Content, data = busyData, fetchedAt = 1L))
        compose.onNodeWithText("Charging Cost Heatmap").assertIsDisplayed()
        compose.onNodeWithText("Cheap").assertIsDisplayed()
        compose.onNodeWithText("Expensive").assertIsDisplayed()
    }

    @Test
    fun contentExposesBusyCellLabelToTalkBack() {
        setContent(UiState(phase = UiPhase.Content, data = busyData, fetchedAt = 1L))
        // The web cell `title` analogue: localized day + hour + session count + formatted cost.
        compose.onNodeWithContentDescription("Mon 2:00, 3 sessions, $0.150 Per kWh").assertExists()
    }

    @Test
    fun loadingShowsSkeletonNotGrid() {
        setContent(UiState.loading())
        compose.onNodeWithText("Charging Cost Heatmap").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertExists()
        compose.onNodeWithText("Cheap").assertDoesNotExist()
    }

    @Test
    fun emptyShowsFriendlyMessageNotGrid() {
        setContent(UiState(phase = UiPhase.Empty, data = CostHeatmapData.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("Charging Cost Heatmap").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
        compose.onNodeWithText("Cheap").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryThatFires() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { refreshed = true })
        compose.onNodeWithText("Charging Cost Heatmap").assertIsDisplayed()
        compose.onNodeWithText("Cheap").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedGridVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = busyData,
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Cheap").assertIsDisplayed()
        compose.onNodeWithContentDescription("Mon 2:00, 3 sessions, $0.150 Per kWh").assertExists()
    }
}
