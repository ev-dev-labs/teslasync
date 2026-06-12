package io.teslasync.android.featureviews.signalsparklinepreview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.signals.SignalKind
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [SignalSparklinePreviewContent] across every branch
 * the web component renders (loading / non-numeric / content / empty), plus the P3-mandated error / stale /
 * offline / disabled branches: each affordance carries a TalkBack label, the error retry is a clickable node,
 * and a stale series auto-refreshes. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection + the view-model state matrix.
 */
class SignalSparklinePreviewUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SignalSparklineStrings(
            loading = "Loading\u2026",
            retry = "Retry",
            stale = "Stale",
            offline = "Offline",
            noData = "No signal data available",
        )

    @Test
    fun loadingShowsAccessibleSkeleton() {
        setContent(state(SignalSparklineMode.Loading))
        compose.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun nonNumericShowsKindChip() {
        setContent(state(SignalSparklineMode.NonNumeric, valueKind = SignalKind.String))
        compose.onNodeWithText("string").assertIsDisplayed()
    }

    @Test
    fun contentShowsSparklineLabelledBySignal() {
        setContent(state(SignalSparklineMode.Content, series = SERIES))
        compose.onNodeWithContentDescription(SIGNAL).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataLabel() {
        setContent(state(SignalSparklineMode.Empty))
        compose.onNodeWithContentDescription(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsClickableRetryAffordance() {
        var retried = false
        setContent(state(SignalSparklineMode.Error), onRetry = { retried = true })
        compose.onNodeWithContentDescription(strings.retry).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(strings.retry).performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsOfflineAffordanceOverLine() {
        setContent(state(SignalSparklineMode.Content, series = SERIES, freshness = SparklineFreshness.Offline))
        compose.onNodeWithContentDescription(strings.offline).assertIsDisplayed()
        compose.onNodeWithContentDescription(SIGNAL).assertIsDisplayed()
    }

    @Test
    fun staleShowsAffordanceAndAutoRefreshes() {
        var refreshed = false
        setContent(
            state(SignalSparklineMode.Content, series = SERIES, freshness = SparklineFreshness.Stale),
            onRetry = { refreshed = true },
        )
        compose.onNodeWithContentDescription(strings.stale).assertIsDisplayed()
        compose.waitForIdle()
        assertTrue(refreshed)
    }

    @Test
    fun disabledRendersNothing() {
        setContent(state(SignalSparklineMode.Disabled))
        compose.onNodeWithContentDescription(strings.noData).assertDoesNotExist()
        compose.onNodeWithContentDescription(strings.retry).assertDoesNotExist()
        compose.onNodeWithContentDescription(strings.loading).assertDoesNotExist()
    }

    private fun state(
        mode: SignalSparklineMode,
        valueKind: SignalKind = SignalKind.Float,
        series: List<Double> = emptyList(),
        freshness: SparklineFreshness = SparklineFreshness.Fresh,
    ): SignalSparklinePreviewState =
        SignalSparklinePreviewState(
            mode = mode,
            valueKind = valueKind,
            signal = SIGNAL,
            series = series,
            freshness = freshness,
            isFetching = false,
            updatedAtMillis = if (mode == SignalSparklineMode.Content) 1L else null,
            errorKind = null,
        )

    private fun setContent(
        state: SignalSparklinePreviewState,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalSparklinePreviewContent(state = state, strings = strings, onRetry = onRetry)
                }
            }
        }
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val SIGNAL = "VehicleSpeed"
        val SERIES = listOf(12.0, 18.0, 16.0, 22.0, 19.0)
        val HOST_WIDTH = 240.dp
        val HOST_HEIGHT = 96.dp
    }
}
