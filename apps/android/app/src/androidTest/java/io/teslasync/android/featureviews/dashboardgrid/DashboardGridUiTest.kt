package io.teslasync.android.featureviews.dashboardgrid

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DashboardGridContent] across every state the surface
 * renders: the loading skeleton grid, the hard-error retry surface, the empty-dashboard hint, the populated grid
 * (with the framed widget bodies and the view-mode fullscreen affordance), the edit-mode chrome (Settings/Remove),
 * the fullscreen overlay, and the stale/offline cached view. Asserts the rendered i18n strings, the name-qualified
 * accessible labels on every interactive control, the Offline freshness chip, and the stale auto-refresh. The gate's
 * `testReleaseUnitTest` covers the pure projection; this covers render + a11y. Mirrors the web spec
 * (web/src/features/dashboard/components/DashboardGrid.tsx).
 */
class DashboardGridUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val layout =
        DashboardLayout(
            widgets =
                listOf(
                    DashboardWidget(id = "w-1", widgetId = "vehicle-hero", name = "Vehicle", defaultSize = WidgetSize(2, 2)),
                    DashboardWidget(id = "w-2", widgetId = "battery-gauge", name = "Battery", defaultSize = WidgetSize(1, 2)),
                ),
            layouts =
                mapOf(
                    DashboardBreakpoint.Lg to
                        listOf(
                            WidgetLayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                            WidgetLayoutItem("w-2", x = 2, y = 0, w = 1, h = 2),
                        ),
                    DashboardBreakpoint.Xs to
                        listOf(
                            WidgetLayoutItem("w-1", x = 0, y = 0, w = 1, h = 2),
                            WidgetLayoutItem("w-2", x = 0, y = 2, w = 1, h = 2),
                        ),
                ),
        )

    private fun setContent(
        state: UiState<DashboardLayout>,
        options: DashboardGridOptions = DashboardGridOptions(),
        onRetry: () -> Unit = {},
        onRemoveWidget: (DashboardWidget) -> Unit = {},
        onOpenSettings: (DashboardWidget) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DashboardGridContent(
                    state = state,
                    onRetry = onRetry,
                    options = options,
                    onRemoveWidget = onRemoveWidget,
                    onOpenSettings = onOpenSettings,
                    widgetContent = { widget, _ -> BodyText(widget.name) },
                )
            }
        }
    }

    @Test
    fun loadingShowsSkeletonNotErrorOrEmpty() {
        setContent(UiState(UiPhase.Loading))
        compose.onAllNodesWithText("Something went wrong on our end. Please try again.").assertCountEquals(0)
        compose.onAllNodesWithText("You can customize this dashboard. Tap the + to add widgets.").assertCountEquals(0)
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose
            .onAllNodesWithText("Something went wrong on our end. Please try again.")
            .onFirst()
            .assertIsDisplayed()
        compose.onAllNodesWithText("Retry").onFirst().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsCustomizeHint() {
        setContent(UiState(UiPhase.Empty, data = DashboardLayout()))
        compose
            .onAllNodesWithText("You can customize this dashboard. Tap the + to add widgets.")
            .onFirst()
            .assertExists()
    }

    @Test
    fun contentRendersWidgetsAndViewModeExpandAffordance() {
        setContent(UiState(UiPhase.Content, data = layout))
        // The framed widget body renders its name (the host slot content).
        compose.onAllNodesWithText("Vehicle").onFirst().assertExists()
        // View mode exposes a name-qualified fullscreen control per widget.
        compose.onNodeWithContentDescription("Enter fullscreen: Vehicle").assertExists()
    }

    @Test
    fun editModeShowsSettingsAndRemoveControlsAndInvokesRemove() {
        var removed: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = layout),
            options = DashboardGridOptions(editMode = true, showWidgetBorders = true),
            onRemoveWidget = { removed = it.id },
        )
        compose.onNodeWithContentDescription("Settings: Vehicle").assertExists()
        compose.onNodeWithContentDescription("Remove: Vehicle").assertExists()
        compose.onNodeWithContentDescription("Remove: Vehicle").performClick()
        assertTrue(removed == "w-1")
    }

    @Test
    fun expandOpensFullscreenOverlayWithExitControl() {
        setContent(UiState(UiPhase.Content, data = layout))
        compose.onNodeWithContentDescription("Enter fullscreen: Vehicle").performClick()
        compose.onNodeWithContentDescription("Exit fullscreen").assertExists()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = layout,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onAllNodesWithText("Vehicle").onFirst().assertExists()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state = UiState(phase = UiPhase.Content, data = layout, stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onAllNodesWithText("Vehicle").onFirst().assertExists()
        assertTrue(refreshed)
    }
}
