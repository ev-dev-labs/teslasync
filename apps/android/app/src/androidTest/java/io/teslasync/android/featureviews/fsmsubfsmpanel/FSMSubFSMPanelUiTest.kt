package io.teslasync.android.featureviews.fsmsubfsmpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [FSMSubFSMPanelContent] across every branch the
 * web component renders (loading / error / empty / content + the stale-offline freshness surface) plus the
 * web `fsmType` visibility gate. Asserts the always-present "Active Sub-FSMs" heading, the per-state body
 * strings, that the error-state retry exposes an accessible click action and routes to `onRefresh`, that the
 * live pulse dot carries its "Active" TalkBack label, and that a non-vehicle filter renders nothing. Runs
 * under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class FSMSubFSMPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        FsmSubFsmStrings(
            title = "Active Sub-FSMs",
            empty = "No active drive or charge sessions",
            driveLabel = "Drive Session",
            chargeLabel = "Charge Session",
            loading = "Loading sub-FSMs",
            error = "Failed to load data",
            retry = "Retry",
            activeLabel = "Active",
            offline = "Offline",
        )

    private val subs =
        listOf(
            ActiveSubFsm(kind = SubFsmKind.Drive, state = "active", startTime = "2026-06-11T11:30:00Z", driveId = 42),
            ActiveSubFsm(kind = SubFsmKind.Charge, state = "completing", startTime = "2026-06-11T11:55:00Z", sessionId = 7),
        )

    private fun contentState(stale: Boolean = false): UiState<List<ActiveSubFsm>> =
        UiState(
            phase = UiPhase.Content,
            data = subs,
            fetchedAt = FSMSubFSMPanelProjection.parseIsoMillis("2026-06-11T11:55:00Z"),
            stale = stale,
            errorKind = if (stale) ErrorKind.Network else null,
        )

    private fun setContent(
        state: UiState<List<ActiveSubFsm>>,
        fsmType: String = "vehicle",
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FSMSubFSMPanelContent(
                        state = state,
                        fsmType = fsmType,
                        onRefresh = onRefresh,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun headerAlwaysShowsTitleInVehicleView() {
        setContent(contentState())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun nonVehicleFilterRendersNothing() {
        setContent(contentState(), fsmType = "telemetry_connection")
        // Web parity: the panel returns null for any non-vehicle FSM filter.
        compose.onNodeWithText(strings.title).assertDoesNotExist()
        compose.onNodeWithText(strings.driveLabel).assertDoesNotExist()
    }

    @Test
    fun loadingShowsSpinnerMessageAndTitle() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.loading).assertIsDisplayed()
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun errorShowsMessageAndRetryableButton() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown), onRefresh = { refreshed = true })
        compose.onNodeWithText(strings.error).assertIsDisplayed()
        compose.onNodeWithText(strings.retry).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.retry).performClick()
        assertEquals(true, refreshed)
    }

    @Test
    fun emptyShowsEmptyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
    }

    @Test
    fun contentShowsBothSessionLabelsAndStateBadge() {
        setContent(contentState())
        compose.onNodeWithText(strings.driveLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.chargeLabel).assertIsDisplayed()
        // The charge sub-FSM is in the `completing` state — its raw state badge text.
        compose.onNodeWithText("completing").assertIsDisplayed()
    }

    @Test
    fun activeSubFsmExposesPulseDotAccessibilityLabel() {
        setContent(contentState())
        // The live drive sub-FSM's pulsing dot carries its "Active" TalkBack label (unmerged from the card).
        compose.onNodeWithContentDescription(strings.activeLabel, useUnmergedTree = true).assertExists()
    }

    @Test
    fun driveCardIsAddressableByTag() {
        setContent(contentState())
        compose.onNodeWithTag(fsmSubFsmCardTestTag(SubFsmKind.Drive)).assertIsDisplayed()
    }

    @Test
    fun offlineStaleStillRendersCachedContent() {
        setContent(contentState(stale = true))
        // Cached "last known" rows stay visible rather than blanking when stale/offline.
        compose.onNodeWithText(strings.driveLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.chargeLabel).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
