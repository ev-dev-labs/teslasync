package io.teslasync.android.featureviews.vindecoder

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [VinDecoderContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the populated tool
 * (title/description/Input + the decoded manufacturer/model/drive/year/plant/serial cards), the empty-seed
 * too-short hint, the live-typed transitions (full VIN decodes, short VIN reverts to the hint), and the
 * stale/offline cached views. Asserts the rendered i18n strings and the TalkBack content descriptions are
 * present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * decode logic, this covers render + a11y + interactivity. Mirrors the web spec
 * (web/src/features/admin/components/devtools/tools/VinDecoder.tsx).
 */
class VinDecoderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val sampleVin = "5YJ3E1EA1NF000001"

    private fun setContent(
        state: UiState<String>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VinDecoderContent(state = state, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("VIN Decoder").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentRendersTitleDescriptionAndDecodedFields() {
        setContent(UiState(UiPhase.Content, data = sampleVin))
        compose.onNodeWithText("VIN Decoder").assertIsDisplayed()
        compose.onNodeWithText("Decode a Tesla VIN into manufacturer, model, drive, year, and plant").assertIsDisplayed()
        compose.onNodeWithText("Manufacturer").assertIsDisplayed()
        compose.onNodeWithText("Tesla (USA)").assertIsDisplayed()
        compose.onNodeWithText("Model 3").assertIsDisplayed()
        compose.onNodeWithText("Fremont, CA").assertIsDisplayed()
    }

    @Test
    fun emptySeedShowsTooShortHint() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("at least 11 VIN", substring = true).assertIsDisplayed()
        compose.onAllNodesWithText("Tesla (USA)").assertCountEquals(0)
    }

    @Test
    fun typingShortVinReplacesDecodedFieldsWithHint() {
        setContent(UiState(UiPhase.Content, data = sampleVin))
        compose.onNodeWithText("Tesla (USA)").assertIsDisplayed()
        compose.onNode(hasSetTextAction()).performTextReplacement("5YJ")
        compose.onAllNodesWithText("Tesla (USA)").assertCountEquals(0)
        compose.onNodeWithText("at least 11 VIN", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleVin,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Tesla (USA)").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleVin,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Tesla (USA)").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
