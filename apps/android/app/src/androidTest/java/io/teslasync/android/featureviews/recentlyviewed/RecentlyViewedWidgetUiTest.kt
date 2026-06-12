package io.teslasync.android.featureviews.recentlyviewed

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [RecentlyViewedWidgetContent] across every
 * state the web component renders: the loading skeleton chrome, the friendly empty hint, and the
 * populated row list with its folded TalkBack content descriptions + navigation callback. Asserts the
 * rendered i18n strings and the per-row labels. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection logic, this covers the render + a11y.
 */
class RecentlyViewedWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        RecentlyViewedStrings(
            widgetTitle = "Recently Viewed",
            empty = "Pages you visit will appear here for quick access.",
            justNow = "Just now",
            shortMinute = "m",
            shortHour = "h",
            shortDay = "d",
        )

    private fun setContent(
        state: RecentlyViewedUiState,
        onOpenPath: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RecentlyViewedWidgetContent(
                        state = state,
                        strings = strings,
                        now = NOW,
                        onOpenPath = onOpenPath,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(RecentlyViewedUiState.Loading)
        compose.onNodeWithText("Recently Viewed").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun emptyShowsTitleAndFriendlyHint() {
        setContent(RecentlyViewedUiState.Empty)
        compose.onNodeWithText("Recently Viewed").assertIsDisplayed()
        compose.onNodeWithText("Pages you visit will appear here for quick access.").assertIsDisplayed()
    }

    @Test
    fun contentShowsRowsWithFoldedDescriptions() {
        setContent(RecentlyViewedUiState.Content(listOf(entry("/vehicles/3", "Model 3"))))
        compose.onNodeWithText("Recently Viewed").assertIsDisplayed()
        // The row folds title + relative age into one TalkBack phrase.
        compose.onNodeWithContentDescription("Model 3, Just now").assertIsDisplayed()
    }

    @Test
    fun rowInvokesNavigationWithItsPath() {
        var opened = ""
        setContent(
            state = RecentlyViewedUiState.Content(listOf(entry("/drives/42", "Evening drive"))),
            onOpenPath = { opened = it },
        )
        compose.onNodeWithContentDescription("Evening drive, Just now").performClick()
        assertEquals("/drives/42", opened)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun entry(
        path: String,
        title: String,
    ): RecentPageEntry = RecentPageEntry(path = path, title = title, kind = RecentPageKind.Vehicle, visitedAt = NOW)

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 480.dp
    }
}
