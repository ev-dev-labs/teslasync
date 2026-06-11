package io.teslasync.android.featureviews.colorconverter

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
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
 * On-device Compose UI + accessibility verification of [ColorConverterContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the populated tool (title/description/Input +
 * the RGB/HSL/HEX conversion cards + copy affordances), the empty-seed default, the invalid-hex friendly
 * empty surface (seeded and via live typing), and the stale/offline cached views. Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the pure conversion logic, this covers render + a11y + interactivity.
 * Mirrors the web spec (web/src/features/admin/components/devtools/tools/ColorConverter.tsx).
 */
class ColorConverterUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<String>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ColorConverterContent(state = state, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Color Converter").assertIsDisplayed()
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
    fun contentRendersTitleDescriptionAndConversions() {
        setContent(UiState(UiPhase.Content, data = "#10b981"))
        compose.onNodeWithText("Color Converter").assertIsDisplayed()
        compose.onNodeWithText("Convert HEX colors to RGB and HSL").assertIsDisplayed()
        compose.onNodeWithText("Hex Color").assertIsDisplayed()
        compose.onNodeWithText("rgb(16, 185, 129)").assertIsDisplayed()
        compose.onNodeWithText("hsl(160, 84%, 39%)").assertIsDisplayed()
    }

    @Test
    fun contentRendersThreeCopyAffordances() {
        setContent(UiState(UiPhase.Content, data = "#3b82f6"))
        compose.onAllNodesWithContentDescription("Copy").assertCountEquals(3)
    }

    @Test
    fun emptySeedRendersDefaultColorTool() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("rgb(59, 130, 246)").assertIsDisplayed()
    }

    @Test
    fun invalidSeedShowsFriendlyEmptyHint() {
        setContent(UiState(UiPhase.Content, data = "not-a-color"))
        compose.onNodeWithText("valid 6-digit hex", substring = true).assertIsDisplayed()
        compose.onNodeWithText("rgb(", substring = true).assertDoesNotExist()
    }

    @Test
    fun typingInvalidHexReplacesConversionsWithHint() {
        setContent(UiState(UiPhase.Content, data = "#3b82f6"))
        compose.onNodeWithText("rgb(59, 130, 246)").assertIsDisplayed()
        compose.onNode(hasSetTextAction()).performTextReplacement("zzzz")
        compose.onNodeWithText("rgb(59, 130, 246)").assertDoesNotExist()
        compose.onNodeWithText("valid 6-digit hex", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = "#10b981",
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("rgb(16, 185, 129)").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = "#3b82f6",
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("rgb(59, 130, 246)").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
