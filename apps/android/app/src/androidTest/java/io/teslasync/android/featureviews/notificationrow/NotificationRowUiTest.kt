package io.teslasync.android.featureviews.notificationrow

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId

/**
 * On-device Compose UI + accessibility verification of [NotificationRowContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty state, the loaded row, and the
 * stale/offline cached views. Asserts the rendered i18n strings, that the actions fire their callbacks, and that
 * the TalkBack content descriptions are present on every interactive affordance. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure logic, this covers render +
 * a11y. Mirrors the web spec (web/src/features/notifications/components/NotificationRow.tsx).
 */
class NotificationRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val vehicle: Vehicle =
        Vehicle(
            createdAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Model 3",
            enrolledAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            id = 2,
            teslaId = 1002,
            timezone = "UTC",
            updatedAt = kotlin.time.Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN2",
        )

    private val rule: AlertRule = AlertRule(id = 7, name = "Battery rule", severity = "warning", signalName = "BatteryLevel")

    private fun log(
        read: Boolean,
        archived: Boolean,
    ): NotificationLog =
        NotificationLog(
            id = 1,
            title = "Battery low",
            message = "State of charge dropped below 20% while parked.",
            severity = "warning",
            createdAt = "2026-04-04T14:30:00Z",
            readAt = if (read) "2026-04-04T14:45:00Z" else null,
            archivedAt = if (archived) "2026-04-04T15:00:00Z" else null,
        )

    private fun input(
        read: Boolean = false,
        archived: Boolean = false,
    ): NotificationRowInput = NotificationRowInput(log(read, archived), rule, vehicle)

    private val allActions =
        NotificationRowActions(
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onViewContext = {},
        )

    private fun setContent(
        state: UiState<NotificationRowInput>,
        selected: Boolean = false,
        actions: NotificationRowActions = allActions,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                NotificationRowContent(
                    state = state,
                    selected = selected,
                    actions = actions,
                    onRetry = onRetry,
                    zoneId = ZoneId.of("UTC"),
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
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleMessageSeverityVehicleRuleAndActions() {
        setContent(UiState(UiPhase.Content, data = input()))
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        compose.onNodeWithText("State of charge dropped below 20% while parked.").assertIsDisplayed()
        compose.onNodeWithText("warning").assertIsDisplayed()
        compose.onNodeWithText("Model 3", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Battery rule", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Mark as read").assertIsDisplayed()
        compose.onNodeWithContentDescription("Archive").assertIsDisplayed()
        compose.onNodeWithContentDescription("View context").assertIsDisplayed()
    }

    @Test
    fun readArchivedRowShowsMarkUnreadAndRestoreActions() {
        setContent(UiState(UiPhase.Content, data = input(read = true, archived = true)))
        compose.onNodeWithContentDescription("Mark as unread").assertIsDisplayed()
        compose.onNodeWithContentDescription("Restore").assertIsDisplayed()
    }

    @Test
    fun selectionCheckboxIsLabeledAndInvokesCallback() {
        var toggled = false
        setContent(
            state = UiState(UiPhase.Content, data = input()),
            actions = NotificationRowActions(onSelectionChange = { toggled = true }),
        )
        compose.onNodeWithContentDescription("Select notification").assertIsDisplayed()
        compose.onNodeWithContentDescription("Select notification").performClick()
        assertTrue(toggled)
    }

    @Test
    fun activatingTheRowBodyInvokesCallback() {
        var activated = false
        setContent(
            state = UiState(UiPhase.Content, data = input()),
            actions = NotificationRowActions(onActivate = { activated = true }),
        )
        compose.onNodeWithText("Battery low").performClick()
        assertTrue(activated)
    }

    @Test
    fun markReadActionInvokesCallback() {
        var marked = false
        setContent(
            state = UiState(UiPhase.Content, data = input()),
            actions = NotificationRowActions(onMarkRead = { marked = true }),
        )
        compose.onNodeWithContentDescription("Mark as read").performClick()
        assertTrue(marked)
    }

    @Test
    fun archiveActionInvokesCallback() {
        var archived = false
        setContent(
            state = UiState(UiPhase.Content, data = input()),
            actions = NotificationRowActions(onArchive = { archived = true }),
        )
        compose.onNodeWithContentDescription("Archive").performClick()
        assertTrue(archived)
    }

    @Test
    fun viewContextActionInvokesCallback() {
        var opened = false
        setContent(
            state = UiState(UiPhase.Content, data = input()),
            actions = NotificationRowActions(onViewContext = { opened = true }),
        )
        compose.onNodeWithContentDescription("View context").performClick()
        assertTrue(opened)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = input(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = input(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Battery low").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
