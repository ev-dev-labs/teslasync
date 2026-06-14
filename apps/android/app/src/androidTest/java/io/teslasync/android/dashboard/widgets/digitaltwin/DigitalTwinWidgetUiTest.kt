package io.teslasync.android.dashboard.widgets.digitaltwin

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
 * On-device Compose UI + accessibility verification of [DigitalTwinWidgetContent] across every state the web
 * component renders (loading skeleton, twin + status badges + vehicle label, no-vehicle empty, offline
 * cached, hard-error-with-retry). Asserts the rendered i18n strings, the twin's folded TalkBack content
 * description and the labelled refresh control. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class DigitalTwinWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = DigitalTwinRegistration.DEFAULT_SIZE

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        rule.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Locked").assertDoesNotExist()
        rule.onNodeWithText("No vehicle data").assertDoesNotExist()
    }

    @Test
    fun contentShowsTitleBadgesAndLabel() {
        setContent(UiState(phase = UiPhase.Content, data = lockedData(), fetchedAt = NOW))
        rule.onNodeWithText("Digital Twin").assertIsDisplayed()
        rule.onNodeWithText("Locked").assertIsDisplayed()
        rule.onNodeWithText("Windows Closed").assertIsDisplayed()
        rule.onNodeWithText("Sparky").assertIsDisplayed()
    }

    @Test
    fun twinExposesFoldedTalkBackDescription() {
        setContent(UiState(phase = UiPhase.Content, data = lockedData(), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Locked", substring = true).assertIsDisplayed()
    }

    @Test
    fun headerExposesRefreshAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = lockedData(), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehicleData() {
        setContent(UiState(phase = UiPhase.Empty, data = DigitalTwinData.EMPTY, fetchedAt = NOW))
        rule.onNodeWithText("No vehicle data").assertIsDisplayed()
        rule.onNodeWithText("Locked").assertDoesNotExist()
    }

    @Test
    fun errorSurfaceKeepsTwinAndFiresRetry() {
        var refreshed = false
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = lockedData(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
            onRefresh = { refreshed = true },
        )
        rule.onNodeWithText("Locked").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedBadgesVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = lockedData(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        rule.onNodeWithText("Windows Closed").assertIsDisplayed()
        rule.onNodeWithText("Sparky").assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<DigitalTwinData>,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DigitalTwinWidgetContent(state = state, size = default, onRefresh = onRefresh)
            }
        }
    }

    private fun lockedData(): DigitalTwinData =
        DigitalTwinData(
            vehicle = TwinVehicle(id = 1, label = "Sparky", exteriorColor = "Deep Blue"),
            twin =
                VehicleTwinState.EMPTY.copy(
                    windowFD = WindowOpenState.Closed,
                    windowFP = WindowOpenState.Closed,
                    windowRD = WindowOpenState.Closed,
                    windowRP = WindowOpenState.Closed,
                    locked = true,
                ),
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
