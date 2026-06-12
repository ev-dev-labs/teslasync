package io.teslasync.android.featureviews.fsmhealthpanel

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
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [FSMHealthPanelContent] across every surface the
 * web component implies (loading skeleton / hard error + retry / all-clear empty / alert tiles / offline
 * "last known"). Asserts the rendered strings, that the alert tiles expose a merged accessibility label, and
 * that the retry affordance exposes an accessible click action. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class FSMHealthPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val now: Long = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()

    private val strings =
        FSMHealthStrings(
            title = "FSM Health",
            allClear = "All FSMs healthy",
            flapTitle = "State Flapping",
            stuckTitle = "Stuck Sessions",
            recoveryTitle = "Pod Recoveries",
            flapMessage = "%1\$s flapping",
            stuckMessage = "%1\$s stuck",
            recoveryMessage = "%1\$s recovered",
        )
    private val formatCount: (Int) -> String = { it.toString() }

    private fun alertTransitions(): List<FSMTransition> {
        val flaps =
            (0 until 6).map { i ->
                FSMTransition(
                    id = i.toLong(),
                    vehicleId = 1,
                    ts = "2026-06-12T11:50:0${i}Z",
                    fsmName = "vehicle",
                    fromState = "online",
                    toState = "asleep",
                    trigger = "telemetry",
                )
            }
        val stuck =
            FSMTransition(
                id = 50,
                vehicleId = 7,
                ts = "2026-06-12T06:00:00Z",
                fsmName = "drive_session",
                fromState = "pending",
                toState = "active",
                trigger = "drive_start",
            )
        val recovered =
            FSMTransition(
                id = 60,
                vehicleId = 7,
                ts = "2026-06-12T09:00:00Z",
                fsmName = "charge_session",
                fromState = "active",
                toState = "recovered",
                trigger = "pod_restart",
            )
        return flaps + stuck + recovered
    }

    private fun setContent(
        state: UiState<List<FSMTransition>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FSMHealthPanelContent(
                        state = state,
                        onRetry = onRetry,
                        strings = strings,
                        formatCount = formatCount,
                        clockMillis = now,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsSkeletonChrome() {
        setContent(UiState.loading())
        val loadingLabel = context.getString(R.string.translation_common_loading)
        compose.onNodeWithContentDescription(loadingLabel).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetry() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(context.getString(R.string.translation_error_serverError_title)).assertIsDisplayed()
        val retryLabel = context.getString(R.string.translation_common_retry)
        compose.onNodeWithText(retryLabel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(retryLabel).performClick()
        assertTrue(retried)
    }

    @Test
    fun allClearShowsHealthyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(strings.allClear).assertIsDisplayed()
    }

    @Test
    fun alertsShowTitleCardsAndAccessibleLabels() {
        setContent(UiState(phase = UiPhase.Content, data = alertTransitions()))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Card titles (unmerged — each tile merges its descendants for TalkBack).
        compose.onNodeWithText(strings.flapTitle, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings.stuckTitle, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings.recoveryTitle, useUnmergedTree = true).assertIsDisplayed()
        // The flap tile's merged accessibility label (title + interpolated message).
        compose.onNodeWithContentDescription("${strings.flapTitle}. 6 flapping").assertIsDisplayed()
        // The grouped count badge for the flap tile.
        compose.onNodeWithText("6", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedAlertsAndFreshnessChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = alertTransitions(),
                stale = true,
                errorKind = ErrorKind.Network,
                fetchedAt = now,
            ),
        )
        // Cached content stays visible (never blanked) …
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // … alongside the offline freshness chip.
        compose.onNodeWithText(context.getString(R.string.translation_common_offline), substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
    }
}
