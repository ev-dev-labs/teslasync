package io.teslasync.android.feature.views.hashcalculator

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [HashCalculatorContent] across every state the web
 * tool renders (the always-present tool card + labeled input + compute button, the data-empty hint, the
 * computing skeleton, the computed hash + copy, the error + retry, and the stale/offline cached path) plus
 * the end-to-end type → compute → digest flow. Asserts the rendered i18n strings and the TalkBack labels
 * (the compute button is named and clickable; copy/refresh controls are named; the skeleton is announced).
 * Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the projection + adapter.
 */
class HashCalculatorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<HashDigest>,
        onRetry: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { HashCalculatorContent(state = state, onRetry = onRetry) }
            }
        }
    }

    @Test
    fun toolCardHeaderAndInputAlwaysRender() {
        setContent(UiState(UiPhase.Empty, data = HashDigest.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("Hash Calculator").assertIsDisplayed()
        compose.onNodeWithText("Hash Calculator Desc").assertIsDisplayed()
        compose.onNodeWithText("Hash Input").assertIsDisplayed()
        compose.onNodeWithText("Compute Sha256").assertIsDisplayed()
    }

    @Test
    fun emptyShowsAFriendlyHintNeverABlankBox() {
        setContent(UiState(UiPhase.Empty, data = HashDigest.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAnAccessibleSkeleton() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun contentShowsTheDigestAndACopyControl() {
        setContent(UiState(UiPhase.Content, data = digestOf("abc"), fetchedAt = NOW))
        compose.onNodeWithText(ABC_HEX).assertIsDisplayed()
        compose.onNodeWithContentDescription("Copy").assertIsDisplayed()
    }

    @Test
    fun computeButtonIsAnAccessibleClickableControl() {
        setContent(UiState(UiPhase.Empty, data = HashDigest.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("Compute Sha256").assertHasClickAction()
    }

    @Test
    fun errorShowsHashErrorAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown), onRetry = { retried = true })
        compose.onNodeWithText("Hash Error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedDigestVisibleWithRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = digestOf("abc"),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithText(ABC_HEX).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun typingAndComputingShowsTheDigest() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    var ui by remember { mutableStateOf(UiState(UiPhase.Empty, data = HashDigest.EMPTY)) }
                    HashCalculatorContent(
                        state = ui,
                        onCompute = { text -> ui = UiState(UiPhase.Content, data = digestOf(text), fetchedAt = NOW) },
                    )
                }
            }
        }
        compose.onNode(hasSetTextAction()).performTextInput("abc")
        compose.onNodeWithText("Compute Sha256").performClick()
        compose.onNodeWithText(ABC_HEX).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun digestOf(input: String): HashDigest = HashCalculatorProjection.digest(input)

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val ABC_HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
