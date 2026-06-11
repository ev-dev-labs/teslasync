package io.teslasync.android.dashboard.widgets.medianowplaying

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
 * On-device Compose UI + accessibility verification of [MediaNowPlayingWidgetContent] across every state
 * the web component renders (loading skeleton, the standard/tall now-playing body, empty, hard error with
 * retry, stale/offline cached, and the compact hero). Asserts the rendered i18n strings + derived clock /
 * volume readouts, the TalkBack content descriptions (loading, refresh, the merged compact track label),
 * and that the refresh control fires. Runs under `connectedAndroidTest` (a device/emulator) — the offline
 * gate's `testReleaseUnitTest` covers the projection/state logic; this covers the render.
 */
class MediaNowPlayingWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val tall = MediaNowPlayingRegistration.DEFAULT_SIZE

    private fun media(): JsonElement =
        buildJsonObject {
            put("now_playing_title", "Starlight")
            put("now_playing_artist", "Muse")
            put("now_playing_album", "Black Holes and Revelations")
            put("playback_source", "Spotify")
            put("playback_status", "Playing")
            put("now_playing_duration", 240_000.0)
            put("now_playing_elapsed", 72_000.0)
            put("audio_volume", 7.0)
            put("audio_volume_max", 11.0)
        }

    private fun setWidget(
        state: UiState<JsonElement>,
        size: MediaNowPlayingSize = tall,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MediaNowPlayingWidgetContent(state = state, size = size, onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = media(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotBody() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Starlight").assertDoesNotExist()
        compose.onNodeWithText("Nothing playing").assertDoesNotExist()
    }

    @Test
    fun contentShowsTrackArtistSourceProgressAndPlaying() {
        setWidget(contentState())
        compose.onNodeWithText("Starlight").assertIsDisplayed()
        compose.onNodeWithText("Muse").assertIsDisplayed()
        compose.onNodeWithText("Black Holes and Revelations").assertIsDisplayed()
        compose.onNodeWithText("Spotify").assertIsDisplayed()
        compose.onNodeWithText("Playing").assertIsDisplayed()
        compose.onNodeWithText("1:12").assertIsDisplayed()
        compose.onNodeWithText("4:00").assertIsDisplayed()
        compose.onNodeWithText("7").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(contentState())
        compose.onNodeWithText("Now Playing").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNothingPlaying() {
        setWidget(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("Nothing playing").assertIsDisplayed()
        compose.onNodeWithText("Starlight").assertDoesNotExist()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setWidget(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Nothing playing").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedBodyVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = media(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Starlight").assertIsDisplayed()
        compose.onNodeWithText("4:00").assertIsDisplayed()
    }

    @Test
    fun compactExposesMergedTrackDescription() {
        setWidget(contentState(), size = MediaNowPlayingSize(cols = 1, rows = 1))
        compose.onNodeWithContentDescription("Starlight, Muse").assertIsDisplayed()
    }
}
