package io.teslasync.android.dashboard.widgets.softwareupdatehistory

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
 * On-device Compose UI + accessibility verification of [SoftwareUpdateHistoryWidgetContent] across every
 * state the web component renders (loading skeleton, empty, hard error + retry, wide update feed, compact
 * latest version, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render.
 */
class SoftwareUpdateHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun entry(
        id: Long = 1,
        version: String = "2026.20.5",
        status: String = "installed",
    ): SoftwareUpdateEntry =
        SoftwareUpdateEntry(
            id = id,
            version = version,
            status = status,
            installedAt = "2026-05-20T12:00:00Z",
            scheduledAt = null,
            createdAt = "2026-05-01T00:00:00Z",
        )

    private fun setContent(
        state: UiState<List<SoftwareUpdateEntry>>,
        size: SoftwareUpdateHistorySize = SoftwareUpdateHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SoftwareUpdateHistoryWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = fixedNow,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = fixedNow))
        compose.onNodeWithText("No update history").assertIsDisplayed()
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
    fun wideContentShowsTitleAndCurrentUpdateRow() {
        setContent(UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow))
        compose.onNodeWithText("Update History").assertIsDisplayed()
        // The current row folds version + "Current" + relative time into one TalkBack phrase.
        compose.onNodeWithContentDescription("2026.20.5", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Current", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactRowExposesVersionAndBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow),
            size = SoftwareUpdateHistorySize(cols = 1, rows = 4),
        )
        // The compact row folds the latest version + status badge into one accessible phrase.
        compose.onNodeWithContentDescription("2026.20.5", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(entry(version = "2026.18.0", status = "available")),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("2026.18.0", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
