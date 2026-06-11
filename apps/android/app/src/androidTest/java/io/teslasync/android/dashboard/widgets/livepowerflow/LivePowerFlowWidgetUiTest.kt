package io.teslasync.android.dashboard.widgets.livepowerflow

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [LivePowerFlowWidgetContent] across every state
 * the web component renders (loading skeleton, title-less "No Tesla Energy site linked", the
 * "No live power data" placeholder, hard error + retry, the full power-routing diagram with per-node
 * TalkBack labels, and the stale/offline cached surface). Reduced motion is forced on so the infinite
 * arrow-dash animation never keeps the test frame busy and the count-up snaps to its final value. Runs
 * under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the logic, this covers the
 * render.
 */
class LivePowerFlowWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun snapshot(
        hasSites: Boolean = true,
        solar: Double = 0.0,
        battery: Double = 0.0,
        grid: Double = 0.0,
        load: Double = 0.0,
        hasStatus: Boolean = true,
    ): LivePowerFlowSnapshot =
        LivePowerFlowSnapshot(
            hasSites = hasSites,
            status = if (hasStatus) LivePowerStatus(solarW = solar, batteryW = battery, gridW = grid, homeW = load) else null,
        )

    private fun setContent(
        state: UiState<LivePowerFlowSnapshot>,
        size: LivePowerFlowSize = LivePowerFlowRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Box(modifier = Modifier.size(320.dp, 480.dp)) {
                        LivePowerFlowWidgetContent(
                            state = state,
                            size = size,
                            onRefresh = onRefresh,
                        )
                    }
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun noSiteShowsLinkMessage() {
        setContent(UiState(UiPhase.Empty, data = snapshot(hasSites = false, hasStatus = false), fetchedAt = 1L))
        compose.onNodeWithText("No Tesla Energy site linked").assertIsDisplayed()
    }

    @Test
    fun linkedSiteWithoutLiveBodyShowsNoLiveDataMessage() {
        setContent(UiState(UiPhase.Content, data = snapshot(hasSites = true, hasStatus = false), fetchedAt = 1L))
        compose.onNodeWithText("Live Power Flow").assertIsDisplayed()
        compose.onNodeWithText("No live power data").assertIsDisplayed()
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
    fun fullDiagramExposesTitleAndPerNodeLabels() {
        // solar 2.5 kW, grid 1.5 kW (exporting), home 1.0 kW, battery 0.8 kW (discharging).
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(solar = 2500.0, battery = -800.0, grid = -1500.0, load = 1000.0),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Live Power Flow").assertIsDisplayed()
        compose.onNodeWithContentDescription("Solar 2.5 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Grid 1.5 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Home 1.0 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery 0.8 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedDiagramVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(solar = 2500.0),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached solar readout stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Solar 2.5 kW").assertIsDisplayed()
    }
}
