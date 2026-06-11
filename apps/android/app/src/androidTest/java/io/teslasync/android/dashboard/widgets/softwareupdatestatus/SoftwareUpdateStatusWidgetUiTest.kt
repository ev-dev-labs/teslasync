package io.teslasync.android.dashboard.widgets.softwareupdatestatus

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
 * On-device Compose UI + accessibility verification of [SoftwareUpdateStatusWidgetContent] across every
 * state the web component renders (loading skeleton, up-to-date content, downloading progress, compact
 * tile, empty, hard error with retry, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present, and that the refresh control fires. Runs under
 * `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the
 * projection/merge logic; this covers the render.
 */
class SoftwareUpdateStatusWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setWidget(
        state: UiState<SoftwareUpdateSnapshot>,
        size: SoftwareUpdateStatusSize = SoftwareUpdateStatusRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SoftwareUpdateStatusWidgetContent(state = state, size = size, onRefresh = onRefresh)
            }
        }
    }

    private fun snapshot(
        updateVersion: String? = null,
        downloadPct: Double? = null,
        installPct: Double? = null,
    ): SoftwareUpdateSnapshot =
        SoftwareUpdateSnapshot(
            hasState = true,
            currentVersion = "2024.8.9",
            updateVersion = updateVersion,
            downloadPct = downloadPct,
            installPct = installPct,
            expectedDuration = null,
            scheduledStart = null,
        )

    private fun content(snapshot: SoftwareUpdateSnapshot): UiState<SoftwareUpdateSnapshot> =
        UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotContent() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Current Version").assertDoesNotExist()
        compose.onNodeWithText("No software data").assertDoesNotExist()
    }

    @Test
    fun upToDateShowsCurrentVersion() {
        setWidget(content(snapshot()))
        compose.onNodeWithText("Software Update").assertIsDisplayed()
        compose.onNodeWithText("Current Version").assertIsDisplayed()
        compose.onNodeWithText("2024.8.9").assertIsDisplayed()
    }

    @Test
    fun downloadingShowsUpdateVersionAndProgress() {
        setWidget(content(snapshot(updateVersion = "2024.12.1", downloadPct = 47.0)))
        compose.onNodeWithText("Update").assertIsDisplayed()
        compose.onNodeWithText("2024.12.1").assertIsDisplayed()
        compose.onNodeWithText("47%").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(content(snapshot()))
        compose.onNodeWithText("Software Update").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactShowsVersion() {
        setWidget(
            content(snapshot(updateVersion = "2024.12.1", downloadPct = 100.0)),
            size = SoftwareUpdateStatusSize(cols = 1, rows = 1),
        )
        compose.onNodeWithText("2024.8.9").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSoftwareData() {
        setWidget(UiState(phase = UiPhase.Empty, data = SoftwareUpdateSnapshot.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("No software data").assertIsDisplayed()
        compose.onNodeWithText("Current Version").assertDoesNotExist()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setWidget(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("No software data").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedVersionVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Current Version").assertIsDisplayed()
        compose.onNodeWithText("2024.8.9").assertIsDisplayed()
    }
}
