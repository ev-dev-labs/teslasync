package io.teslasync.android.featureviews.batteryhealthsection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [BatteryHealthSectionContent] across every branch
 * the web component renders (content: title + two pills + three mini stats; loading skeletons; empty), plus
 * the lifecycle chrome the host's feed implies (a hard error with an accessible retry, and the stale/offline
 * freshness chip over cached content). Asserts the rendered title/labels/values, that the empty message and
 * the pill/stat labels are exposed to TalkBack, and that the retry affordance carries an accessible click
 * action that drives the host's refetch. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection.
 */
class BatteryHealthSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        BatteryHealthSectionStrings(
            title = "Battery Health",
            avgBatteryStart = "Avg Battery at Charge Start",
            avgBatteryEnd = "Avg Battery at Charge End",
            avgChargeGain = "Avg Charge Gain",
            chargeSessions = "Charge Sessions",
            estRangeAdded = "Est. Range Added",
            noData = "No data available",
        )

    private val snapshot =
        BatteryHealthSnapshot(
            batteryStart = 22.4,
            batteryEnd = 78.6,
            chargingSessionCount = 12,
            chargeEnergyAdded = 240.0,
        )

    private fun setContent(
        state: UiState<BatteryHealthSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    BatteryHealthSectionContent(state = state, onRetry = onRetry, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleLabelsAndValues() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // Title + every pill/stat label is rendered (TalkBack reads each) — accessibility coverage.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.avgBatteryStart).assertIsDisplayed()
        compose.onNodeWithText(strings.avgBatteryEnd).assertIsDisplayed()
        compose.onNodeWithText(strings.chargeSessions).assertIsDisplayed()
        compose.onNodeWithText(strings.estRangeAdded).assertIsDisplayed()
        // Rounded pill percentages, the one-decimal gain, and the session count.
        compose.onNodeWithText("22%").assertIsDisplayed()
        compose.onNodeWithText("79%").assertIsDisplayed()
        compose.onNodeWithText("56.2%").assertIsDisplayed()
        compose.onNodeWithText("12").assertIsDisplayed()
    }

    @Test
    fun loadingShowsTitleButNoPillLabels() {
        setContent(UiState.loading())
        // The panel + title chrome stays visible; the skeleton body carries no pill/stat labels.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.avgBatteryStart).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached pills/values visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.avgBatteryStart).assertIsDisplayed()
        compose.onNodeWithText("22%").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
