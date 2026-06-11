package io.teslasync.android.dashboard.widgets.mediahistory

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
 * On-device Compose UI + accessibility verification of [MediaHistoryWidgetContent] across every state the
 * web component renders (loading skeleton, empty, hard error + retry, wide track feed, compact last track,
 * stale/offline cached). Asserts the rendered i18n strings and the TalkBack content descriptions are
 * present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render.
 */
class MediaHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun entry(
        title: String = "Bohemian Rhapsody",
        playbackStatus: String = "playing",
    ): MediaTrackEntry =
        MediaTrackEntry(
            id = 1,
            title = title,
            artist = "Queen",
            source = "spotify",
            playbackStatus = playbackStatus,
            timestamp = "2026-06-06T12:00:00Z",
        )

    private fun setContent(
        state: UiState<List<MediaTrackEntry>>,
        size: MediaHistorySize = MediaHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MediaHistoryWidgetContent(
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
        compose.onNodeWithText("No tracks played").assertIsDisplayed()
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
    fun wideContentShowsTitleAndTrackRow() {
        setContent(UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow))
        compose.onNodeWithText("Media History").assertIsDisplayed()
        // The track row exposes a single TalkBack phrase folding title/artist + source + relative time.
        compose.onNodeWithContentDescription("Bohemian Rhapsody", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactRowExposesTrackText() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow),
            size = MediaHistorySize(cols = 1, rows = 2),
        )
        // The compact row folds the track title + artist into one accessible phrase.
        compose.onNodeWithContentDescription("Bohemian Rhapsody", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(entry(title = "Stairway to Heaven", playbackStatus = "paused")),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Stairway to Heaven", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = listOf(entry()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
