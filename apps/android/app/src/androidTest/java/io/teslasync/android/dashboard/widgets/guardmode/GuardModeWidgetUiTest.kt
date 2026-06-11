package io.teslasync.android.dashboard.widgets.guardmode

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.OffsetDateTime

/**
 * On-device Compose UI + accessibility verification of [GuardModeWidgetContent] across every state the web
 * component renders (loading skeleton, empty "No guard data", hard error + retry, the full status-card +
 * event feed, the "No guard events" feed empty, the compact hero, stale/offline cached). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the logic, this covers the render.
 */
class GuardModeWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = OffsetDateTime.parse("2026-06-06T12:05:00Z").toInstant().toEpochMilli()

    private fun config(
        enabled: Boolean = true,
        sensitivity: String = "medium",
        autoPanic: Boolean = false,
    ): GuardConfig =
        GuardConfig(
            vehicleId = 1L,
            enabled = enabled,
            homeGeofenceId = null,
            sensitivity = sensitivity,
            autoPanic = autoPanic,
            createdAt = "2026-06-01T00:00:00Z",
            updatedAt = "2026-06-06T12:00:00Z",
        )

    private fun event(
        id: Long = 1,
        eventType: String = "sentry_triggered",
        ts: String = "2026-06-06T12:00:00Z",
        acknowledgedAt: String? = null,
    ): GuardEvent =
        GuardEvent(
            id = id,
            vehicleId = 1L,
            ts = ts,
            eventType = eventType,
            acknowledgedAt = acknowledgedAt,
        )

    private fun snapshot(
        config: GuardConfig? = config(),
        events: List<GuardEvent> = emptyList(),
    ): GuardModeSnapshot = GuardModeSnapshot(config = config, events = events)

    private fun setContent(
        state: UiState<GuardModeSnapshot>,
        size: GuardModeSize = GuardModeRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GuardModeWidgetContent(
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
    fun emptyShowsNoGuardDataMessage() {
        setContent(UiState(UiPhase.Empty, data = snapshot(config = null), fetchedAt = 1L))
        compose.onNodeWithText("No guard data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun fullViewShowsStatusCardAndEventRow() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(config = config(enabled = true), events = listOf(event())),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Armed").assertIsDisplayed()
        compose.onNodeWithText("ON").assertIsDisplayed()
        compose.onNodeWithText("Sensitivity: medium").assertIsDisplayed()
        // The feed row exposes one folded TalkBack phrase (title, ack-state, relative time).
        compose.onNodeWithContentDescription("Sentry Triggered, Unacknowledged, 5m ago").assertIsDisplayed()
    }

    @Test
    fun fullViewWithNoEventsShowsFeedEmptyState() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(config = config(enabled = false), events = emptyList()),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Disarmed").assertIsDisplayed()
        compose.onNodeWithText("OFF").assertIsDisplayed()
        compose.onNodeWithText("No guard events").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = snapshot(events = listOf(event(), event(id = 2))), fetchedAt = 1L),
            size = GuardModeSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("Armed, 2 events").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(config = config(enabled = true), events = listOf(event())),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached guard status stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("Armed").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = snapshot(events = listOf(event())), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
