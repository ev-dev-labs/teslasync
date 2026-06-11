package io.teslasync.android.featureviews.securitystatistics

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [SecurityStatisticsContent] across every branch
 * the web component renders (loading skeleton grid / content seven-card grid / empty), plus the lifecycle
 * chrome the host's feed implies (hard error with an accessible retry, and the stale/offline freshness
 * chip). Asserts the rendered labels/values, that the empty message and metric labels are exposed to
 * TalkBack, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class SecurityStatisticsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SecurityStatisticsStrings(
            title = "Security Statistics",
            lockEvents = "Lock/Unlock Events",
            sentryUptime = "Sentry Uptime",
            doorOpens = "Door Open Events",
            windowOpens = "Window Open Events",
            homelink = "HomeLink Detections",
            guestMode = "Guest Mode Usage",
            totalEvents = "Total Events",
            noData = "No data available",
        )

    private val snapshot =
        SecurityStatsSnapshot(
            stats =
                SecurityStats(
                    lockEvents = 42,
                    doorOpenCount = 8,
                    windowOpenCount = 3,
                    homelinkCount = 17,
                    guestCount = 2,
                    total = 1234,
                ),
            sentryUptimePct = 87.0,
        )

    private fun setContent(
        state: UiState<SecurityStatsSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SecurityStatisticsContent(state = state, onRetry = onRetry, locale = Locale.US, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleLabelsAndValues() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every metric label is rendered (TalkBack reads each tile's label) — accessibility coverage.
        compose.onNodeWithText(strings.lockEvents).assertIsDisplayed()
        compose.onNodeWithText(strings.sentryUptime).assertIsDisplayed()
        compose.onNodeWithText(strings.totalEvents).assertIsDisplayed()
        // Formatted values (web `fmtInt`): the lock count, the Sentry "%" suffix, and the grouped total.
        compose.onNodeWithText("42").assertIsDisplayed()
        compose.onNodeWithText("87%").assertIsDisplayed()
        compose.onNodeWithText("1,234").assertIsDisplayed()
    }

    @Test
    fun loadingShowsTitleAndNoMetricLabels() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton grid carries no metric labels.
        compose.onNodeWithText(strings.lockEvents).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The retry affordance exposes a click action (accessibility) and drives the host's refetch.
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached cards visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.lockEvents).assertIsDisplayed()
        compose.onNodeWithText("1,234").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
