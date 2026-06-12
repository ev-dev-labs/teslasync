package io.teslasync.android.featureviews.slotrackingcard

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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [SLOTrackingCardContent] across every branch the
 * web component renders (loading / content / value-less empty / error+retry / historical caveat) plus the
 * lifecycle states the holder adds (offline "last known" + chip). Asserts the rendered strings, that the
 * window tabs + the target Edit/Save expose accessible click actions and invoke their callbacks, that the
 * window selector carries its accessible group label, and that the offline chip is announced. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + holder.
 */
class SLOTrackingCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SloStrings(
            title = "Uptime & SLO",
            targetSetPattern = "Target %1\$s%%",
            targetInputLabel = "Target uptime percentage",
            windowSelectorLabel = "Uptime window selector",
            componentsHealthyPattern = "%1\$s / %2\$s components healthy",
            caveat = "Per-window historical uptime requires the heartbeat history backend (planned).",
            loading = "Loading uptime\u2026",
            error = "Failed to load uptime data.",
            empty = "No uptime data for this window yet.",
            save = "Save",
            cancel = "Cancel",
            edit = "Edit",
            retry = "Retry",
            offline = "Offline",
            windowLabels =
                mapOf(
                    StatusWindow.H24 to "Last 24 hours",
                    StatusWindow.D7 to "Last 7 days",
                    StatusWindow.D30 to "Last 30 days",
                    StatusWindow.D90 to "Last 90 days",
                    StatusWindow.Y1 to "Last year",
                ),
        )

    private val now = 1_749_643_200_000L

    private val data =
        UptimeWindow(
            window = "30d",
            uptimePercent = 99.95,
            healthyCount = 8,
            totalCount = 8,
            generatedAt = "2026-06-11T12:00:00Z",
            historicalSource = "series",
        )

    private fun setContent(
        state: UiState<UptimeWindow>,
        window: StatusWindow = StatusWindow.D30,
        target: Double = DEFAULT_SLO_TARGET,
        onWindowChange: (StatusWindow) -> Unit = {},
        onSaveTarget: (Double) -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SLOTrackingCardContent(
                        state = state,
                        window = window,
                        target = target,
                        onWindowChange = onWindowChange,
                        onSaveTarget = onSaveTarget,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsHeadlineSubtitleWindowsAndTarget() {
        setContent(UiState(phase = UiPhase.Content, data = data, fetchedAt = now))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("99.95%").assertIsDisplayed()
        compose.onNodeWithText("Last 30 days \u00b7 8 / 8 components healthy").assertIsDisplayed()
        compose.onNodeWithText("Target 99%").assertIsDisplayed()
        // Every window tab renders its short code.
        listOf("24h", "7d", "30d", "90d", "1y").forEach { compose.onNodeWithText(it).assertIsDisplayed() }
    }

    @Test
    fun loadingShowsMessage() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.loading).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessageAndDash() {
        setContent(
            UiState(phase = UiPhase.Empty, data = UptimeWindow(window = "30d", uptimePercent = null), fetchedAt = now),
        )
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
        compose.onNodeWithText("\u2014").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryWithAccessibleClickAction() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText(strings.error).assertIsDisplayed()
        compose.onNodeWithText(strings.retry).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.retry).performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsCachedValueAndOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data,
                fetchedAt = now,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("99.95%").assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.offline).assertIsDisplayed()
    }

    @Test
    fun caveatShownForNonSeriesSource() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data.copy(historicalSource = "snapshot"),
                fetchedAt = now,
            ),
        )
        compose.onNodeWithText(strings.caveat).assertIsDisplayed()
    }

    @Test
    fun windowSelectorHasGroupLabelAndTabInvokesCallback() {
        var picked: StatusWindow? = null
        setContent(UiState(phase = UiPhase.Content, data = data, fetchedAt = now), onWindowChange = { picked = it })
        compose.onNodeWithContentDescription(strings.windowSelectorLabel).assertIsDisplayed()
        compose.onNodeWithText("7d").assertHasClickAction().performClick()
        assertEquals(StatusWindow.D7, picked)
    }

    @Test
    fun editTargetRevealsFieldAndSaveInvokesCallback() {
        var saved: Double? = null
        setContent(UiState(phase = UiPhase.Content, data = data, fetchedAt = now), onSaveTarget = { saved = it })
        compose.onNodeWithText(strings.edit).assertHasClickAction().performClick()
        compose.onNodeWithText(strings.targetInputLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed()
        compose.onNodeWithText(strings.save).assertHasClickAction().performClick()
        assertEquals(DEFAULT_SLO_TARGET, saved)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
