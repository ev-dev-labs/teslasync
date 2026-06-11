package io.teslasync.android.dashboard.widgets.sentryeventlog

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.OffsetDateTime

/**
 * On-device Compose UI + accessibility verification of [SentryEventLogWidgetContent] across every state
 * the web component renders (loading skeleton, empty "No security events recorded", hard error + retry,
 * the event feed, the wide-footprint lock/sentry subtitle, stale/offline cached). Asserts the rendered
 * i18n strings + the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the logic, this covers the render.
 */
class SentryEventLogWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = OffsetDateTime.parse("2026-06-06T12:05:00Z").toInstant().toEpochMilli()

    private fun event(
        id: Long = 1,
        ts: String = "2026-06-06T12:00:00Z",
        locked: Boolean? = null,
        sentryMode: Boolean? = null,
        doorState: String? = null,
    ): SecurityEvent =
        SecurityEvent(
            id = id,
            vehicleId = 1L,
            ts = ts,
            createdAt = null,
            eventType = "security_state",
            doorState = doorState,
            locked = locked,
            sentryMode = sentryMode,
        )

    private fun setContent(
        state: UiState<SentryEventLogSnapshot>,
        size: SentryEventLogSize = SentryEventLogRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SentryEventLogWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = now,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoEventsMessage() {
        setContent(UiState(UiPhase.Empty, data = SentryEventLogSnapshot.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("No security events recorded").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentShowsTitleAndAccessibleEventRow() {
        setContent(
            UiState(
                UiPhase.Content,
                data = SentryEventLogSnapshot(listOf(event(sentryMode = true))),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Sentry Event Log").assertIsDisplayed()
        // The feed row exposes one folded TalkBack phrase (title, relative time) on the narrow footprint.
        compose.onNodeWithContentDescription("Sentry Mode activated, 5m ago").assertIsDisplayed()
    }

    @Test
    fun wideFootprintRowFoldsLockSentrySubtitleIntoAccessibleName() {
        setContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = SentryEventLogSnapshot(listOf(event(locked = false))),
                    fetchedAt = 1L,
                ),
            size = SentryEventLogSize(cols = 4, rows = 6),
        )
        // Wide footprint adds the lock/sentry subtitle (🔓 Unlocked) to the row's TalkBack phrase.
        compose.onNodeWithContentDescription("Vehicle unlocked, \uD83D\uDD13 Unlocked, 5m ago").assertIsDisplayed()
    }

    @Test
    fun emptyVehicleStillShowsTitleHeader() {
        setContent(UiState(UiPhase.Empty, data = SentryEventLogSnapshot.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("Sentry Event Log").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedFeedVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = SentryEventLogSnapshot(listOf(event(locked = true))),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached feed row stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Vehicle locked, 5m ago").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(
            UiState(
                UiPhase.Content,
                data = SentryEventLogSnapshot(listOf(event(sentryMode = true))),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
