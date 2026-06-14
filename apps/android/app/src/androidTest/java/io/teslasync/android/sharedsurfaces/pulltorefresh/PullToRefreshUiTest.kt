package io.teslasync.android.sharedsurfaces.pulltorefresh

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the PullToRefresh surface across its real states: the
 * idle rest (no indicator, content still shown — never a blank box), the active pull ("Pull to refresh"), the
 * armed release point ("Release to refresh"), the running refresh ("Refreshing…" announced as a live region),
 * and the inactive passthrough (a fine pointer renders the children straight through with no indicator). Asserts
 * the indicator chip's localized accessible label in each state and that the wrapped content always renders. The
 * offline gate's `testReleaseUnitTest` covers the pure gesture logic; this covers render + a11y. Mirrors the web
 * spec (web/src/components/mobile/PullToRefresh.tsx).
 */
class PullToRefreshUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val pullLabel = "Pull to refresh"
    private val releaseLabel = "Release to refresh"
    private val refreshingLabel = "Refreshing\u2026"
    private val contentText = "Refreshable content"
    private val thresholdPx = 80f

    /** A no-op logger so the stateful passthrough test needs no LocalDataContainer provider. */
    private val silentLogger =
        object : Logger {
            override fun log(
                level: LogLevel,
                event: String,
                fields: Map<String, String>,
            ) = Unit
        }

    private fun setScaffold(
        pullPx: Float,
        refreshing: Boolean,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PullToRefreshScaffold(
                    pullPx = pullPx,
                    refreshing = refreshing,
                    thresholdPx = thresholdPx,
                    reduceMotion = false,
                    pullLabel = pullLabel,
                    releaseLabel = releaseLabel,
                    refreshingLabel = refreshingLabel,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) {
                    BodyText(contentText)
                }
            }
        }
    }

    @Test
    fun idleShowsContentWithoutAnIndicator() {
        setScaffold(pullPx = 0f, refreshing = false)
        compose.onNodeWithText(contentText).assertIsDisplayed()
        compose.onNodeWithContentDescription(pullLabel).assertDoesNotExist()
        compose.onNodeWithContentDescription(releaseLabel).assertDoesNotExist()
    }

    @Test
    fun pullingBelowThresholdShowsThePullLabel() {
        setScaffold(pullPx = 44f, refreshing = false)
        compose.onNodeWithContentDescription(pullLabel).assertIsDisplayed()
        compose.onNodeWithText(contentText).assertIsDisplayed()
    }

    @Test
    fun pulledToThresholdShowsTheReleaseLabel() {
        setScaffold(pullPx = 88f, refreshing = false)
        compose.onNodeWithContentDescription(releaseLabel).assertIsDisplayed()
    }

    @Test
    fun refreshingShowsTheRefreshingLabelAndKeepsContent() {
        setScaffold(pullPx = 0f, refreshing = true)
        // The chip exposes the localized state as its accessible label (web role="status" / aria-live).
        compose.onNodeWithContentDescription(refreshingLabel).assertIsDisplayed()
        compose.onNodeWithText(contentText).assertIsDisplayed()
    }

    @Test
    fun inactivePointerRendersChildrenStraightThrough() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PullToRefresh(
                    onRefresh = {},
                    enabled = false,
                    logger = silentLogger,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) {
                    BodyText(contentText)
                }
            }
        }
        compose.onNodeWithText(contentText).assertIsDisplayed()
        compose.onNodeWithContentDescription(pullLabel).assertDoesNotExist()
        compose.onNodeWithContentDescription(refreshingLabel).assertDoesNotExist()
    }
}
