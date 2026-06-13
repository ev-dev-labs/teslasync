// Instrumented Compose UI + accessibility verification of the NotificationBellPopover surface across the branches
// the web component renders (web/src/components/layout/NotificationBellPopover.tsx): the bell trigger's unread
// label + tap, and the panel's loading / hard-error+retry / empty / content (severity dot, title, message,
// relative time, vehicle) / stale-offline states, plus the close, "Mark all read", "View all", and row hand-offs.
// Every asserted label is the localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`;
// the offline `testReleaseUnitTest` gate covers the pure projection + presenter.
package io.teslasync.android.modalsdialogs.notificationbellpopover

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class NotificationBellPopoverUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        NotificationBellPopoverStrings(
            notificationsLabel = "Notifications",
            unreadNotificationsTemplate = "%1\$s unread notifications",
            title = "Notifications",
            unreadCountTemplate = "%1\$s unread",
            allRead = "All caught up",
            close = "Close",
            loading = "Loading…",
            error = "Could not load notifications",
            emptyTitle = "You're all caught up",
            emptyMessage = "No unread notifications right now.",
            untitled = "Notification",
            markAllRead = "Mark all read",
            viewAll = "View all",
            retry = "Retry",
            offline = "Offline",
            severityInfo = "Info",
            severityWarn = "Warn",
            severityCritical = "Critical",
        )

    private val now: Instant = Instant.parse("2026-06-12T12:00:00Z")

    private fun contentPreview(): NotificationBellPreview =
        NotificationBellPreview(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        listOf(
                            NotificationLog(
                                id = 2,
                                alertId = 7,
                                title = "Battery low — Model Y",
                                message = "State of charge dropped below 20%.",
                                createdAt = "2026-06-12T11:30:00Z",
                            ),
                            NotificationLog(id = 1, alertId = 8, title = "", createdAt = "2026-06-12T11:59:40Z"),
                        ),
                    fetchedAt = now.toEpochMilli(),
                ),
            rulesById =
                mapOf(
                    7L to AlertRule(id = 7, name = "Low battery", severity = "critical", vehicleId = 2),
                    8L to AlertRule(id = 8, name = "Charge complete", severity = "info"),
                ),
            vehiclesById = mapOf(2L to vehicle()),
        )

    private fun setPanel(
        preview: NotificationBellPreview,
        markPending: Boolean = false,
        onClose: () -> Unit = {},
        onMarkAllRead: () -> Unit = {},
        onOpenInbox: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    NotificationBellPanel(
                        preview = preview,
                        unreadCount = preview.logCount,
                        markPending = markPending,
                        onClose = onClose,
                        onMarkAllRead = onMarkAllRead,
                        onOpenInbox = onOpenInbox,
                        onRetry = onRetry,
                        strings = strings,
                        now = now,
                        zoneId = ZoneId.of("UTC"),
                    )
                }
            }
        }
    }

    @Test
    fun contentRendersEveryRowFieldAndSeverityLabel() {
        setPanel(contentPreview())

        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("Battery low — Model Y").assertIsDisplayed()
        compose.onNodeWithText("State of charge dropped below 20%.").assertIsDisplayed()
        // Relative times (web formatRelative) resolve through the shared freshness catalog templates.
        compose.onNodeWithText("30m ago").assertIsDisplayed()
        compose.onNodeWithText("just now").assertIsDisplayed()
        // The second row's blank title falls back to its rule name (web `log.title || rule?.name`).
        compose.onNodeWithText("Charge complete").assertIsDisplayed()
        // The vehicle chip (web `vehicle.display_name`) and the severity dot's a11y label.
        compose.onNodeWithText("\u00B7 Model Y", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.severityCritical).assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersTheCaughtUpCopy() {
        setPanel(NotificationBellPreview(UiState(UiPhase.Empty, emptyList()), emptyMap(), emptyMap()))

        compose.onNodeWithText(strings.emptyTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        setPanel(NotificationBellPreview(UiState.loading(), emptyMap(), emptyMap()))

        compose.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun errorStateShowsTheMessageAndRetryInvokesTheCallback() {
        var retried = false
        setPanel(
            NotificationBellPreview(
                UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network),
                emptyMap(),
                emptyMap(),
            ),
            onRetry = { retried = true },
        )

        compose.onNodeWithText(strings.error).assertIsDisplayed()
        compose
            .onNodeWithText(strings.retry)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()
        assertTrue("tapping Retry must invoke onRetry", retried)
    }

    @Test
    fun closeButtonExposesItsLabelAndInvokesOnClose() {
        var closed = false
        setPanel(contentPreview(), onClose = { closed = true })

        compose
            .onNodeWithContentDescription(strings.close)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()
        assertTrue("tapping Close must invoke onClose", closed)
    }

    @Test
    fun markAllReadIsEnabledWithRowsAndInvokesTheCallback() {
        var marked = false
        setPanel(contentPreview(), onMarkAllRead = { marked = true })

        compose.onNodeWithText(strings.markAllRead).assertIsDisplayed().performClick()
        assertTrue("tapping Mark all read must invoke onMarkAllRead", marked)
    }

    @Test
    fun markAllReadIsDisabledWhenThereAreNoRows() {
        setPanel(NotificationBellPreview(UiState(UiPhase.Empty, emptyList()), emptyMap(), emptyMap()))

        compose.onNodeWithText(strings.markAllRead).assertIsNotEnabled()
    }

    @Test
    fun viewAllInvokesOnOpenInbox() {
        var opened = false
        setPanel(contentPreview(), onOpenInbox = { opened = true })

        compose.onNodeWithText(strings.viewAll).assertIsDisplayed().performClick()
        assertTrue("tapping View all must invoke onOpenInbox", opened)
    }

    @Test
    fun tappingARowInvokesOnOpenInbox() {
        var opened = false
        setPanel(contentPreview(), onOpenInbox = { opened = true })

        compose.onNodeWithText("Battery low — Model Y").performClick()
        assertTrue("tapping a row must navigate to the inbox", opened)
    }

    @Test
    fun staleOfflineKeepsRowsAndShowsTheOfflineChip() {
        setPanel(
            NotificationBellPreview(
                contentPreview().state.copy(stale = true, errorKind = io.teslasync.android.data.ErrorKind.Timeout),
                contentPreview().rulesById,
                contentPreview().vehiclesById,
            ),
        )

        compose.onNodeWithText("Battery low — Model Y").assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.offline).assertIsDisplayed()
    }

    @Test
    fun triggerAnnouncesTheUnreadLabelAndTapInvokesTheCallback() {
        var clicked = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    NotificationBellPopoverContent(
                        count = 3,
                        triggerLabel = "3 unread notifications",
                        open = false,
                        preview = NotificationBellPreview.EMPTY,
                        markPending = false,
                        strings = strings,
                        onBellClick = { clicked = true },
                        onDismiss = {},
                        onMarkAllRead = {},
                        onRetry = {},
                        onOpenInbox = {},
                    )
                }
            }
        }

        compose.onNodeWithContentDescription("3 unread notifications").assertIsDisplayed().performClick()
        assertTrue("tapping the bell must invoke onBellClick", clicked)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp

        fun vehicle(): Vehicle =
            Vehicle(
                createdAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
                displayName = "Model Y",
                enrolledAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
                id = 2,
                teslaId = 1002,
                timezone = "UTC",
                updatedAt = kotlin.time.Instant.parse("2026-01-01T00:10:00Z"),
                vin = "VIN2",
            )
    }
}
