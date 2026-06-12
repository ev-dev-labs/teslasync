package io.teslasync.android.featureviews.commandsearch

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of CommandSearch across every branch the prompt's state
 * matrix mandates (web/src/features/system/components/CommandSearch.tsx): the ready field with its ghost prompt
 * and accessible name, the empty-vs-typed controlled query, the loading skeleton, the hard-error retry
 * surface, and the offline (cached + chip) surface — plus the end-to-end controlled-typing round-trip on the
 * stateful surface and the stale auto-refresh. Every asserted string is resolved from the app's i18n resources
 * so the test follows the device locale rather than hard-coding English. The clock auto-advance is disabled so
 * the skeleton's infinite shimmer cannot stall `waitForIdle`; a fixed advance settles the first frame. Runs
 * under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure model.
 */
class CommandSearchUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun readyEmptyShowsGhostPromptAndAccessibleName() {
        setContent(UiState(UiPhase.Content, data = Unit), value = "")

        val hint = string(R.string.translation_commands_search_placeholder)
        // The field carries the prompt as its accessible name (the web renders no visible label)…
        compose.onNodeWithContentDescription(hint).assertIsDisplayed()
        // …and shows the same prompt as the ghost text while empty (never a blank box).
        compose.onNodeWithText(hint).assertIsDisplayed()
    }

    @Test
    fun readyActiveShowsTheTypedQuery() {
        setContent(UiState(UiPhase.Content, data = Unit), value = "charge")

        compose.onNodeWithText("charge").assertIsDisplayed()
    }

    @Test
    fun typingRaisesEveryKeystrokeToTheParent() {
        var captured = ""
        compose.mainClock.autoAdvance = false
        compose.setContent {
            var value by remember { mutableStateOf("") }
            captured = value
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    CommandSearch(value = value, onValueChange = { value = it }, logger = NoopLogger)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)

        compose.onNode(hasSetTextAction()).performTextInput("wake")
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.waitForIdle()

        compose.onNodeWithText("wake").assertIsDisplayed()
        assertTrue("expected the controlled value to round-trip, was \"$captured\"", captured == "wake")
    }

    @Test
    fun loadingShowsAccessibleSkeleton() {
        setContent(UiState(UiPhase.Loading), value = "")

        compose.onNodeWithContentDescription(string(R.string.translation_common_loading)).assertIsDisplayed()
    }

    @Test
    fun errorShowsFailureAndInvokesRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), value = "", onRetry = { retried = true })

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsCachedFieldWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = Unit,
                stale = true,
                fetchedAt = FETCHED_AT,
                errorKind = ErrorKind.Network,
            ),
            value = "charge",
        )

        compose.onNodeWithContentDescription(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText("charge").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = Unit, stale = true, fetchedAt = FETCHED_AT),
            value = "charge",
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        compose.onNodeWithText("charge").assertIsDisplayed()
        assertTrue(refreshed)
    }

    private fun setContent(
        state: UiState<Unit>,
        value: String,
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    CommandSearchContent(
                        value = value,
                        onValueChange = {},
                        state = state,
                        onRetry = onRetry,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        val WIDTH = 360.dp
        val HEIGHT = 200.dp
        const val SETTLE_MS = 1_500L
        const val FETCHED_AT = 1_700_000_000_000L
    }
}
