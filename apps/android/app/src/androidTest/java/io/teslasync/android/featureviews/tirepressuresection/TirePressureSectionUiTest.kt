package io.teslasync.android.featureviews.tirepressuresection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TirePressureSectionContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * four-corner tiles, and the stale/offline cached view. Asserts the rendered i18n strings, each per-corner tile's
 * grouped TalkBack label (corner name + value + status), and the freshness chip's offline label. The offline
 * gate's `testReleaseUnitTest` covers the pure logic + per-state projection; this covers render + a11y. Mirrors
 * the web spec (web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx). Requires a device /
 * emulator to execute (instrumented); not part of the offline gate.
 */
class TirePressureSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TirePressureSectionStrings(
            title = "Tire Pressure",
            frontLeft = "Front Left",
            frontRight = "Front Right",
            rearLeft = "Rear Left",
            rearRight = "Rear Right",
            normal = "Normal",
            low = "Low",
            critical = "Critical",
            noData = "No Data",
            noTireData = "No tire pressure data available",
        )

    private fun setContent(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TirePressureSectionContent(
                    state = state,
                    formatter = UnitFormatter.default(),
                    strings = strings,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    // FL normal, FR soft-low, RL critical, RR absent → one of each badge state.
    private fun snapshot(): JsonElement =
        buildJsonObject {
            put("front_left", 250_000.0)
            put("front_right", 230_000.0)
            put("rear_left", 180_000.0)
        }

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState.loading())
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTireDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        compose.onNodeWithText("No tire pressure data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAndPerCornerTileAccessibilityLabels() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = 1L))
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        // Each corner tile is a grouped node whose TalkBack label carries the corner name + value + status.
        compose.onNodeWithContentDescription("Front Left", substring = true).assertExists()
        compose.onNodeWithContentDescription("Front Right", substring = true).assertExists()
        compose.onNodeWithContentDescription("Rear Left", substring = true).assertExists()
        compose.onNodeWithContentDescription("Rear Right", substring = true).assertExists()
        // The absent rear-right corner reads its "No Data" status in its grouped label.
        compose.onNodeWithContentDescription("No Data", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = snapshot(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRefresh = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
