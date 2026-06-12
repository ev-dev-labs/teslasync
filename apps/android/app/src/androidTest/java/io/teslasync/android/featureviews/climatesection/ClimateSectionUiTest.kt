package io.teslasync.android.featureviews.climatesection

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

/**
 * On-device Compose UI + accessibility verification of [ClimateSectionContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated tile
 * grid, and the stale/offline cached view. Asserts the rendered i18n strings (resolved from the real catalog,
 * P1/S10), a tile's grouped TalkBack label, and the freshness chip's TalkBack label. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx).
 */
class ClimateSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    // Catalog (P1/S10) values the assertions pin: the panel title + the no-data empty message.
    private val titleText = "Climate"
    private val emptyText = "No climate data available"
    private val errorText = "Something went wrong on our end. Please try again."
    private val insideLabel = "Cabin"
    private val fanLabel = "Fan Speed"
    private val offlineLabel = "Offline"

    private fun setContent(
        state: UiState<ClimateData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ClimateSectionContent(state = state, onRetry = onRetry)
            }
        }
    }

    private fun snapshot(): ClimateData =
        ClimateData(
            insideTempC = 21.5,
            outsideTempC = 12.0,
            driverSetpointC = 22.0,
            fanStatus = 3,
            seatHeaterLeft = 2,
            seatHeaterRight = 0,
            defrostMode = "Front",
            isClimateOn = true,
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(titleText).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(errorText).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoClimateDataMessage() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText(titleText).assertIsDisplayed()
        compose.onNodeWithText(emptyText).assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAndTileTalkBackLabels() {
        setContent(UiState(UiPhase.Content, data = snapshot()))
        compose.onNodeWithText(titleText).assertIsDisplayed()
        // Each tile is a grouped node whose TalkBack label carries the localized label + its value.
        compose.onNodeWithContentDescription(insideLabel, substring = true).assertExists()
        compose.onNodeWithContentDescription(fanLabel, substring = true).assertExists()
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
        compose.onNodeWithText(titleText).assertIsDisplayed()
        compose.onNodeWithContentDescription(offlineLabel).assertExists()
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
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(titleText).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
