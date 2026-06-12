// Instrumented Compose UI + accessibility verification of [ScheduledMaintenanceCardContent] across every branch
// the web component renders (active window with countdown + Clear / not-active scheduler form) plus the
// lifecycle chrome the host's feed implies (loading skeleton / hard error with retry / offline cached). Verifies
// the always-present heading, the active message + countdown, the scheduler's fields + Save (disabled until the
// duration is valid — the native stand-in for the web validation toast), the Clear / Retry affordances and
// their callbacks, the loading region's TalkBack label, and the offline freshness chip. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// projection + Resource → UiState mapping + view-model. `mainClock.autoAdvance` is disabled because the loading
// body hosts an indefinite shimmer that never idles.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.scheduledmaintenancecard

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

class ScheduledMaintenanceCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow: Long = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()

    // Injected English labels so the assertions are locale-independent (mirrors FrontendErrorsCardUiTest).
    private val strings =
        ScheduledMaintenanceStrings(
            title = "Scheduled maintenance",
            activeBadge = "Active",
            defaultMessage = "Maintenance is in progress. Live data may be paused.",
            description = "Control the top-of-app banner shown to all users.",
            durationLabel = "Duration",
            minuteUnit = "min",
            messageLabel = "Banner message",
            messageHelp = "Up to 280 characters.",
            save = "Save",
            saving = "Saving…",
            clear = "Clear",
            endsInTemplate = "Ends in %1\$s",
            endingNow = "Ending now",
            ended = "Window has ended; refresh to confirm.",
            errorTitle = "Server error",
            errorMessage = "The server ran into a problem.",
            retry = "Retry",
            loadingLabel = "Loading",
            freshnessFetching = "Loading...",
            freshnessError = "Offline",
        )

    private fun isoInMinutes(minutes: Long): String = Instant.ofEpochMilli(fixedNow + minutes * 60_000L).toString()

    private fun setContent(
        state: UiState<MaintenanceSnapshot>,
        durationText: String = "60",
        onSchedule: () -> Unit = {},
        onClear: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScheduledMaintenanceCardContent(
                    state = state,
                    actions = MaintenanceActions(),
                    durationText = durationText,
                    onDurationChange = {},
                    message = "",
                    onMessageChange = {},
                    onSchedule = onSchedule,
                    onClear = onClear,
                    onRetry = onRetry,
                    nowMs = fixedNow,
                    strings = strings,
                )
            }
        }
    }

    private fun active(
        message: String?,
        untilMinutes: Long,
    ): UiState<MaintenanceSnapshot> =
        UiState(UiPhase.Content, data = MaintenanceSnapshot(MAINTENANCE_MODE, message, isoInMinutes(untilMinutes)))

    @Test
    fun headingIsAlwaysVisible() {
        setContent(active(message = "x", untilMinutes = 45))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun activeWindowShowsMessageCountdownAndClear() {
        var cleared = false
        setContent(active(message = "Upgrading the database cluster.", untilMinutes = 45), onClear = { cleared = true })
        compose.onNodeWithText("Upgrading the database cluster.").assertIsDisplayed()
        compose.onNodeWithText("Ends in 45 min").assertIsDisplayed()
        compose.onNodeWithText(strings.clear).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.clear).performClick()
        assertTrue(cleared)
    }

    @Test
    fun activeWindowFallsBackToDefaultMessageWhenBlank() {
        setContent(active(message = null, untilMinutes = 30))
        compose.onNodeWithText(strings.defaultMessage).assertIsDisplayed()
    }

    @Test
    fun endedWindowShowsEndedCopy() {
        setContent(active(message = "x", untilMinutes = -5))
        compose.onNodeWithText(strings.ended).assertIsDisplayed()
    }

    @Test
    fun schedulerShowsDescriptionFieldsAndSave() {
        setContent(UiState(UiPhase.Content, data = MaintenanceSnapshot.DEFAULT))
        compose.onNodeWithText(strings.description).assertIsDisplayed()
        compose.onNodeWithText(strings.durationLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.messageLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.save).assertIsDisplayed()
    }

    @Test
    fun saveIsDisabledUntilDurationIsValid() {
        setContent(UiState(UiPhase.Content, data = MaintenanceSnapshot.DEFAULT), durationText = "abc")
        compose.onNodeWithText(strings.save).assertIsNotEnabled()
    }

    @Test
    fun saveInvokesScheduleWhenDurationValid() {
        var scheduled = false
        setContent(UiState(UiPhase.Content, data = MaintenanceSnapshot.DEFAULT), durationText = "60", onSchedule = { scheduled = true })
        compose.onNodeWithText(strings.save).assertIsEnabled().performClick()
        assertTrue(scheduled)
    }

    @Test
    fun loadingShowsAnAccessibleSkeleton() {
        setContent(UiState.loading())
        compose.onAllNodesWithContentDescription(strings.loadingLabel).onFirst().assertExists()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordanceAndInvokesIt() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.errorTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.retry).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.retry).performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsCachedSchedulerWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = MaintenanceSnapshot.DEFAULT,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(strings.description).assertIsDisplayed()
        compose.onAllNodesWithContentDescription(strings.freshnessError).onFirst().assertExists()
    }
}
