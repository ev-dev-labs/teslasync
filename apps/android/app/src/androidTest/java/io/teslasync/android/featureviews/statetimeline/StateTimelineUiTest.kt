package io.teslasync.android.featureviews.statetimeline

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [StateTimelineContent] across every state the surface
 * renders: the populated track (the axis "Window: N min" caption + an accent-tinted tick exposing its
 * "{from} to {to}" label), the empty window with its relative hint + Widen/Jump actions, the first-load
 * skeleton, the hard-error retry surface, and the stale/offline (cached "last known") freshness branches. The
 * tick exposes its localized label and the Button role to accessibility services, so the assertions double as
 * the per-state snapshot and the a11y-label coverage. Reduced motion is forced so the [FadeIn] entrance
 * collapses to its final state and every node is present immediately; the clock is pinned to a fixed UTC zone
 * + US locale + a fixed "now" so the assertions are deterministic. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure projection logic, this covers render + a11y. Mirrors
 * the web spec (web/src/features/system/components/state-machine/StateTimeline.tsx).
 */
class StateTimelineUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val transitions = listOf(transitionAt(offsetMs = -5 * 60_000L, fromState = "driving", toState = "charging"))

    private fun setContent(
        state: UiState<List<FsmTransition>>,
        lastTransition: FsmTransition? = null,
        widerPreset: Int? = null,
        onWidenWindow: (() -> Unit)? = null,
        onJumpToLast: (() -> Unit)? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StateTimelineContent(
                        state = state,
                        fsmType = "vehicle",
                        onRetry = onRetry,
                        selectedId = null,
                        windowMinutes = WINDOW_MINUTES,
                        anchorMillis = FIXED_NOW,
                        lastTransition = lastTransition,
                        widerPreset = widerPreset,
                        onWidenWindow = onWidenWindow,
                        onJumpToLast = onJumpToLast,
                        locale = Locale.US,
                        zoneId = ZoneId.of("UTC"),
                        nowMillis = FIXED_NOW,
                    )
                }
            }
        }
    }

    @Test
    fun populatedWindowRendersAxisAndTickWithAccessibilityLabel() {
        setContent(state = UiState(phase = UiPhase.Content, data = transitions))

        // Web axis center caption `t('debugger.timeline.windowLabel', { minutes })`.
        compose.onNodeWithText("Window: 10 min").assertIsDisplayed()
        // Web tick `aria-label` `t('debugger.timeline.tickAria', { from, to })` + the Button role.
        compose.onNodeWithContentDescription("driving to charging").assertIsDisplayed()
    }

    @Test
    fun emptyWindowRendersHintAndActionsAndInvokesCallbacks() {
        var widened = false
        var jumped = false
        setContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            lastTransition = transitionAt(offsetMs = -5 * 60_000L, fromState = "driving", toState = "charging"),
            widerPreset = 60,
            onWidenWindow = { widened = true },
            onJumpToLast = { jumped = true },
        )

        // Web `t('debugger.timeline.empty')` + `· t('debugger.timeline.lastSeen', { rel: '5m ago' })`.
        compose.onNodeWithText("No transitions in window", substring = true).assertIsDisplayed()
        compose.onNodeWithText("5m ago", substring = true).assertIsDisplayed()

        // Web `t('debugger.timeline.widenTo', { label: presetLabel(60) })` = "Widen window to 1 h".
        compose.onNodeWithText("Widen window to 1 h").assertIsDisplayed().performClick()
        assertTrue(widened)

        compose.onNodeWithText("Jump to last transition").assertIsDisplayed().performClick()
        assertTrue(jumped)
    }

    @Test
    fun loadingRendersTheSkeletonChrome() {
        setContent(state = UiState.loading())

        // The skeleton column carries the localized loading label for accessibility services.
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    @Test
    fun errorRendersRetryAndInvokesTheCallback() {
        var retried = false
        setContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
            onRetry = { retried = true },
        )

        compose.onNodeWithText("Retry").assertIsDisplayed().performClick()
        assertTrue(retried)
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsTheTrackVisible() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = transitions,
                    stale = true,
                    fetchedAt = FIXED_NOW - 5 * 60_000L,
                ),
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        // Web freshness contract: stale, non-error data auto-refreshes while still showing the cached track.
        assertTrue(refreshed)
        compose.onNodeWithContentDescription("driving to charging").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentWithoutAutoRefreshing() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = transitions,
                    stale = true,
                    errorKind = ErrorKind.Network,
                    fetchedAt = FIXED_NOW - 5 * 60_000L,
                ),
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        // A failed refresh keeps the cached "last known" track visible and does NOT auto-retry (hasError).
        assertFalse(refreshed)
        compose.onNodeWithContentDescription("driving to charging").assertIsDisplayed()
    }

    @Test
    fun contentRendersImmediatelyUnderReducedMotion() {
        setContent(state = UiState(phase = UiPhase.Content, data = transitions))

        // With reduced motion the FadeIn collapses to its final state, so the tick is present immediately.
        compose.onNodeWithContentDescription("driving to charging").assertIsDisplayed()
    }

    private companion object {
        const val FIXED_NOW = 1_700_000_000_000L
        const val WINDOW_MINUTES = 10
        const val HTTP_SERVER_ERROR = 500

        fun transitionAt(
            offsetMs: Long,
            fromState: String,
            toState: String,
        ): FsmTransition =
            FsmTransition(
                id = 1,
                vehicleId = 1,
                ts = Instant.ofEpochMilli(FIXED_NOW + offsetMs).toString(),
                fsmName = "vehicle",
                fromState = fromState,
                toState = toState,
                trigger = "shift",
            )
    }
}
