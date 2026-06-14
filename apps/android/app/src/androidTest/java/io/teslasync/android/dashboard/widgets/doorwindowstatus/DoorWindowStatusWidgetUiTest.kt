package io.teslasync.android.dashboard.widgets.doorwindowstatus

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

/**
 * On-device Compose UI + accessibility verification of [DoorWindowStatusWidgetContent] across every state
 * the web component renders (loading skeleton, the two status grids, the compact summary badges, empty, hard
 * error with retry, stale/offline cached). Asserts the rendered i18n strings and the per-cell TalkBack
 * content descriptions are present, and that the refresh control fires. Runs under `connectedAndroidTest`
 * (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this
 * covers the render.
 */
class DoorWindowStatusWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    // door FL open (driver_front_open), window FR partial (vent), everything else closed.
    private fun security(): JsonElement =
        buildJsonObject {
            put("door_state", "driver_front_open")
            put("fd_window", "closed")
            put("fp_window", "vent")
            put("rd_window", "closed")
            put("rp_window", "closed")
        }

    @Composable
    private fun doorWindowStrings(): DoorWindowStatusStrings =
        DoorWindowStatusStrings(
            title = stringResource(R.string.translation_widget_doorWindow_title),
            doors = stringResource(R.string.translation_widget_doorWindow_doors),
            windows = stringResource(R.string.translation_widget_doorWindow_windows),
            closed = stringResource(R.string.translation_widget_doorWindow_closed),
            open = stringResource(R.string.translation_widget_doorWindow_open),
            partial = stringResource(R.string.translation_widget_doorWindow_partial),
            frontLeft = stringResource(R.string.translation_widget_doorWindow_fl),
            frontRight = stringResource(R.string.translation_widget_doorWindow_fr),
            rearLeft = stringResource(R.string.translation_widget_doorWindow_rl),
            rearRight = stringResource(R.string.translation_widget_doorWindow_rr),
            doorsAllClosed = stringResource(R.string.translation_widget_doorWindow_doorsAllClosed),
            doorsOpen = stringResource(R.string.translation_widget_doorWindow_doorsOpen),
            windowsAllClosed = stringResource(R.string.translation_widget_doorWindow_windowsAllClosed),
            windowsOpen = stringResource(R.string.translation_widget_doorWindow_windowsOpen),
            noData = stringResource(R.string.translation_widget_doorWindow_noData),
        )

    private fun setWidget(
        state: UiState<JsonElement>,
        size: DoorWindowStatusSize = DoorWindowStatusRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DoorWindowStatusWidgetContent(
                    state = state,
                    strings = doorWindowStrings(),
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = security(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCells() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Doors").assertDoesNotExist()
        compose.onNodeWithText("No door/window data").assertDoesNotExist()
    }

    @Test
    fun contentShowsBothSectionsWithValues() {
        setWidget(contentState())
        compose.onNodeWithText("Doors").assertIsDisplayed()
        compose.onNodeWithText("Windows").assertIsDisplayed()
        // Door FL "Open" and Window FR "Partial" are the only cells with those values.
        compose.onNodeWithText("Open").assertIsDisplayed()
        compose.onNodeWithText("Partial").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(contentState())
        compose.onNodeWithText("Door & Window Status").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun cellsExposeMergedTalkBackLabels() {
        setWidget(contentState())
        compose.onNodeWithContentDescription("Front Left, Open").assertIsDisplayed()
        compose.onNodeWithContentDescription("Front Right, Partial").assertIsDisplayed()
    }

    @Test
    fun compactShowsSummaryBadgesNotSections() {
        setWidget(contentState(), size = DoorWindowStatusSize(cols = 1, rows = 1))
        compose.onNodeWithText("1 door(s) open").assertIsDisplayed()
        compose.onNodeWithText("1 window(s) open").assertIsDisplayed()
        compose.onNodeWithText("Door & Window Status").assertDoesNotExist()
        compose.onNodeWithText("Doors").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDoorWindowData() {
        setWidget(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("No door/window data").assertIsDisplayed()
        compose.onNodeWithText("Doors").assertDoesNotExist()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setWidget(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("No door/window data").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCellsVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = security(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Open").assertIsDisplayed()
        compose.onNodeWithText("Partial").assertIsDisplayed()
    }
}
